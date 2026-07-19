/**
 * EV CNX VIENTIANE — Apps Script backend
 * -----------------------------------------------------------
 * SETUP:
 * 1. Open your Google Sheet ("EVCNXCARRENT VIENTINAE").
 * 2. Extensions > Apps Script. Delete any starter code, paste this whole file in.
 * 3. Make sure your spreadsheet has these tabs (create any that are missing),
 *    with headers exactly as below in row 1:
 *
 *    Cars        | ทะเบียนรถ | รุ่น | สถานะ | เลขไมล์ปัจจุบัน | รูปถ่ายรถ | ราคาเช่าต่อวัน
 *    Employees   | Email | Name | Role | Pin
 *                   (Role is one of: admin / field / accounting / owner)
 *    Bookings    | ID | Plate | Customer | Phone | Pickup | DueReturn | ActualReturn |
 *                  Status | AssignedTo | Total | PaymentStatus | DepositStatus | DepositAmount
 *    Promotions  | ID | MinDays | Type | Value | Scope
 *                   (Type is one of: percent / fixed)
 *    Transactions| ID | Type | Category | Desc | Amount | Date
 *                   (Type is one of: income / expense — for general company
 *                    income/expense, separate from rental booking revenue)
 *    Settings    | Key | Value
 *                   (one row: ExchangeRateTHBtoLAK | 650)
 *
 * 4. Deploy > New deployment > Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone (the app enforces its own roles/PIN check)
 * 5. Copy the deployment URL into API_URL at the top of app.js.
 *
 * SECURITY NOTE: PINs are stored in the Employees sheet. For production use,
 * replace the plain PIN check below with a hashed comparison — this starter
 * keeps it simple so you can get the whole flow working first.
 */

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  const payload = body.payload || {};
  let result;
  try {
    switch (action) {
      case 'login': result = login(payload); break;
      case 'getAll': result = getAll(payload); break;
      case 'saveCar': result = saveCar(payload); break;
      case 'savePromo': result = savePromo(payload); break;
      case 'saveStaff': result = saveStaff(payload); break;
      case 'saveBooking': result = saveBooking(payload); break;
      case 'saveTransaction': result = saveTransaction(payload); break;
      case 'checkIO': result = checkIO(payload); break;
      default: result = { ok: false, error: 'unknown action' };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name) { return ss().getSheetByName(name); }

function sheetToObjects(name) {
  const values = sheet(name).getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function login(payload) {
  const users = sheetToObjects('Employees');
  const match = users.find(u =>
    String(u.Email).toLowerCase() === String(payload.email).toLowerCase() &&
    String(u.Pin) === String(payload.pin)
  );
  if (!match) return { ok: false, error: 'อีเมลหรือ PIN ไม่ถูกต้อง' };
  return { ok: true, user: { email: match.Email, name: match.Name, role: match.Role } };
}

function getAll() {
  const cars = sheetToObjects('Cars').map(c => ({
    plate: c['ทะเบียนรถ'], model: c['รุ่น'], status: c['สถานะ'],
    mileage: c['เลขไมล์ปัจจุบัน'], photo: c['รูปถ่ายรถ'], price: c['ราคาเช่าต่อวัน']
  }));
  const bookings = sheetToObjects('Bookings').map(b => ({
    id: b.ID, plate: b.Plate, customer: b.Customer, phone: b.Phone, pickup: b.Pickup, dueReturn: b.DueReturn,
    actualReturn: b.ActualReturn, status: b.Status, assignedTo: b.AssignedTo, total: b.Total,
    paymentStatus: b.PaymentStatus, depositStatus: b.DepositStatus, depositAmount: b.DepositAmount
  }));
  const promotions = sheetToObjects('Promotions').map(p => ({
    id: p.ID, minDays: p.MinDays, type: p.Type, value: p.Value, scope: p.Scope
  }));
  const users = sheetToObjects('Employees').map(u => ({ email: u.Email, name: u.Name, role: u.Role }));
  const transactions = sheetToObjects('Transactions').map(t => ({
    id: t.ID, type: t.Type, category: t.Category, desc: t.Desc, amount: t.Amount, date: t.Date
  }));
  const settings = sheetToObjects('Settings');
  const rateRow = settings.find(s => s.Key === 'ExchangeRateTHBtoLAK');
  return { ok: true, cars, bookings, promotions, users, transactions, exchangeRate: rateRow ? Number(rateRow.Value) : 650 };
}

function saveCar(car) {
  const sh = sheet('Cars');
  const data = sh.getDataRange().getValues();
  const rowIdx = data.findIndex((r, i) => i > 0 && r[0] === car.plate);
  const row = [car.plate, car.model, car.status, car.mileage || 0, car.photo || '', car.price];
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  return { ok: true };
}

function savePromo(promo) {
  const sh = sheet('Promotions');
  const id = 'P' + (sh.getLastRow());
  sh.appendRow([id, promo.minDays, promo.type, promo.value, promo.scope]);
  return { ok: true };
}

function saveStaff(staff) {
  sheet('Employees').appendRow([staff.email, staff.name, staff.role, staff.pin]);
  return { ok: true };
}

function saveBooking(booking) {
  const sh = sheet('Bookings');
  const id = 'BK-' + (1000 + sh.getLastRow());
  sh.appendRow([
    id, booking.plate, booking.customer, booking.phone, booking.pickup, booking.dueReturn,
    booking.actualReturn || '', booking.status, booking.assignedTo, booking.total,
    booking.paymentStatus, booking.depositStatus, booking.depositAmount
  ]);
  return { ok: true, id };
}

function saveTransaction(tx) {
  const sh = sheet('Transactions');
  const id = 'TX-' + (sh.getLastRow());
  sh.appendRow([id, tx.type, tx.category, tx.desc, tx.amount, tx.date]);
  return { ok: true };
}

function checkIO(payload) {
  // save photo to Drive if provided (base64 data URL)
  let photoUrl = '';
  if (payload.photo) {
    const parts = payload.photo.split(',');
    const bytes = Utilities.base64Decode(parts[1]);
    const blob = Utilities.newBlob(bytes, 'image/jpeg', payload.plate + '_' + payload.type + '_' + Date.now() + '.jpg');
    const folder = getOrCreatePhotoFolder();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    photoUrl = file.getUrl();
  }

  // update car status/mileage
  const carSh = sheet('Cars');
  const carData = carSh.getDataRange().getValues();
  const carRowIdx = carData.findIndex((r, i) => i > 0 && r[0] === payload.plate);
  if (carRowIdx > 0) {
    carSh.getRange(carRowIdx + 1, 4).setValue(payload.mileage); // เลขไมล์ปัจจุบัน
    carSh.getRange(carRowIdx + 1, 3).setValue(payload.status);  // สถานะ
    if (photoUrl) carSh.getRange(carRowIdx + 1, 5).setValue(photoUrl); // รูปถ่ายรถ
  }

  // update booking if this was a return
  if (payload.bookingId) {
    const bkSh = sheet('Bookings');
    const bkData = bkSh.getDataRange().getValues();
    const bkRowIdx = bkData.findIndex((r, i) => i > 0 && r[0] === payload.bookingId);
    if (bkRowIdx > 0) {
      if (payload.type === 'return') {
        bkSh.getRange(bkRowIdx + 1, 6).setValue(new Date()); // ActualReturn
        bkSh.getRange(bkRowIdx + 1, 7).setValue('คืนแล้ว');   // Status
      } else {
        bkSh.getRange(bkRowIdx + 1, 7).setValue('ถูกเช่า');
      }
    }
  }
  return { ok: true, photoUrl };
}

function getOrCreatePhotoFolder() {
  const name = 'EVCNX Rental Photos';
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}
