# Smart Ration Dispenser

    srd-project/
      frontend/   index.html  style.css  script.js  srd-logo.png   (what users see)
      backend/    server.js   package.json  .env.example           (Node/Express API: OTP, SMS, stock, payments)

## Run
1. Install Node.js 18+ (https://nodejs.org), then CLOSE and reopen your terminal.
2. Windows: double-click `start-windows.bat`.   Mac/Linux:  cd backend && npm install && npm start
3. Open http://localhost:3000  (the backend serves the frontend - do not open index.html directly).

Dev mode (no .env): demo Aadhaar numbers 123456789012 (BPL) / 987654321098 (APL), OTP shown on screen, admin password `admin123`, payments simulated.
For real SMS + Razorpay: copy backend/.env.example to backend/.env and fill it in.

## Run in VS Code
1. File > Open Folder > select `srd-project`.
2. Press **F5** (Run > Start Debugging). It installs dependencies and starts the server in VS Code's terminal.
3. Open http://localhost:3000 (Ctrl+click the link in the terminal).
Or use Terminal > New Terminal, then: `cd backend`, `npm install`, `npm start`.
