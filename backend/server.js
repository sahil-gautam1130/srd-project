require('dotenv').config();
const express = require('express'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken'), crypto = require('crypto'), fs = require('fs'), path = require('path');
let { JWT_SECRET, OTP_SECRET, ADMIN_PASSWORD, ID_SALT, SMS_PROVIDER = 'console', PORT = 3000, NODE_ENV, DEMO_MOBILE } = process.env;
if (+process.versions.node.split('.')[0] < 18) { console.error('Node 18 or newer is required. You have ' + process.version); process.exit(1); }
if (!JWT_SECRET || !OTP_SECRET || !ADMIN_PASSWORD || !ID_SALT) {
  if (NODE_ENV === 'production') { console.error('Set JWT_SECRET, OTP_SECRET, ID_SALT and ADMIN_PASSWORD in your environment.'); process.exit(1); }
  ID_SALT = ID_SALT || 'srd-dev-salt';
  JWT_SECRET = JWT_SECRET || require('crypto').randomBytes(32).toString('hex'); OTP_SECRET = OTP_SECRET || require('crypto').randomBytes(32).toString('hex');
  if (!ADMIN_PASSWORD) { ADMIN_PASSWORD = 'admin123'; console.warn('DEV MODE: no .env found. Admin password is "admin123". Create a .env (see .env.example) before real use.'); }
}

/* Aadhaar numbers are never stored: users are keyed by a salted HMAC; only the last 4 digits are kept for display */
const uid = a => require('crypto').createHmac('sha256', ID_SALT).update(a).digest('hex').slice(0, 32);

/* ---------- storage (JSON file, atomic writes). Swap for PostgreSQL/MongoDB when scaling ---------- */
const FILE = path.join(__dirname, 'data', 'db.json');
const month = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
let db;
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {
  db = { users: {}, stock: { rice: { q: 1000, p: 3, max: 5 }, wheat: { q: 750, p: 2, max: 3 }, sugar: { q: 500, p: 4, max: 1 } }, tx: [] };
  if (DEMO_MOBILE || NODE_ENV !== 'production') { const DM = DEMO_MOBILE || '9999999999'; db.users[uid('123456789012')] = { name: 'John Doe', type: 'BPL', mobile: DM, last: null, l4: '9012' }; db.users[uid('987654321098')] = { name: 'Jane Smith', type: 'APL', mobile: DM, last: null, l4: '1098' }; }
  save();
}
function save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE); }

/* ---------- SMS providers ---------- */
async function sendSms(mobile, otp) {
  const to = '91' + mobile; let r;
  if (SMS_PROVIDER === 'console') { console.log(`[SMS:console] to ${mobile}: OTP ${otp}`); return; }
  if (SMS_PROVIDER === 'msg91')
    r = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(process.env.MSG91_TEMPLATE_ID)}&mobile=${to}&authkey=${encodeURIComponent(process.env.MSG91_AUTHKEY)}&otp=${otp}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  else if (SMS_PROVIDER === 'fast2sms')
    r = await fetch('https://www.fast2sms.com/dev/bulkV2', { method: 'POST', headers: { authorization: process.env.FAST2SMS_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ route: 'otp', variables_values: otp, numbers: mobile }) });
  else if (SMS_PROVIDER === 'twilio') {
    const { TWILIO_SID: sid, TWILIO_TOKEN: tok, TWILIO_FROM: from } = process.env;
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: '+' + to, From: from, Body: `Your Smart Ration Dispenser OTP is ${otp}. Valid for 2 minutes. Do not share it.` }) });
  } else throw new Error('Unknown SMS_PROVIDER');
  const body = await r.text(); if (!r.ok) throw new Error(`${SMS_PROVIDER} ${r.status}: ${body.slice(0, 200)}`);
  if (SMS_PROVIDER !== 'twilio') { let j = {}; try { j = JSON.parse(body); } catch {} if (j.type === 'error' || j.return === false) throw new Error(body.slice(0, 200)); }
}

/* ---------- helpers ---------- */
const app = express(); app.set('trust proxy', 1);
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://checkout.razorpay.com'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'], frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'], upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null } } }));
app.use(express.json({ limit: '10kb' }));
const fail = (res, code, error) => res.status(code).json({ error });
const clean = s => String(s || '').replace(/\D/g, '').slice(0, 12);
const mask = m => 'XXXXXX' + m.slice(-4);
const hmac = (card, otp) => crypto.createHmac('sha256', OTP_SECRET).update(card + ':' + otp).digest('hex');
const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const lim = (windowMin, max, msg) => rateLimit({ windowMs: windowMin * 60e3, max, standardHeaders: true, legacyHeaders: false, handler: (q, s) => fail(s, 429, msg) });
const auth = role => (req, res, next) => { try { const p = jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET); if (p.role !== role) throw 0; req.tok = p; next(); } catch { fail(res, 401, 'Session expired. Please log in again.'); } };
const pubStock = () => Object.fromEntries(Object.entries(db.stock).map(([k, s]) => [k, { q: s.q, p: s.p, max: s.max }]));
app.use('/api', lim(1, 120, 'Too many requests. Slow down.'));

/* ---------- OTP (in memory; use Redis if you run several instances) ---------- */
const otps = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of otps) if ((!v.exp || v.exp < n) && !(v.sent || []).some(t => n - t < 3600e3)) otps.delete(k); }, 600e3).unref();

app.post('/api/otp/send', lim(15, 10, 'Too many OTP requests from this network. Try later.'), async (req, res) => {
  const aad = clean(req.body.card); if (aad.length !== 12) return fail(res, 400, 'Enter a valid 12-digit Aadhaar number.');
  const card = uid(aad), u = db.users[card];
  if (!u) return fail(res, 404, 'Aadhaar number not registered. Contact your ration office.');
  if (u.last === month()) return fail(res, 409, 'Ration already collected this month for this card.');
  const now = Date.now(), o = otps.get(card) || { sent: [] };
  o.sent = o.sent.filter(t => now - t < 3600e3);
  if (o.sent.length && now - o.sent[o.sent.length - 1] < 30e3) return fail(res, 429, 'Please wait 30 seconds before requesting another OTP.');
  if (o.sent.length >= 5) return fail(res, 429, 'Too many OTP requests for this card. Try again in an hour.');
  const otp = String(crypto.randomInt(100000, 1000000));
  try { await sendSms(u.mobile, otp); } catch (e) { console.error('SMS failed:', e.message); return fail(res, 502, 'Could not send SMS. Please try again.'); }
  Object.assign(o, { hash: hmac(card, otp), exp: now + 120e3, tries: 0 }); o.sent.push(now); otps.set(card, o);
  res.json({ mobile: mask(u.mobile), devOtp: SMS_PROVIDER === 'console' && NODE_ENV !== 'production' ? otp : undefined });
});

app.post('/api/otp/verify', lim(15, 30, 'Too many attempts. Try later.'), (req, res) => {
  const card = uid(clean(req.body.card)), code = String(req.body.otp || ''), o = otps.get(card), u = db.users[card];
  if (!o || !o.hash || !u) return fail(res, 400, 'Please request a new OTP.');
  if (Date.now() > o.exp) { delete o.hash; return fail(res, 400, 'OTP expired. Request a new one.'); }
  if (o.tries >= 3) { delete o.hash; return fail(res, 429, 'Too many wrong attempts. Request a new OTP.'); }
  if (!/^\d{6}$/.test(code) || !safeEq(hmac(card, code), o.hash)) { o.tries++; return fail(res, 401, `Incorrect OTP. ${3 - o.tries} attempt(s) left.`); }
  delete o.hash;
  res.json({ token: jwt.sign({ card, role: 'user' }, JWT_SECRET, { expiresIn: '15m' }), user: { name: u.name, type: u.type }, stock: pubStock() });
});

/* ---------- ration & Razorpay payments ---------- */
const RZP_ID = process.env.RAZORPAY_KEY_ID, RZP_SECRET = process.env.RAZORPAY_KEY_SECRET, RZP = !!(RZP_ID && RZP_SECRET);
console.warn(RZP ? 'Razorpay payments: ENABLED' : NODE_ENV === 'production' ? 'WARNING: Razorpay not configured - paid collections are disabled' : 'Razorpay not configured - using SIMULATED payments (dev only)');
const bad = (code, msg) => Object.assign(new Error(msg), { code });
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { e.code ? fail(res, e.code, e.message) : (console.error(e), fail(res, 500, 'Server error')); } };
function quote(u, cart) { // validates quota + stock and computes the amount on the server
  const items = []; let total = 0;
  for (const [k, q] of Object.entries(cart || {})) {
    if (!Number.isInteger(q) || q < 0) throw bad(400, 'Invalid quantity.'); if (!q) continue;
    const s = db.stock[k]; if (!s) throw bad(400, 'Unknown item.');
    if (q > s.max) throw bad(400, `${k} exceeds your monthly quota.`); if (q > s.q) throw bad(409, `Insufficient ${k} stock.`);
    const amt = u.type === 'APL' ? q * s.p : 0; items.push({ name: k, qty: q, amt }); total += amt;
  }
  if (!items.length) throw bad(400, 'Select at least one item.');
  return { items, total };
}
const orders = new Map(); // razorpay order id -> { card, cart, total, used, exp }
setInterval(() => { const n = Date.now(); for (const [k, v] of orders) if (v.exp < n) orders.delete(k); }, 600e3).unref();

app.get('/api/stock', (q, r) => r.json({ stock: pubStock() }));
app.get('/api/config', (q, r) => r.json({ razorpay: RZP }));

app.post('/api/pay/order', auth('user'), lim(15, 10, 'Too many payment attempts. Try later.'), wrap(async (req, res) => {
  if (!RZP) throw bad(503, 'Online payments are not configured.');
  const u = db.users[req.tok.card]; if (!u) throw bad(401, 'Unknown user.');
  if (u.last === month()) throw bad(409, 'Ration already collected this month.');
  const { total } = quote(u, req.body.cart); if (total <= 0) throw bad(400, 'No payment required.');
  const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(RZP_ID + ':' + RZP_SECRET).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: total * 100, currency: 'INR', receipt: 'srd_' + Date.now().toString(36), notes: { user: req.tok.card.slice(0, 8) } }) });
  const j = await r.json(); if (!r.ok) { console.error('Razorpay order error:', j); throw bad(502, 'Could not start payment. Try again.'); }
  orders.set(j.id, { card: req.tok.card, cart: req.body.cart, total, used: false, exp: Date.now() + 30 * 60e3 });
  res.json({ orderId: j.id, amount: j.amount, keyId: RZP_ID });
}));

app.post('/api/checkout', auth('user'), wrap(async (req, res) => {
  const u = db.users[req.tok.card]; if (!u) throw bad(401, 'Unknown user.');
  if (u.last === month()) throw bad(409, 'Ration already collected this month.');
  let { items, total } = quote(u, req.body.cart), method = 'Subsidy', ref = null;
  if (total > 0) {
    if (RZP) {
      const p = req.body.payment || {}, o = orders.get(p.order_id);
      if (!o || o.used || o.card !== req.tok.card) throw bad(400, 'Invalid payment order.');
      const sig = crypto.createHmac('sha256', RZP_SECRET).update(p.order_id + '|' + p.payment_id).digest('hex');
      if (!safeEq(sig, p.signature || '')) throw bad(400, 'Payment verification failed.');
      o.used = true;
      try { ({ items, total } = quote(u, o.cart)); if (total !== o.total) throw 0; }
      catch (e) { throw bad(409, `Could not complete your order after payment. Contact support with payment ID ${p.payment_id} for a refund.`); }
      method = 'Razorpay'; ref = p.payment_id;
    } else if (NODE_ENV === 'production') throw bad(503, 'Payments are not configured.');
    else method = String(req.body.method || 'UPI').slice(0, 10) + ' (sim)';
  }
  items.forEach(i => db.stock[i.name].q -= i.qty); u.last = month();
  const tx = { id: 'SRD' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(), date: new Date().toISOString(), aadhaar: 'XXXXXXXX' + u.l4, name: u.name, type: u.type, items, total, method, ref };
  db.tx.unshift(tx); db.tx = db.tx.slice(0, 5000); save(); res.json({ tx, stock: pubStock() });
}));

/* ---------- admin ---------- */
app.post('/api/admin/login', lim(15, 10, 'Too many login attempts. Try later.'), (req, res) =>
  safeEq(req.body.password || '', ADMIN_PASSWORD) ? res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' }) }) : fail(res, 401, 'Incorrect password.'));
app.get('/api/admin/summary', auth('admin'), (q, res) => res.json({
  stock: pubStock(), tx: db.tx.slice(0, 50),
  users: Object.values(db.users).map(u => ({ card: 'XXXXXXXX' + u.l4, name: u.name, type: u.type, mobile: mask(u.mobile), last: u.last }))
}));
app.post('/api/admin/restock', auth('admin'), (req, res) => {
  const s = db.stock[req.body.item], n = req.body.qty; if (!s || !Number.isInteger(n) || n < 1 || n > 100000) return fail(res, 400, 'Invalid restock request.');
  s.q += n; save(); res.json({ stock: pubStock() });
});
app.post('/api/admin/users', auth('admin'), (req, res) => {
  const aad = clean(req.body.card), name = String(req.body.name || '').trim().slice(0, 60), mobile = String(req.body.mobile || '');
  if (aad.length !== 12 || !name || !/^[6-9]\d{9}$/.test(mobile) || !['BPL', 'APL'].includes(req.body.type)) return fail(res, 400, 'Check Aadhaar (12 digits), name, 10-digit Indian mobile and category.');
  const card = uid(aad); if (db.users[card]) return fail(res, 409, 'This Aadhaar number is already registered.');
  db.users[card] = { name, type: req.body.type, mobile, last: null, l4: aad.slice(-4) }; save(); res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/api', (q, r) => fail(r, 404, 'Not found'));
app.use((err, q, res, n) => { console.error(err); fail(res, 500, 'Server error'); });
app.listen(PORT, () => console.log(`SRD running on http://localhost:${PORT}  (SMS provider: ${SMS_PROVIDER})`));
