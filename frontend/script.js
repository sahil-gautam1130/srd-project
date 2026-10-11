"use strict";
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>'₹'+Number(n).toLocaleString('en-IN');

/* ---------- API client (talks to the Node server) ---------- */
let db={stock:{},tx:[]},token=null,adminToken=null;
const IC={rice:'🌾',wheat:'🌿',sugar:'🍬'};
const fix=s=>{for(const k in s)s[k].ic=IC[k]||'📦';return s};
const http=async(p,body,tok,method)=>{let r;try{r=await fetch('/api'+p,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined})}catch(e){throw Error('Cannot reach server. Check your connection.')}
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Server error');return d};
const luhn=n=>{let s=0,d=false;for(let i=n.length-1;i>=0;i--){let x=+n[i];if(d){x*=2;if(x>9)x-=9}s+=x;d=!d}return s%10===0};
const API={
 sendOtp:c=>http('/otp/send',{card:c}),
 async verifyOtp(c,otp){const r=await http('/otp/verify',{card:c,otp});token=r.token;db.stock=fix(r.stock);return r},
 async checkout(a,cart,m,p){const r=await http('/checkout',{cart,method:m,payment:p},token);db.stock=fix(r.stock);return r.tx},
 async cardPay(n,e,c){await sleep(900);n=n.replace(/\s/g,'');if(!luhn(n)||n.length!==16)throw Error('Invalid card number.');
  const m=/^(0[1-9]|1[0-2])\/(\d{2})$/.exec(e);if(!m||new Date(2000+ +m[2],+m[1],0)<new Date())throw Error('Card expired or invalid expiry.');
  if(!/^\d{3}$/.test(c))throw Error('Invalid CVV.');if(n==='4000000000000002')throw Error('Payment declined by bank.')}
};

/* ---------- UI helpers ---------- */
function toast(msg,type=''){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;$('#toasts').append(t);setTimeout(()=>{t.style.opacity=0;t.style.transition='.3s';setTimeout(()=>t.remove(),300)},3200)}
function modal({icon='ℹ️',title,text,ok='OK',cancel,danger}){return new Promise(res=>{const o=$('#ov');
 o.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="em">${icon}</div><h3>${esc(title)}</h3><p>${text}</p><div class="acts">${cancel?`<button class="btn ghost" data-r="0">${cancel}</button>`:''}<button class="btn ${danger?'red':''}" data-r="1">${ok}</button></div></div>`;
 o.classList.add('show');o.onclick=e=>{const b=e.target.closest('[data-r]');if(b||e.target===o){o.classList.remove('show');res(b?b.dataset.r==='1':false)}}})}
let smsT;function sms(otp){const s=$('#sms');s.innerHTML=`<small>💬 MESSAGES · now</small><div>SRD: Your login OTP is <b>${otp}</b>. Valid for 2 min. Do not share.</div><small>Tap to autofill</small>`;
 s.classList.add('show');s.onclick=()=>{fillOtp(otp);s.classList.remove('show')};clearTimeout(smsT);smsT=setTimeout(()=>s.classList.remove('show'),12000)}
function busy(b,on,txt){b.disabled=on;if(on){b._h=b.innerHTML;b.innerHTML='<span class="spin"></span>'+(txt||'Please wait…')}else b.innerHTML=b._h}
const stepper=n=>`<div class="steps">${['Aadhaar','OTP','Select','Payment','Receipt'].map((s,i)=>`<span class="${i<n?'done':i===n?'on':''}">${i+1}. ${s}</span>`).join('')}</div>`;

/* ---------- State & router ---------- */
let S={aadhaar:null,user:null,cart:{rice:0,wheat:0,sugar:0},admin:false};
const pages={home:()=>S.user?selectView():loginView(),support,help,contact,about,admin};
const navItems=[['home','🏠 Home'],['support','🛟 Support'],['help','❓ Help'],['contact','✉️ Contact'],['about','ℹ️ About'],['admin','⚙️ Admin']];
function go(p){location.hash=p;render(p)}
function render(p){p=pages[p]?p:'home';$('#nav').innerHTML=navItems.map(([k,l])=>`<a href="#${k}" class="${k===p?'on':''}">${l}</a>`).join('');$('#app').innerHTML='';pages[p]();window.scrollTo({top:0,behavior:'smooth'})}
window.addEventListener('hashchange',()=>render(location.hash.slice(1)));

/* ---------- Login & OTP ---------- */
function loginView(){$('#app').innerHTML=`<div class="card narrow">${stepper(0)}<h2>Welcome 👋</h2><p class="sub">Enter your 12-digit Aadhaar number. An OTP will be sent to your registered mobile.</p>
<div class="fg"><label for="aad">Aadhaar Number</label><input id="aad" inputmode="numeric" maxlength="12" placeholder="12-digit Aadhaar number" autocomplete="off" autofocus></div>
<button class="btn" id="go">Send OTP →</button></div>`;
 const i=$('#aad');i.oninput=()=>{i.value=i.value.replace(/\D/g,'').slice(0,12)};i.onkeydown=e=>{if(e.key==='Enter')$('#go').click()};
 $('#go').onclick=async e=>{const a=i.value.trim();if(!/^\d{12}$/.test(a))return toast('Enter a valid 12-digit Aadhaar number','error');
  const b=e.currentTarget;busy(b,true,'Sending OTP…');try{const r=await API.sendOtp(a);S.aadhaar=a;toast('OTP sent to '+r.mobile);otpView(r.devOtp)}catch(x){busy(b,false);await modal({icon:'⚠️',title:'Cannot proceed',text:esc(x.message)})}}}
function fillOtp(c){document.querySelectorAll('.otp input').forEach((x,k)=>x.value=c[k]||'');}
let timer;function otpView(otp){$('#app').innerHTML=`<div class="card narrow">${stepper(1)}<h2>Verify OTP</h2><p class="sub">Enter the 6-digit code sent to your registered mobile.</p>
<div class="otp" id="otp">${'<input inputmode="numeric" maxlength="1" aria-label="OTP digit">'.repeat(6)}</div><button class="btn" id="vf">Verify & Continue</button>
<p class="sub" style="margin-top:1rem" id="rs"></p><button class="btn ghost sm" id="bk" style="margin-top:.5rem">← Change Aadhaar</button></div>`;
 const ins=[...document.querySelectorAll('#otp input')];ins[0].focus();
 ins.forEach((x,k)=>{x.oninput=()=>{x.value=x.value.replace(/\D/g,'');if(x.value&&k<5)ins[k+1].focus();if(ins.every(y=>y.value))$('#vf').click()};
  x.onkeydown=e=>{if(e.key==='Backspace'&&!x.value&&k>0)ins[k-1].focus()};x.onpaste=e=>{e.preventDefault();fillOtp((e.clipboardData.getData('text')||'').replace(/\D/g,'').slice(0,6))}});
 $('#bk').onclick=()=>{clearInterval(timer);loginView()};
 $('#vf').onclick=async e=>{const c=ins.map(x=>x.value).join('');if(c.length<6)return toast('Enter all 6 digits','warn');const b=e.currentTarget;busy(b,true,'Verifying…');
  try{const r=await API.verifyOtp(S.aadhaar,c);clearInterval(timer);S.user=r.user;toast('Welcome, '+r.user.name+'!');selectView()}
  catch(x){busy(b,false);toast(x.message,'error');const o=$('#otp');o.classList.add('bad');setTimeout(()=>o.classList.remove('bad'),400);ins.forEach(y=>y.value='');ins[0].focus()}};
 let t=30;const rs=$('#rs');clearInterval(timer);const tick=()=>{rs.innerHTML=t>0?`Resend OTP in <b>${t}s</b>`:'<a href="#" id="rl" style="color:var(--pri);font-weight:600">Resend OTP</a>';const l=$('#rl');if(l)l.onclick=async ev=>{ev.preventDefault();try{const r=await API.sendOtp(S.aadhaar);toast('New OTP sent');otpView(r.devOtp)}catch(x){toast(x.message,'error')}};t--};
 tick();timer=setInterval(()=>{if(t<0)return clearInterval(timer);tick()},1000);if(otp)setTimeout(()=>sms(otp),600)}

/* ---------- Select items ---------- */
const total=()=>S.user.type==='APL'?Object.entries(S.cart).reduce((s,[k,q])=>s+q*db.stock[k].p,0):0;
function selectView(){const u=S.user,apl=u.type==='APL';
 $('#app').innerHTML=`<div class="card">${stepper(2)}<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem"><div><h2>Hello, ${esc(u.name)}</h2><p class="sub">Choose your monthly quota. ${apl?'APL items are charged at subsidised rates.':'BPL beneficiaries receive rations free of cost.'}</p></div><div><span class="badge ${u.type}">${u.type}</span></div></div>
 <div class="grid"><div id="items">${Object.entries(db.stock).map(([k,s])=>`<div class="item" id="i-${k}"><span class="ic">${s.ic}</span><div class="nm"><b style="text-transform:capitalize">${k}</b><br><small>${apl?inr(s.p)+'/kg · ':''}Max ${s.max}kg · ${s.q>50?'In stock':s.q>0?'Low stock':'Out of stock'}</small></div>
 <div class="qty"><button data-k="${k}" data-d="-1" aria-label="less">−</button><b id="q-${k}">0 kg</b><button data-k="${k}" data-d="1" aria-label="more">+</button></div></div>`).join('')}</div>
 <div class="sum"><h3>Order Summary</h3><div id="sl"></div><div class="row t"><span>Total</span><span id="tt"></span></div><button class="btn" id="nx" style="margin-top:1rem">${apl?'Proceed to Pay':'Confirm & Collect'} →</button><button class="btn ghost" id="lo" style="margin-top:.6rem">Log out</button></div></div></div>`;
 const upd=()=>{Object.entries(S.cart).forEach(([k,q])=>{$('#q-'+k).textContent=q+' kg';$('#i-'+k).classList.toggle('sel',q>0)});
  $('#sl').innerHTML=Object.entries(S.cart).filter(([,q])=>q).map(([k,q])=>`<div class="row"><span style="text-transform:capitalize">${k} × ${q}kg</span><span>${apl?inr(q*db.stock[k].p):'Free'}</span></div>`).join('')||'<p class="sub" style="margin:0">No items selected</p>';
  $('#tt').textContent=apl?inr(total()):'₹0 (Free)'};
 $('#items').onclick=e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.k,s=db.stock[k],n=S.cart[k]+ +b.dataset.d;
  if(n<0)return;if(n>s.max)return toast(`Monthly limit for ${k} is ${s.max}kg`,'warn');if(n>s.q)return toast(`Only ${s.q}kg ${k} left`,'warn');S.cart[k]=n;upd()};
 $('#lo').onclick=async()=>{if(await modal({icon:'👋',title:'Log out?',text:'Your selection will be cleared.',ok:'Log out',cancel:'Stay'}))logout()};
 $('#nx').onclick=async()=>{if(!Object.values(S.cart).some(Boolean))return toast('Select at least one item','warn');
  if(apl)return payView();
  if(await modal({icon:'📦',title:'Confirm collection',text:'Dispense the selected items? This counts as your monthly collection.',ok:'Dispense',cancel:'Cancel'}))finish('Subsidy')};upd()}
function logout(){token=null;S.user=null;S.aadhaar=null;S.cart={rice:0,wheat:0,sugar:0};toast('Logged out');loginView()}

/* ---------- Payment ---------- */
let RZP=null;
const loadRzp=()=>window.Razorpay?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.onload=ok;s.onerror=()=>no(Error('Could not load Razorpay. Check your connection.'));document.head.append(s)});
function rzpView(){const amt=total();
 $('#app').innerHTML=`<div class="card narrow">${stepper(3)}<h2>Payment</h2><p class="sub">Amount payable: <b style="color:var(--pri);font-size:1.3rem">${inr(amt)}</b></p><button class="btn" id="pay">🔒 Pay ${inr(amt)} securely</button><button class="btn ghost" id="bk" style="margin-top:.6rem">← Back</button><p class="sub" style="font-size:.75rem;margin-top:1rem">UPI, cards, netbanking and wallets via Razorpay. Your ration is dispensed only after the payment is verified.</p></div>`;
 $('#bk').onclick=selectView;
 $('#pay').onclick=async e=>{const b=e.currentTarget;busy(b,true,'Creating order…');
  try{const o=await http('/pay/order',{cart:S.cart},token);await loadRzp();busy(b,false);
   const r=new Razorpay({key:o.keyId,amount:o.amount,currency:'INR',name:'Smart Ration Dispenser',description:'Monthly ration',order_id:o.orderId,theme:{color:'#16a34a'},
    handler:async p=>{busy(b,true,'Verifying payment…');await finish('Razorpay',b,p)},modal:{ondismiss:()=>toast('Payment cancelled','warn')}});
   r.on('payment.failed',x=>modal({icon:'❌',title:'Payment failed',text:esc((x.error&&x.error.description)||'Payment failed'),ok:'Try again',danger:true}));r.open()}
  catch(x){busy(b,false);toast(x.message,'error')}}}
async function payView(){if(RZP===null){try{RZP=(await http('/config')).razorpay}catch(e){RZP=false}}if(RZP)return rzpView();let m='upi';const amt=total();
 const draw=()=>{$('#app').innerHTML=`<div class="card narrow">${stepper(3)}<h2>Payment</h2><p class="sub">Amount payable: <b style="color:var(--pri);font-size:1.3rem">${inr(amt)}</b></p>
 <div class="tabs"><button data-m="upi" class="${m==='upi'?'on':''}">📱 UPI</button><button data-m="card" class="${m==='card'?'on':''}">💳 Card</button></div>
 ${m==='upi'?`<div class="fg"><label>UPI ID</label><input id="vpa" placeholder="name@bank" autocomplete="off"></div>`:
 `<div class="fg"><label>Card Number</label><input id="cn" inputmode="numeric" placeholder="4242 4242 4242 4242" maxlength="19"></div><div class="two"><div class="fg"><label>Expiry</label><input id="ce" placeholder="MM/YY" maxlength="5"></div><div class="fg"><label>CVV</label><input id="cv" type="password" inputmode="numeric" maxlength="3" placeholder="•••"></div></div>`}
 <button class="btn" id="pay">Pay ${inr(amt)}</button><button class="btn ghost" id="bk" style="margin-top:.6rem">← Back</button><p class="sub" style="font-size:.75rem;margin-top:1rem">🔒 Demo gateway · no real money is charged. Test card: 4242 4242 4242 4242, any future expiry.</p></div>`;
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{m=b.dataset.m;draw()});$('#bk').onclick=selectView;
  const cn=$('#cn');if(cn){cn.oninput=()=>cn.value=cn.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();const ce=$('#ce');ce.oninput=()=>{let v=ce.value.replace(/\D/g,'').slice(0,4);ce.value=v.length>2?v.slice(0,2)+'/'+v.slice(2):v}}
  $('#pay').onclick=async e=>{const b=e.currentTarget;try{
   if(m==='upi'){if(!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test($('#vpa').value.trim()))throw Error('Enter a valid UPI ID, e.g. name@upi');busy(b,true,'Awaiting UPI approval…');await sleep(1200)}
   else{busy(b,true,'Authorising card…');await API.cardPay($('#cn').value,$('#ce').value,$('#cv').value)}
   await finish(m==='upi'?'UPI':'Card',b)}catch(x){if(b.disabled)busy(b,false);await modal({icon:'❌',title:'Payment failed',text:esc(x.message),ok:'Try again',danger:true})}}};draw()}

async function finish(method,btn,payment){try{const t=await API.checkout(S.aadhaar,S.cart,method,payment);receiptView(t)}catch(x){if(btn&&btn.disabled)busy(btn,false);await modal({icon:'⚠️',title:'Transaction failed',text:esc(x.message)});selectView()}}

/* ---------- Dispense + receipt ---------- */
async function receiptView(t){
 $('#app').innerHTML=`<div class="card narrow">${stepper(4)}<div class="em" style="font-size:3rem">⚙️</div><h2>Dispensing…</h2><p class="sub">Please keep your container under the outlet.</p><div class="bar"><i id="pb"></i></div><p id="pl" class="sub"></p></div>`;
 for(const it of t.items){$('#pl').textContent=`Dispensing ${it.qty}kg ${it.name}…`;for(let p=0;p<=100;p+=10){$('#pb').style.width=p+'%';await sleep(60)}}
 $('#app').innerHTML=`<div class="card narrow">${stepper(5)}<svg class="check" viewBox="0 0 52 52"><circle cx="26" cy="26" r="25"/><path d="M14 27l8 8 16-17"/></svg><h2>Collection Complete!</h2><p class="sub">${t.total?'Payment successful.':'Subsidised ration issued.'}</p>
 <div class="rc"><div class="row"><span>Receipt</span><b>${t.id}</b></div><div class="row"><span>Date</span><span>${new Date(t.date).toLocaleString('en-IN')}</span></div><div class="row"><span>Beneficiary</span><span>${esc(t.name)} (${t.type})</span></div>
 ${t.items.map(i=>`<div class="row"><span style="text-transform:capitalize">${i.name} × ${i.qty}kg</span><span>${t.total?inr(i.amt):'Free'}</span></div>`).join('')}
 <div class="row t"><span>Paid via ${t.method}</span><span>${inr(t.total)}</span></div></div>
 <div class="noprint"><button class="btn" id="pr">🖨️ Print Receipt</button><button class="btn ghost" id="dn" style="margin-top:.6rem">Done</button></div></div>`;
 $('#dn').onclick=logout;$('#pr').onclick=()=>printReceipt(t);toast('Ration dispensed successfully 🎉')}
function receiptText(t){return ['SMART RATION DISPENSER - RECEIPT','ID: '+t.id,'Date: '+new Date(t.date).toLocaleString('en-IN'),'Beneficiary: '+t.name+' ('+t.type+')',...t.items.map(i=>`${i.name} x ${i.qty}kg - ${t.total?inr(i.amt):'Free'}`),'Total: '+inr(t.total)+' via '+t.method].join('\n')}
async function printReceipt(t){
 const row=(a,b,c)=>`<div class="r ${c||''}"><span>${a}</span><span>${b}</span></div>`;
 const h=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${t.id}</title><style>body{font-family:Arial,sans-serif;max-width:380px;margin:24px auto;padding:20px;border:1px dashed #888;color:#111}h2{text-align:center;margin:0}p{text-align:center;color:#555;margin:2px 0 16px;font-size:13px}.r{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;text-transform:capitalize}.t{border-top:2px solid #000;margin-top:8px;padding-top:8px;font-weight:bold;font-size:16px}</style></head><body><h2>Smart Ration Dispenser</h2><p>Official Receipt</p>${row('Receipt',esc(t.id))}${row('Date',new Date(t.date).toLocaleString('en-IN'))}${row('Beneficiary',esc(t.name)+' ('+t.type+')')}<hr>${t.items.map(i=>row(i.name+' x '+i.qty+'kg',t.total?inr(i.amt):'Free')).join('')}${row('Paid via '+t.method,inr(t.total),'t')}<p style="margin-top:18px">Thank you!</p></body></html>`;
 let w=null;try{w=window.open('','_blank','width=480,height=680')}catch(e){}
 if(w){w.document.write(h);w.document.close();w.focus();setTimeout(()=>{try{w.print()}catch(e){}},400);return}
 const printPage=await modal({icon:'🖨️',title:'Print window blocked',text:'Your browser blocked the receipt window. You can print this page instead, or copy the receipt text.',ok:'Print this page',cancel:'Copy text'});
 if(printPage){try{window.print()}catch(e){toast('Printing is not available here','error')}}
 else{try{await navigator.clipboard.writeText(receiptText(t));toast('Receipt copied to clipboard')}catch(e){toast('Could not copy automatically','error')}}}

/* ---------- Static pages ---------- */
function support(){$('#app').innerHTML=`<div class="card"><h2>Support Center</h2><p class="sub">Quick answers and ways to reach us.</p><div class="cols"><div><h3>FAQs</h3>
${[['How do I check my Aadhaar status?','Enter your Aadhaar number on the Home page; eligibility is verified before the OTP is sent.'],['What documents are required?','Only your Aadhaar number and your registered mobile number.'],['I did not receive my OTP.','Wait for the 30 second timer and tap Resend. OTPs are valid for 2 minutes with 3 attempts.'],['Can I collect more than once a month?','No. Each card is entitled to one collection per calendar month.']].map(([q,a])=>`<div class="faq"><b>${q}</b><p>${a}</p></div>`).join('')}</div>
<div><h3>Need more help?</h3><p class="sub">📞 Helpline: 9818605770<br>📧 sahilgautam3616@gmail.com</p></div></div></div>`;
 document.querySelectorAll('.faq').forEach(f=>f.onclick=()=>f.classList.toggle('open'))}
function help(){$('#app').innerHTML=`<div class="card"><h2>Help Guide</h2><p class="sub">Collect your ration in five simple steps.</p><ol style="padding-left:1.3rem;line-height:2.1"><li>Enter your 12-digit Aadhaar number</li><li>Verify with the OTP sent to your registered mobile</li><li>Select the items you need within your quota</li><li>Pay via UPI or card (APL only; BPL is free)</li><li>Collect your ration and keep the receipt</li></ol></div>`}
function contact(){$('#app').innerHTML=`<div class="card"><h2>Contact Us</h2><p class="sub">📍 Smart Ration Office, Government Complex, New Delhi · 📞 +91-11-2345-6789 · 📧 info@smartration.com</p><form id="cf" style="max-width:520px"><div class="fg"><label>Name</label><input required></div><div class="fg"><label>Email</label><input type="email" required></div><div class="fg"><label>Message</label><textarea rows="4" required></textarea></div><button class="btn">Send Message</button></form></div>`;
 $('#cf').onsubmit=async e=>{e.preventDefault();const b=e.submitter;busy(b,true,'Sending…');await sleep(900);busy(b,false);e.target.reset();modal({icon:'✅',title:'Message sent',text:'Thanks! Our team will reply within 24 hours.'})}}
function about(){$('#app').innerHTML=`<div class="card"><h2>About SRD</h2><p class="sub">Efficient, transparent distribution of essential commodities through a digital platform.</p><div class="stats">${['🔐 OTP-secured access','📊 Real-time stock','💳 Digital payments','🧾 Transparent receipts'].map(x=>`<div class="stat"><b style="font-size:1.1rem">${x}</b></div>`).join('')}</div></div>`}

/* ---------- Admin ---------- */
async function admin(){
 if(!adminToken){$('#app').innerHTML=`<div class="card narrow"><h2>Admin Login</h2><p class="sub">Enter the admin password</p><div class="fg"><input id="pin" type="password" placeholder="Password" autocomplete="current-password"></div><button class="btn" id="al">Login</button></div>`;
  const f=async()=>{try{adminToken=(await http('/admin/login',{password:$('#pin').value})).token;toast('Admin access granted');admin()}catch(x){toast(x.message,'error');$('#pin').value=''}};$('#al').onclick=f;$('#pin').onkeydown=e=>{if(e.key==='Enter')f()};return}
 let d;try{d=await http('/admin/summary',null,adminToken)}catch(x){adminToken=null;toast(x.message,'error');return admin()}
 const st=fix(d.stock),rev=d.tx.reduce((s,t)=>s+t.total,0),low=Object.values(st).filter(s=>s.q<100).length;
 $('#app').innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem"><h2>Admin Dashboard</h2><button class="btn ghost sm" id="ao">Logout</button></div>
 <div class="stats"><div class="stat"><b>${d.tx.length}</b><span>Recent transactions</span></div><div class="stat"><b>${inr(rev)}</b><span>Revenue (recent)</span></div><div class="stat"><b>${low}</b><span>Low-stock items</span></div><div class="stat"><b>${d.users.length}</b><span>Beneficiaries</span></div></div>
 <h3>Stock</h3><div style="overflow-x:auto"><table><tr><th>Item</th><th>Qty (kg)</th><th>Price/kg</th><th></th></tr>${Object.entries(st).map(([k,s])=>`<tr><td style="text-transform:capitalize">${s.ic} ${k}</td><td style="color:${s.q<100?'var(--err)':'inherit'}">${s.q}</td><td>${inr(s.p)}</td><td><button class="btn sm" data-k="${k}">Restock</button></td></tr>`).join('')}</table></div>
 <h3 style="margin-top:1.5rem">Register beneficiary</h3><form id="bf" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem"><input id="bc" placeholder="Aadhaar no. (12 digits)" inputmode="numeric" maxlength="12" required><input id="bn" placeholder="Full name" required><input id="bm" placeholder="Mobile (10 digits)" inputmode="numeric" maxlength="10" required><select id="bt"><option>BPL</option><option>APL</option></select><button class="btn">Add</button></form>
 <h3 style="margin-top:1.5rem">Beneficiaries</h3><div style="overflow-x:auto"><table><tr><th>Aadhaar</th><th>Name</th><th>Type</th><th>Mobile</th><th>Last collected</th></tr>${d.users.map(u=>`<tr><td>${esc(u.card)}</td><td>${esc(u.name)}</td><td>${u.type}</td><td>${u.mobile}</td><td>${u.last||'—'}</td></tr>`).join('')||'<tr><td colspan="5" style="color:var(--mut)">None yet</td></tr>'}</table></div>
 <h3 style="margin-top:1.5rem">Recent transactions</h3><div style="overflow-x:auto"><table><tr><th>ID</th><th>User</th><th>Items</th><th>Total</th><th>Method</th></tr>${d.tx.slice(0,10).map(t=>`<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${t.items.map(i=>i.qty+'kg '+i.name).join(', ')}</td><td>${inr(t.total)}</td><td>${t.method}</td></tr>`).join('')||'<tr><td colspan="5" style="color:var(--mut)">No transactions yet</td></tr>'}</table></div></div>`;
 $('#ao').onclick=()=>{adminToken=null;admin()};
 $('#bm').oninput=e=>e.target.value=e.target.value.replace(/\D/g,'');$('#bc').oninput=e=>e.target.value=e.target.value.replace(/\D/g,'');
 $('#bf').onsubmit=async e=>{e.preventDefault();try{await http('/admin/users',{card:$('#bc').value,name:$('#bn').value,mobile:$('#bm').value,type:$('#bt').value},adminToken);toast('Beneficiary added');admin()}catch(x){toast(x.message,'error')}};
 document.querySelectorAll('[data-k]').forEach(b=>b.onclick=async()=>{const k=b.dataset.k;if(await modal({icon:'📦',title:'Restock '+k,text:'<input id="rsq" type="number" min="1" value="100" style="text-align:center">',ok:'Add kg',cancel:'Cancel'})){try{await http('/admin/restock',{item:k,qty:parseInt($('#rsq').value,10)},adminToken);toast('Stock updated');admin()}catch(x){toast(x.message,'error')}}})}

/* ---------- Boot ---------- */
function setTheme(t){document.documentElement.dataset.theme=t;$('#theme').textContent=t==='dark'?'☀️':'🌙'}
$('#theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
setTheme(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
render(location.hash.slice(1)||'home');
