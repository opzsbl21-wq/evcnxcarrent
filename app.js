Skip to content
opzsbl21-wq
evcnxcarrent
Repository navigation
Code
Issues
Pull requests
Actions
Projects
Wiki
Security and quality
Insights
Settings
Files
Go to file
t
T
Code (1).gs
app (2).js
app.js
icon-192.png
icon-512.png
index (2).html
index (3).html
index.html
manifest.json
sw.js
evcnxcarrent
/
app (2).js
in
main

Edit

Preview
Indent mode

Spaces
Indent size

2
Line wrap mode

No wrap
Editing app (2).js file contents
  1
  2
  3
  4
  5
  6
  7
  8
  9
 10
 11
 12
 13
 14
 15
 16
 17
 18
 19
 20
 21
 22
 23
 24
 25
 26
 27
 28
 29
 30
 31
 32
 33
 34
 35
 36
 37
 38
 39
 40
 41
 42
 43
 44
 45
 46
 47
 48
 49
 50
 51
 52
 53
 54
 55
 56
 57
 58
 59
 60
 61
 62
/* =========================================================
   EV CNX VIENTIANE — Fleet Portal
   -------------------------------------------------------
   CONFIG: paste your deployed Google Apps Script Web App
   URL below to connect to live Google Sheets data.
   Leave it as null to run in DEMO MODE with sample data
   (nothing is sent anywhere, everything lives in the browser).
   ========================================================= */
const API_URL = "https://script.google.com/macros/s/AKfycbxx7xdBN8QE0qF6JLqXADVBkQYh6UCSBzmBZG273UI8O6S6X0CUVJ6ijhqE4rVaqQTUfw/exec";

const OVERTIME_GRACE_HOURS = 2;
const OVERTIME_RATE_PER_HOUR_THB = 100;

let session = JSON.parse(localStorage.getItem('evcnx_session') || 'null');
let currentCurrency = { admin: 'THB', account: 'THB' };
let exchangeRateTHBtoLAK = 650; // fallback, overwritten by Settings sheet when live

/* ---------------------------------------------------------
   DEMO DATA (used only when API_URL is null)
--------------------------------------------------------- */
const DEMO = {
  users: [
    { email: 'admin@evcnx.la', name: 'Admin', role: 'admin' },
    { email: 'staff@evcnx.la', name: 'พนักงานรับ-ส่งรถ', role: 'field' },
    { email: 'account@evcnx.la', name: 'ฝ่ายบัญชี', role: 'accounting' },
    { email: 'owner@evcnx.la', name: 'เจ้าของกิจการ', role: 'owner' }
  ],
  cars: [
    { plate: 'EV01', model: 'Aion Y Plus 510', status: 'ว่าง', mileage: 15000, price: 2000, photo: '' },
    { plate: 'EV02', model: 'Aion Y Plus 430', status: 'ว่าง', mileage: 8000, price: 2000, photo: '' },
    { plate: 'กร7648', model: 'Aion Y Plus', status: 'ถูกเช่า', mileage: 11000, price: 1800, photo: '' }
  ],
  bookings: [
    { id: 'BK-1001', plate: 'กร7648', customer: 'คุณสมชาย', phone: '020 5551234', pickup: '2026-07-15T09:00', dueReturn: '2026-07-18T09:00', actualReturn: null, status: 'ถูกเช่า', assignedTo: 'staff@evcnx.la', total: 5400, paymentStatus: 'pending', depositStatus: 'วางแล้ว', depositAmount: 3000 },
    { id: 'BK-1000', plate: 'EV01', customer: 'Ms. Amporn', phone: '020 5559876', pickup: '2026-07-10T10:00', dueReturn: '2026-07-12T10:00', actualReturn: '2026-07-12T11:20', status: 'คืนแล้ว', assignedTo: 'staff@evcnx.la', total: 4000, paymentStatus: 'paid', depositStatus: 'คืนแล้ว', depositAmount: 3000 }
  ],
  promotions: [
    { id: 'P1', minDays: 3, type: 'percent', value: 10, scope: 'ALL' }
  ],
  transactions: [
    { id: 'TX-1', type: 'expense', category: 'ค่าเช่าสำนักงาน', desc: 'ค่าเช่าที่จอดรถประจำเดือน', amount: 8000, date: '2026-07-01' },
    { id: 'TX-2', type: 'expense', category: 'ค่าซ่อมรถ', desc: 'เปลี่ยนยาง EV02', amount: 3500, date: '2026-07-05' },
    { id: 'TX-3', type: 'income', category: 'รายรับอื่นๆ', desc: 'ค่าบริการส่งรถนอกสถานที่', amount: 500, date: '2026-07-06' }
  ]
};

/* ---------------------------------------------------------
   API bridge — swap between demo mode and live Apps Script
--------------------------------------------------------- */
async function api(action, payload) {
  if (!API_URL) return demoApi(action, payload);
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, payload })
  });
  if (!res.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
  return res.json();
}

function demoApi(action, payload) {
  switch (action) {
    case 'login': {
Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
 
