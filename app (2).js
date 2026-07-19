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
      const u = DEMO.users.find(x => x.email.toLowerCase() === (payload.email || '').toLowerCase());
      if (!u || !payload.pin || payload.pin.length < 4) return { ok: false, error: 'อีเมลหรือ PIN ไม่ถูกต้อง' };
      return { ok: true, user: u };
    }
    case 'getAll':
      return { ok: true, cars: DEMO.cars, bookings: DEMO.bookings, promotions: DEMO.promotions, users: DEMO.users, exchangeRate: exchangeRateTHBtoLAK };
    case 'saveCar': {
      const idx = DEMO.cars.findIndex(c => c.plate === payload.plate);
      if (idx >= 0) DEMO.cars[idx] = payload; else DEMO.cars.push(payload);
      return { ok: true };
    }
    case 'savePromo':
      DEMO.promotions.push({ id: 'P' + (DEMO.promotions.length + 1), ...payload });
      return { ok: true };
    case 'saveStaff':
      DEMO.users.push({ email: payload.email, name: payload.name, role: payload.role });
      return { ok: true };
    case 'saveBooking':
      DEMO.bookings.unshift({ id: 'BK-' + (1000 + DEMO.bookings.length + 1), ...payload });
      return { ok: true };
    case 'saveTransaction':
      DEMO.transactions.unshift({ id: 'TX-' + (DEMO.transactions.length + 1), ...payload });
      return { ok: true };
    case 'checkIO': {
      const b = DEMO.bookings.find(x => x.id === payload.bookingId);
      if (b) {
        if (payload.type === 'return') b.actualReturn = new Date().toISOString();
        b.status = payload.type === 'return' ? 'คืนแล้ว' : 'ถูกเช่า';
      }
      const c = DEMO.cars.find(x => x.plate === payload.plate);
      if (c) { c.mileage = payload.mileage; c.status = payload.status; }
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown action' };
  }
}

/* ---------------------------------------------------------
   Rental calculation
   days = full 24h blocks between pickup and return
   grace: <= 2h over a day boundary is free
   overtime: > 2h over is billed at 100 THB / hour
   promo: best matching promotion (by minDays) is applied to the
   per-day rate before overtime is added
--------------------------------------------------------- */
function calcRental(pickupISO, returnISO, dailyRate, promotions, plate) {
  const pickup = new Date(pickupISO);
  const ret = new Date(returnISO);
  const ms = ret - pickup;
  const totalHours = ms / 36e5;
  const fullDays = Math.floor(totalHours / 24);
  const remainderHours = totalHours - fullDays * 24;

  let billedDays = fullDays;
  let overtimeHours = 0;
  let overtimeFee = 0;

  if (remainderHours > OVERTIME_GRACE_HOURS) {
    overtimeHours = Math.ceil(remainderHours);
    overtimeFee = overtimeHours * OVERTIME_RATE_PER_HOUR_THB;
  }
  if (billedDays < 1) billedDays = 1; // minimum 1 day rental

  // pick the best applicable promo (highest minDays that still qualifies)
  let rate = dailyRate;
  const applicable = (promotions || [])
    .filter(p => (p.scope === 'ALL' || p.scope === plate) && billedDays >= Number(p.minDays))
    .sort((a, b) => Number(b.minDays) - Number(a.minDays));
  const promo = applicable[0];
  if (promo) {
    rate = promo.type === 'percent'
      ? dailyRate * (1 - Number(promo.value) / 100)
      : Number(promo.value);
  }

  const totalTHB = Math.round(billedDays * rate + overtimeFee);
  return { billedDays, overtimeHours, overtimeFee, totalTHB, appliedPromo: promo || null };
}

function toLAK(thb) { return Math.round(thb * exchangeRateTHBtoLAK); }
function fmt(n) { return Number(n).toLocaleString('en-US'); }

/* ---------------------------------------------------------
   Session / routing
--------------------------------------------------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!email || !pin) { errEl.textContent = 'กรุณากรอกอีเมลและ PIN'; return; }
  try {
    const res = await api('login', { email, pin });
    if (!res.ok) { errEl.textContent = res.error || 'เข้าสู่ระบบไม่สำเร็จ'; return; }
    session = res.user;
    localStorage.setItem('evcnx_session', JSON.stringify(session));
    routeToRole();
  } catch (e) {
    errEl.textContent = 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่';
  }
}

function logout() {
  session = null;
  localStorage.removeItem('evcnx_session');
  document.getElementById('login-email').value = '';
  document.getElementById('login-pin').value = '';
  showScreen('login-screen');
}

function routeToRole() {
  if (!session) return showScreen('login-screen');
  if (session.role === 'admin') { showScreen('admin-screen'); renderAdmin(); }
  else if (session.role === 'field') { showScreen('field-screen'); renderField(); }
  else if (session.role === 'accounting') { showScreen('account-screen'); renderAccounting(); }
  else if (session.role === 'owner') { showScreen('owner-screen'); renderOwner(); }
}

/* ---------------------------------------------------------
   Admin
--------------------------------------------------------- */
let ADMIN_DATA = null;

async function renderAdmin() {
  const res = await api('getAll', {});
  if (!res.ok) return toast('โหลดข้อมูลไม่สำเร็จ');
  ADMIN_DATA = res;
  exchangeRateTHBtoLAK = res.exchangeRate || exchangeRateTHBtoLAK;
  renderAdminStats();
  renderAdminBookingsTable();
  renderAdminRecentBookings();
  renderAdminCarsTable();
  renderAdminPromosList();
  renderAdminStaffTable();
}

function renderAdminStats() {
  const cur = currentCurrency.admin;
  const totalRevenue = ADMIN_DATA.bookings.reduce((s, b) => s + (b.total || 0), 0);
  const availableCars = ADMIN_DATA.cars.filter(c => c.status === 'ว่าง').length;
  const activeBookings = ADMIN_DATA.bookings.filter(b => b.status === 'ถูกเช่า').length;
  const money = v => cur === 'THB' ? `฿${fmt(v)}` : `₭${fmt(toLAK(v))}`;
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card"><div class="stat-accent"></div><div class="stat-label">รายได้รวม</div><div class="stat-value mono">${money(totalRevenue)}</div></div>
    <div class="stat-card"><div class="stat-label">รถว่าง</div><div class="stat-value mono">${availableCars} / ${ADMIN_DATA.cars.length}</div></div>
    <div class="stat-card"><div class="stat-label">กำลังเช่าอยู่</div><div class="stat-value mono">${activeBookings}</div></div>
  `;
}

function renderAdminRecentBookings() {
  const el = document.getElementById('admin-recent-bookings');
  if (!ADMIN_DATA.bookings.length) return el.innerHTML = '<div class="empty-state">ยังไม่มีการจอง</div>';
  el.innerHTML = ADMIN_DATA.bookings.slice(0, 5).map(b => `
    <div class="row-item">
      <div><div class="row-item-main">${b.customer} &middot; ${b.plate}</div><div class="row-item-sub">${b.id}</div></div>
      <span class="badge ${b.status === 'ถูกเช่า' ? 'badge-rented' : 'badge-available'}">${b.status}</span>
    </div>`).join('');
}

function renderAdminBookingsTable() {
  const el = document.getElementById('admin-bookings-table');
  const cur = currentCurrency.admin;
  const money = v => cur === 'THB' ? `฿${fmt(v)}` : `₭${fmt(toLAK(v))}`;
  el.innerHTML = ADMIN_DATA.bookings.map(b => `
    <tr>
      <td class="mono">${b.id}</td><td>${b.plate}</td><td>${b.customer}</td>
      <td class="mono">${b.pickup.replace('T',' ')}</td><td class="mono">${b.dueReturn.replace('T',' ')}</td>
      <td><span class="badge ${b.status === 'ถูกเช่า' ? 'badge-rented' : 'badge-available'}">${b.status}</span></td>
      <td class="mono">${money(b.total)}</td>
    </tr>`).join('');
}

function renderAdminCarsTable() {
  const el = document.getElementById('admin-cars-table');
  el.innerHTML = ADMIN_DATA.cars.map(c => `
    <tr>
      <td class="mono">${c.plate}</td><td>${c.model}</td>
      <td><span class="badge ${c.status === 'ว่าง' ? 'badge-available' : 'badge-rented'}">${c.status}</span></td>
      <td class="mono">${fmt(c.mileage)}</td><td class="mono">฿${fmt(c.price)}</td>
      <td><span style="cursor:pointer;color:var(--green);font-size:12px;" onclick='openCarModal(${JSON.stringify(c)})'>แก้ไข</span></td>
    </tr>`).join('');
}

function renderAdminPromosList() {
  const el = document.getElementById('admin-promos-list');
  if (!ADMIN_DATA.promotions.length) return el.innerHTML = '<div class="empty-state">ยังไม่มีโปรโมชั่น</div>';
  el.innerHTML = ADMIN_DATA.promotions.map(p => `
    <div class="row-item">
      <div><div class="row-item-main">เช่า ${p.minDays} วันขึ้นไป</div><div class="row-item-sub">${p.scope === 'ALL' ? 'ทุกคัน' : p.scope}</div></div>
      <span class="gold-tag">${p.type === 'percent' ? '-' + p.value + '%' : '฿' + fmt(p.value) + '/วัน'}</span>
    </div>`).join('');
}

function renderAdminStaffTable() {
  const el = document.getElementById('admin-staff-table');
  const roleLabel = r => r === 'admin' ? 'Admin' : r === 'field' ? 'พนักงานรับ-ส่งรถ' : 'ฝ่ายบัญชี';
  el.innerHTML = ADMIN_DATA.users.map(u => `
    <tr><td>${u.name}</td><td class="mono">${u.email}</td><td>${roleLabel(u.role)}</td></tr>`).join('');
}

/* admin tabs */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#admin-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#admin-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
      document.getElementById('admin-panel-' + tab.dataset.tab).style.display = 'block';
    });
  });
  document.querySelectorAll('#admin-currency-toggle button, #account-currency-toggle button, #owner-currency-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const scope = btn.closest('#admin-currency-toggle') ? 'admin' : btn.closest('#account-currency-toggle') ? 'account' : 'owner';
      btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency[scope] = btn.dataset.cur;
      if (scope === 'admin') { renderAdminStats(); renderAdminBookingsTable(); }
      else if (scope === 'account') renderAccountingStats();
      else renderOwnerStats();
    });
  });

  if (session) routeToRole();
});

/* car modal */
function openCarModal(car) {
  document.getElementById('car-plate').value = car ? car.plate : '';
  document.getElementById('car-plate').disabled = !!car;
  document.getElementById('car-model').value = car ? car.model : '';
  document.getElementById('car-price').value = car ? car.price : '';
  document.getElementById('car-status').value = car ? car.status : 'ว่าง';
  document.getElementById('car-modal').classList.add('active');
}
async function submitCar() {
  const car = {
    plate: document.getElementById('car-plate').value.trim(),
    model: document.getElementById('car-model').value.trim(),
    price: Number(document.getElementById('car-price').value || 0),
    status: document.getElementById('car-status').value,
    mileage: (ADMIN_DATA.cars.find(c => c.plate === document.getElementById('car-plate').value.trim()) || {}).mileage || 0
  };
  if (!car.plate || !car.model) return toast('กรอกทะเบียนและรุ่นให้ครบ');
  await api('saveCar', car);
  closeModal('car-modal');
  toast('บันทึกข้อมูลรถแล้ว');
  renderAdmin();
}

/* promo modal */
function openPromoModal() {
  document.getElementById('promo-mindays').value = '';
  document.getElementById('promo-value').value = '';
  const scopeSel = document.getElementById('promo-scope');
  scopeSel.innerHTML = '<option value="ALL">ทุกคัน</option>' +
    (ADMIN_DATA ? ADMIN_DATA.cars.map(c => `<option value="${c.plate}">${c.plate} — ${c.model}</option>`).join('') : '');
  document.getElementById('promo-modal').classList.add('active');
}
async function submitPromo() {
  const promo = {
    minDays: Number(document.getElementById('promo-mindays').value || 0),
    type: document.getElementById('promo-type').value,
    value: Number(document.getElementById('promo-value').value || 0),
    scope: document.getElementById('promo-scope').value
  };
  if (!promo.minDays || !promo.value) return toast('กรอกข้อมูลโปรโมชั่นให้ครบ');
  await api('savePromo', promo);
  closeModal('promo-modal');
  toast('บันทึกโปรโมชั่นแล้ว');
  renderAdmin();
}

/* staff modal */
function openStaffModal() {
  ['staff-name', 'staff-email', 'staff-pin'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('staff-modal').classList.add('active');
}
async function submitStaff() {
  const staff = {
    name: document.getElementById('staff-name').value.trim(),
    email: document.getElementById('staff-email').value.trim(),
    pin: document.getElementById('staff-pin').value.trim(),
    role: document.getElementById('staff-role').value
  };
  if (!staff.name || !staff.email || !staff.pin) return toast('กรอกข้อมูลพนักงานให้ครบ');
  await api('saveStaff', staff);
  closeModal('staff-modal');
  toast('เพิ่มพนักงานแล้ว');
  renderAdmin();
}

/* ---------------------------------------------------------
   Field staff
--------------------------------------------------------- */
let FIELD_DATA = null;
let activeCheckIO = null;
let checkioPhotoData = null;

async function renderField() {
  const res = await api('getAll', {});
  if (!res.ok) return toast('โหลดข้อมูลไม่สำเร็จ');
  FIELD_DATA = res;
  const myJobs = res.bookings.filter(b => b.assignedTo === session.email && b.status !== 'คืนแล้ว');
  const jobsEl = document.getElementById('field-jobs-list');
  jobsEl.innerHTML = myJobs.length ? myJobs.map(b => `
    <div class="row-item">
      <div><div class="row-item-main">${b.customer} &middot; ${b.plate}</div><div class="row-item-sub">กำหนดคืน: ${b.dueReturn.replace('T',' ')}</div></div>
      <button class="btn btn-primary btn-sm" onclick='openCheckIO("return", ${JSON.stringify(b)})'>เช็คคืนรถ</button>
    </div>`).join('') : '<div class="empty-state">วันนี้ไม่มีคิวที่ต้องรับผิดชอบ</div>';

  const carsEl = document.getElementById('field-cars-list');
  carsEl.innerHTML = res.cars.map(c => `
    <div class="row-item">
      <div><div class="row-item-main">${c.plate} &middot; ${c.model}</div><div class="row-item-sub">เลขไมล์ ${fmt(c.mileage)} กม.</div></div>
      <div style="display:flex; gap:8px; align-items:center;">
        <span class="badge ${c.status === 'ว่าง' ? 'badge-available' : 'badge-rented'}">${c.status}</span>
        <button class="btn btn-ghost btn-sm" onclick='openCheckIO("pickup", null, ${JSON.stringify(c)})'>รับรถ</button>
      </div>
    </div>`).join('');
}

function openCheckIO(type, booking, car) {
  activeCheckIO = { type, booking, car: car || (booking ? FIELD_DATA.cars.find(c => c.plate === booking.plate) : null) };
  checkioPhotoData = null;
  document.getElementById('checkio-title').textContent = type === 'pickup' ? 'รับรถ' : 'คืนรถ';
  document.getElementById('checkio-mileage').value = activeCheckIO.car ? activeCheckIO.car.mileage : '';
  document.getElementById('checkio-status').value = type === 'pickup' ? 'ถูกเช่า' : 'ว่าง';
  document.getElementById('checkio-upload-label').textContent = 'แตะเพื่อถ่าย/เลือกรูป';
  document.getElementById('checkio-modal').classList.add('active');
}

function handlePhotoPreview(evt, target) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    checkioPhotoData = e.target.result;
    const box = document.getElementById(target + '-upload-box');
    box.innerHTML = `<img src="${checkioPhotoData}"><input type="file" accept="image/*" capture="environment" onchange="handlePhotoPreview(event,'${target}')">`;
  };
  reader.readAsDataURL(file);
}

async function submitCheckIO() {
  if (!activeCheckIO) return;
  const mileage = Number(document.getElementById('checkio-mileage').value || 0);
  const status = document.getElementById('checkio-status').value;
  const payload = {
    type: activeCheckIO.type,
    bookingId: activeCheckIO.booking ? activeCheckIO.booking.id : null,
    plate: activeCheckIO.car.plate,
    mileage, status,
    photo: checkioPhotoData
  };
  await api('checkIO', payload);
  closeModal('checkio-modal');
  toast(activeCheckIO.type === 'pickup' ? 'บันทึกการรับรถแล้ว' : 'บันทึกการคืนรถแล้ว');
  renderField();
}

/* ---------------------------------------------------------
   Accounting
--------------------------------------------------------- */
let ACCOUNT_DATA = null;

async function renderAccounting() {
  const res = await api('getAll', {});
  if (!res.ok) return toast('โหลดข้อมูลไม่สำเร็จ');
  ACCOUNT_DATA = res;
  exchangeRateTHBtoLAK = res.exchangeRate || exchangeRateTHBtoLAK;
  renderAccountingStats();
  renderAccountingPayments();
  renderAccountingDeposits();
  renderAccountingTransactions();
}

function renderAccountingStats() {
  const cur = currentCurrency.account;
  const money = v => cur === 'THB' ? `฿${fmt(v)}` : `₭${fmt(toLAK(v))}`;
  const rentalRevenue = ACCOUNT_DATA.bookings.reduce((s, b) => s + (b.total || 0), 0);
  const txIncome = (ACCOUNT_DATA.transactions || []).filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const txExpense = (ACCOUNT_DATA.transactions || []).filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalIncome = rentalRevenue + txIncome;
  document.getElementById('account-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">รายรับรวมทั้งหมด</div><div class="stat-value mono">${money(totalIncome)}</div></div>
    <div class="stat-card"><div class="stat-label">รายจ่ายรวมทั้งหมด</div><div class="stat-value mono">${money(txExpense)}</div></div>
    <div class="stat-card"><div class="stat-label">กำไร/ขาดทุนสุทธิ</div><div class="stat-value mono">${money(totalIncome - txExpense)}</div></div>
  `;
}

function renderAccountingTransactions() {
  const el = document.getElementById('account-transactions-list');
  const list = ACCOUNT_DATA.transactions || [];
  if (!list.length) return el.innerHTML = '<div class="empty-state">ยังไม่มีรายการ</div>';
  el.innerHTML = list.map(t => `
    <div class="row-item">
      <div><div class="row-item-main">${t.category}</div><div class="row-item-sub">${t.desc || ''} &middot; ${t.date}</div></div>
      <span class="badge ${t.type === 'income' ? 'badge-available' : 'badge-pending'}">${t.type === 'income' ? '+' : '-'}฿${fmt(t.amount)}</span>
    </div>`).join('');
}

function renderAccountingPayments() {
  const el = document.getElementById('account-payments-list');
  el.innerHTML = ACCOUNT_DATA.bookings.map(b => `
    <div class="row-item">
      <div><div class="row-item-main">${b.id} &middot; ${b.customer}</div><div class="row-item-sub">${b.plate}</div></div>
      <span class="badge ${b.paymentStatus === 'paid' ? 'badge-paid' : 'badge-pending'}">${b.paymentStatus === 'paid' ? 'จ่ายแล้ว' : 'ค้างจ่าย'}</span>
    </div>`).join('');
}

function renderAccountingDeposits() {
  const el = document.getElementById('account-deposit-list');
  el.innerHTML = ACCOUNT_DATA.bookings.map(b => `
    <div class="row-item">
      <div><div class="row-item-main">${b.id} &middot; ${b.customer}</div><div class="row-item-sub">เงินประกัน ฿${fmt(b.depositAmount || 0)}</div></div>
      <span class="badge ${b.depositStatus === 'คืนแล้ว' ? 'badge-available' : 'badge-rented'}">${b.depositStatus}</span>
    </div>`).join('');
}

/* booking modal */
function openBookingModal() {
  ['booking-customer', 'booking-phone', 'booking-deposit'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('booking-preview').textContent = '';
  const carSel = document.getElementById('booking-car');
  carSel.innerHTML = ADMIN_DATA.cars.map(c => `<option value="${c.plate}">${c.plate} — ${c.model} (฿${fmt(c.price)}/วัน)</option>`).join('');
  const staffSel = document.getElementById('booking-staff');
  staffSel.innerHTML = ADMIN_DATA.users.filter(u => u.role === 'field').map(u => `<option value="${u.email}">${u.name}</option>`).join('');
  document.getElementById('booking-modal').classList.add('active');
  [carSel, staffSel, document.getElementById('booking-pickup'), document.getElementById('booking-return')]
    .forEach(el => el.onchange = updateBookingPreview);
}

function updateBookingPreview() {
  const plate = document.getElementById('booking-car').value;
  const pickup = document.getElementById('booking-pickup').value;
  const ret = document.getElementById('booking-return').value;
  const car = ADMIN_DATA.cars.find(c => c.plate === plate);
  const preview = document.getElementById('booking-preview');
  if (!car || !pickup || !ret) { preview.textContent = ''; return; }
  const calc = calcRental(pickup, ret, Number(car.price), ADMIN_DATA.promotions, plate);
  preview.innerHTML = `${calc.billedDays} วัน${calc.overtimeHours ? ` + ล่วงเวลา ${calc.overtimeHours} ชม. (฿${fmt(calc.overtimeFee)})` : ''}${calc.appliedPromo ? ' · ใช้โปรโมชั่นแล้ว' : ''}<br>ยอดรวมโดยประมาณ: ฿${fmt(calc.totalTHB)}`;
}

async function submitBooking() {
  const plate = document.getElementById('booking-car').value;
  const pickup = document.getElementById('booking-pickup').value;
  const dueReturn = document.getElementById('booking-return').value;
  const customer = document.getElementById('booking-customer').value.trim();
  const phone = document.getElementById('booking-phone').value.trim();
  const assignedTo = document.getElementById('booking-staff').value;
  const depositAmount = Number(document.getElementById('booking-deposit').value || 0);
  if (!customer || !phone || !plate || !pickup || !dueReturn) return toast('กรอกข้อมูลการจองให้ครบ');
  const car = ADMIN_DATA.cars.find(c => c.plate === plate);
  const calc = calcRental(pickup, dueReturn, Number(car.price), ADMIN_DATA.promotions, plate);
  const booking = {
    plate, customer, phone, pickup, dueReturn, actualReturn: null,
    status: 'ถูกเช่า', assignedTo, total: calc.totalTHB,
    paymentStatus: 'pending', depositStatus: depositAmount ? 'วางแล้ว' : 'ไม่มี', depositAmount
  };
  await api('saveBooking', booking);
  closeModal('booking-modal');
  toast('บันทึกการจองแล้ว');
  renderAdmin();
}

/* transaction modal (accounting) */
function openTransactionModal() {
  ['tx-category', 'tx-desc', 'tx-amount'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('transaction-modal').classList.add('active');
}
async function submitTransaction() {
  const tx = {
    type: document.getElementById('tx-type').value,
    category: document.getElementById('tx-category').value.trim(),
    desc: document.getElementById('tx-desc').value.trim(),
    amount: Number(document.getElementById('tx-amount').value || 0),
    date: document.getElementById('tx-date').value
  };
  if (!tx.category || !tx.amount || !tx.date) return toast('กรอกข้อมูลรายการให้ครบ');
  await api('saveTransaction', tx);
  closeModal('transaction-modal');
  toast('บันทึกรายการแล้ว');
  renderAccounting();
}

/* ---------------------------------------------------------
   Owner
--------------------------------------------------------- */
let OWNER_DATA = null;

async function renderOwner() {
  const res = await api('getAll', {});
  if (!res.ok) return toast('โหลดข้อมูลไม่สำเร็จ');
  OWNER_DATA = res;
  exchangeRateTHBtoLAK = res.exchangeRate || exchangeRateTHBtoLAK;
  renderOwnerStats();
  renderOwnerDaily();
  renderOwnerOverview();
  renderOwnerCustomers();
}

function renderOwnerStats() {
  const cur = currentCurrency.owner;
  const money = v => cur === 'THB' ? `฿${fmt(v)}` : `₭${fmt(toLAK(v))}`;
  const rentalRevenue = OWNER_DATA.bookings.reduce((s, b) => s + (b.total || 0), 0);
  const txIncome = (OWNER_DATA.transactions || []).filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const txExpense = (OWNER_DATA.transactions || []).filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalIncome = rentalRevenue + txIncome;
  const profit = totalIncome - txExpense;
  document.getElementById('owner-stats').innerHTML = `
    <div class="stat-card"><div class="stat-accent"></div><div class="stat-label">รายได้รวมทั้งหมด</div><div class="stat-value mono">${money(totalIncome)}</div></div>
    <div class="stat-card"><div class="stat-label">รายจ่ายรวมทั้งหมด</div><div class="stat-value mono">${money(txExpense)}</div></div>
    <div class="stat-card"><div class="stat-label">${profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}</div><div class="stat-value mono" style="color:${profit >= 0 ? 'var(--green)' : 'var(--danger)'}">${money(Math.abs(profit))}</div></div>
  `;
}

function renderOwnerDaily() {
  const days = {};
  OWNER_DATA.bookings.forEach(b => {
    const day = (b.pickup || '').slice(0, 10);
    if (!day) return;
    days[day] = days[day] || { revenue: 0, expense: 0 };
    days[day].revenue += Number(b.total || 0);
  });
  (OWNER_DATA.transactions || []).forEach(t => {
    const day = t.date;
    if (!day) return;
    days[day] = days[day] || { revenue: 0, expense: 0 };
    if (t.type === 'income') days[day].revenue += Number(t.amount || 0);
    else days[day].expense += Number(t.amount || 0);
  });
  const sortedDays = Object.keys(days).sort((a, b) => b.localeCompare(a)).slice(0, 7);
  const el = document.getElementById('owner-daily-table');
  if (!sortedDays.length) { el.innerHTML = '<tr><td colspan="4" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  el.innerHTML = sortedDays.map(day => {
    const d = days[day];
    const net = d.revenue - d.expense;
    return `<tr>
      <td class="mono">${day}</td>
      <td class="mono">฿${fmt(d.revenue)}</td>
      <td class="mono">฿${fmt(d.expense)}</td>
      <td class="mono" style="color:${net >= 0 ? 'var(--green)' : 'var(--danger)'}">${net >= 0 ? '+' : '-'}฿${fmt(Math.abs(net))}</td>
    </tr>`;
  }).join('');
}

function renderOwnerOverview() {
  const totalCars = OWNER_DATA.cars.length;
  const availableCars = OWNER_DATA.cars.filter(c => c.status === 'ว่าง').length;
  const activeBookings = OWNER_DATA.bookings.filter(b => b.status === 'ถูกเช่า').length;
  const uniqueCustomers = new Set(OWNER_DATA.bookings.map(b => b.phone || b.customer)).size;
  document.getElementById('owner-overview').innerHTML = `
    <div class="stat-card"><div class="stat-label">รถทั้งหมด</div><div class="stat-value mono">${totalCars}</div></div>
    <div class="stat-card"><div class="stat-label">รถว่าง</div><div class="stat-value mono">${availableCars} / ${totalCars}</div></div>
    <div class="stat-card"><div class="stat-label">กำลังเช่าอยู่</div><div class="stat-value mono">${activeBookings}</div></div>
    <div class="stat-card"><div class="stat-label">ลูกค้าทั้งหมด</div><div class="stat-value mono">${uniqueCustomers}</div></div>
    <div class="stat-card"><div class="stat-label">พนักงานทั้งหมด</div><div class="stat-value mono">${OWNER_DATA.users.length}</div></div>
    <div class="stat-card"><div class="stat-label">โปรโมชั่นที่ใช้งานอยู่</div><div class="stat-value mono">${OWNER_DATA.promotions.length}</div></div>
  `;
}

function renderOwnerCustomers() {
  const byPhone = {};
  OWNER_DATA.bookings.forEach(b => {
    const key = b.phone || b.customer;
    if (!byPhone[key]) byPhone[key] = { customer: b.customer, phone: b.phone, cars: new Set(), days: 0, total: 0 };
    byPhone[key].cars.add(b.plate);
    byPhone[key].total += Number(b.total || 0);
    const calc = calcRental(b.pickup, b.actualReturn || b.dueReturn, 1, [], b.plate);
    byPhone[key].days += calc.billedDays;
  });
  const rows = Object.values(byPhone);
  const el = document.getElementById('owner-customers-table');
  if (!rows.length) { el.innerHTML = '<tr><td colspan="5" class="empty-state">ยังไม่มีข้อมูลลูกค้า</td></tr>'; return; }
  el.innerHTML = rows.map(r => `
    <tr>
      <td>${r.customer}</td><td class="mono">${r.phone || '-'}</td>
      <td>${[...r.cars].join(', ')}</td><td class="mono">${r.days}</td>
      <td class="mono">฿${fmt(r.total)}</td>
    </tr>`).join('');
}

/* ---------------------------------------------------------
   Shared
--------------------------------------------------------- */
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

/* register service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
