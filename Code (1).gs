/*************************************************************************
 *  SWEET MISHPUCHAH — BACKEND  (Google Apps Script)
 *  ---------------------------------------------------------------------
 *  Powers the IndexM.html website:
 *    • Customer accounts (sign-up, log-in, sessions, password help)
 *    • Orders + per-account order history  → "Orders" tab
 *    • Reviews with admin moderation       → "Reviews" tab
 *    • Contact form → emailed to the bakery → "Contact" tab
 *    • Order calendar with moving blocked days + daily limits
 *    • Professional PDF receipt emailed to the customer AND the bakery
 *
 *  EVERYTHING you normally need to change lives in the CONFIG block
 *  directly below.  You should not need to touch anything else.
 *************************************************************************/


/* =======================================================================
   1)  EASY-EDIT CONFIG   ← change these values anytime
   ======================================================================= */

/* ----- Ordering calendar (all in days) ----- */
const BLOCK_BEFORE_DAYS      = 3;   // days blocked starting from "today" (moves with the date)
const BLOCK_AFTER_ORDER_DAYS = 2;   // days blocked AFTER each already-booked order
const MAX_ORDERS_PER_DAY     = 2;   // how many orders may share the same pickup day

/* ----- Branding & contact ----- */
const BAKERY_NAME    = "Sweet Mishpuchah";                 // shown on the site & receipt
const ADMIN_EMAIL    = "thesweetmishpuchah@gmail.com";     // new-order + admin notifications
const BAKERY_REPLY_TO= "thesweetmishpuchah@gmail.com";     // reply-to on customer emails
const PICKUP_ADDRESS = "2404 East 28th Street, Brooklyn, New York, 11235";

/* ----- Payment handles (appear in instructions & emails) ----- */
const PAYMENT_HANDLES = {
  zelle:   "thesweetmishpuchah@gmail.com",
  venmo:   "@sweetmishpuchah",
  cashapp: "$sweetmishpuchah",
  cash:    ""    // paid in person at pickup
};

/* ----- Google Sheet (ONE spreadsheet, MULTIPLE tabs) ----- */
const SHEET_ID    = '1wYQXr1GeaYsNWA1KyMi1uDqHf-k3TQSu_rkRwwoNUeQ';
const TAB_ORDERS  = 'Orders';
const TAB_USERS   = 'Users';
const TAB_REVIEWS = 'Reviews';
const TAB_CONTACT = 'Contact';
const TAB_RESETS  = 'PasswordResets';

/* ----- Sessions ----- */
const SESSION_DAYS = 30;   // how long a login stays valid


/* =======================================================================
   2)  SHEET HELPERS  (auto-create tabs + headers on first use)
   ======================================================================= */

const HEADERS = {};
HEADERS[TAB_ORDERS]  = ['Timestamp','Order ID','Order Date','Customer Name','Customer Email',
                        'Customer Phone','Payment Method','Payment Handle','Total','Items JSON',
                        'Cake Writing','Notes','Account Email','Status'];
HEADERS[TAB_USERS]   = ['Timestamp','Email','Name','Phone','Password Hash','Salt','Role',
                        'Token','Token Expiry','Reset Code','Reset Expiry'];
HEADERS[TAB_REVIEWS] = ['Timestamp','Review ID','Name','Account Email','Stars','Text','Status'];
HEADERS[TAB_CONTACT] = ['Timestamp','Name','Email','Subject','Message'];
HEADERS[TAB_RESETS]  = ['Timestamp','Email','Reset Code','Expiry','Status'];

function getSpreadsheet_() { return SpreadsheetApp.openById(SHEET_ID); }

function getTab_(name) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const head = HEADERS[name] || [];
    if (head.length) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/* convenience aliases */
function getOrdersSheet_()  { return getTab_(TAB_ORDERS); }
function getUsersSheet_()   { return getTab_(TAB_USERS); }
function getReviewsSheet_() { return getTab_(TAB_REVIEWS); }
function getContactSheet_() { return getTab_(TAB_CONTACT); }
function getResetsSheet_()  { return getTab_(TAB_RESETS); }


/* =======================================================================
   3)  SMALL UTILITIES
   ======================================================================= */

function parseISODate(str) { const p = String(str).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
function formatISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return yyyy + '-' + mm + '-' + dd;
}
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate()+days); return d; }
function todayLocal() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function money(n) { return (Math.round(Number(n||0)*100)/100).toFixed(2); }
function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'')); }
function esc_(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function newId(prefix) { return (prefix||'ID') + '-' + Date.now() + '-' + Math.floor(Math.random()*1000); }
function makeSalt_()  { return Utilities.getUuid(); }
function makeToken_() { return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''); }

function hashPassword_(password, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(password) + ':' + String(salt), Utilities.Charset.UTF_8);
  return raw.map(function(b){ return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}


/* =======================================================================
   4)  HTML ENTRY POINT
   ======================================================================= */

function doGet(e) {
  // If this project also contains the front-end HTML file (all-in-one hosting),
  // serve it. Otherwise this deployment is API-only — the front-end lives on
  // GitHub Pages and talks to doPost — so return a small health-check response.
  try {
    const page = (e && e.parameter && e.parameter.page) || 'IndexM';
    return HtmlService.createHtmlOutputFromFile(page)
      .setTitle(BAKERY_NAME + ' — Artisan Bakery')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return jsonOut_({ ok: true, service: BAKERY_NAME + ' API', time: new Date().toISOString() });
  }
}

/* JSON API for the GitHub Pages front-end.
   The browser POSTs {method, payload} as text/plain — a "simple" request, so the
   browser sends NO CORS pre-flight (Apps Script can't answer pre-flights). We run
   the matching function and return JSON, which Google serves with permissive CORS. */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut_({ ok: false, error: 'Bad request' }); }

  var ROUTER = {
    signUp: signUp, logIn: logIn, getUserByToken: getUserByToken, logOut: logOut,
    updateProfile: updateProfile, requestPasswordReset: requestPasswordReset,
    resetPasswordWithCode: resetPasswordWithCode, adminListUsers: adminListUsers,
    adminSetPassword: adminSetPassword, adminForceLogout: adminForceLogout,
    submitReview: submitReview, getApprovedReviews: getApprovedReviews,
    getPendingReviews: getPendingReviews, moderateReview: moderateReview,
    submitContact: submitContact, getGlobalMinDate: getGlobalMinDate,
    getBlockedDates: getBlockedDates, checkDateAvailability: checkDateAvailability,
    saveOrder: saveOrder, getOrderHistory: getOrderHistory, getPublicConfig: getPublicConfig
  };
  var fn = ROUTER[req && req.method];
  if (!fn) return jsonOut_({ ok: false, error: 'Unknown method: ' + (req && req.method) });
  try {
    return jsonOut_(fn(req.payload || {}));
  } catch (err) {
    return jsonOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* lets IndexM.html pull in shared config values if it wants to */
function getPublicConfig() {
  return {
    bakeryName: BAKERY_NAME,
    pickupAddress: PICKUP_ADDRESS,
    paymentHandles: PAYMENT_HANDLES,
    blockBeforeDays: BLOCK_BEFORE_DAYS,
    maxOrdersPerDay: MAX_ORDERS_PER_DAY,
    adminEmail: ADMIN_EMAIL
  };
}


/* =======================================================================
   5)  ACCOUNTS  /  AUTH
   ======================================================================= */

function userRowToObject_(row) {
  return {
    email: row[1], name: row[2], phone: row[3],
    role: row[6] || 'customer'
  };
}

function findUserRow_(email) {
  const sh = getUsersSheet_();
  const data = sh.getDataRange().getValues();
  const target = String(email||'').trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]||'').trim().toLowerCase() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function signUp(payload) {
  try {
    payload = payload || {};
    const name  = String(payload.name||'').trim();
    const email = String(payload.email||'').trim();
    const phone = String(payload.phone||'').trim();
    const pass  = String(payload.password||'');

    if (!name)  return { ok:false, error:'Please enter your name.' };
    if (!isEmail(email)) return { ok:false, error:'Please enter a valid email address.' };
    if (pass.length < 6) return { ok:false, error:'Password must be at least 6 characters.' };
    if (findUserRow_(email)) return { ok:false, error:'An account with that email already exists. Try signing in.' };

    const salt = makeSalt_();
    const hash = hashPassword_(pass, salt);
    const token = makeToken_();
    const expiry = addDays(new Date(), SESSION_DAYS);
    const role = (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'customer';

    getUsersSheet_().appendRow([
      new Date(), email, name, phone, hash, salt, role, token, expiry, '', ''
    ]);

    return { ok:true, token: token, user: { email:email, name:name, phone:phone, role:role } };
  } catch (err) {
    return { ok:false, error: 'Sign-up failed: ' + err };
  }
}

function logIn(payload) {
  try {
    payload = payload || {};
    const email = String(payload.email||'').trim();
    const pass  = String(payload.password||'');
    const found = findUserRow_(email);
    if (!found) return { ok:false, error:'No account found with that email.' };

    const row = found.row;
    const hash = hashPassword_(pass, row[5]);
    if (hash !== row[4]) return { ok:false, error:'Incorrect password. Use “Forgot password” if you need help.' };

    const token = makeToken_();
    const expiry = addDays(new Date(), SESSION_DAYS);
    const sh = getUsersSheet_();
    sh.getRange(found.rowIndex, 8).setValue(token);   // Token
    sh.getRange(found.rowIndex, 9).setValue(expiry);  // Token Expiry

    let role = row[6] || 'customer';
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && role !== 'admin') {
      role = 'admin'; sh.getRange(found.rowIndex, 7).setValue('admin');
    }
    return { ok:true, token: token, user: { email: row[1], name: row[2], phone: row[3], role: role } };
  } catch (err) {
    return { ok:false, error: 'Sign-in failed: ' + err };
  }
}

/* Resolve a session token → user object (or null). Internal + exposed. */
function userFromToken_(token) {
  if (!token) return null;
  const sh = getUsersSheet_();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][7]) === String(token)) {
      const exp = data[i][8];
      if (exp && new Date(exp) < new Date()) return null;   // expired
      return userRowToObject_(data[i]);
    }
  }
  return null;
}

function getUserByToken(payload) {
  const u = userFromToken_(payload && payload.token);
  return u ? { ok:true, user:u } : { ok:false };
}

function logOut(payload) {
  try {
    const token = payload && payload.token;
    if (!token) return { ok:true };
    const sh = getUsersSheet_();
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][7]) === String(token)) {
        sh.getRange(i + 1, 8).setValue('');
        sh.getRange(i + 1, 9).setValue('');
        break;
      }
    }
    return { ok:true };
  } catch (err) { return { ok:false, error:String(err) }; }
}

function updateProfile(payload) {
  try {
    const u = userFromToken_(payload && payload.token);
    if (!u) return { ok:false, error:'Please sign in again.' };
    const found = findUserRow_(u.email);
    const sh = getUsersSheet_();
    if (payload.name)  sh.getRange(found.rowIndex, 3).setValue(String(payload.name).trim());
    if (payload.phone) sh.getRange(found.rowIndex, 4).setValue(String(payload.phone).trim());
    const fresh = findUserRow_(u.email).row;
    return { ok:true, user: userRowToObject_(fresh) };
  } catch (err) { return { ok:false, error:String(err) }; }
}

/* ---- Password help (self-service code + admin override) ---- */

function requestPasswordReset(payload) {
  try {
    const email = String(payload && payload.email || '').trim();
    const found = findUserRow_(email);
    // Always reply the same way so we don't reveal which emails exist.
    if (!found) return { ok:true, message:'If that email has an account, a reset code has been sent.' };

    const code = String(Math.floor(100000 + Math.random()*900000));   // 6-digit
    const expiry = addDays(new Date(), 1);
    const sh = getUsersSheet_();
    sh.getRange(found.rowIndex, 10).setValue(code);
    sh.getRange(found.rowIndex, 11).setValue(expiry);
    getResetsSheet_().appendRow([new Date(), email, code, expiry, 'requested']);

    // Email the customer their code …
    try {
      MailApp.sendEmail({
        to: email, replyTo: BAKERY_REPLY_TO,
        subject: BAKERY_NAME + ' — Password reset code',
        htmlBody: '<p>Hello,</p><p>Your ' + esc_(BAKERY_NAME) + ' password reset code is:</p>' +
                  '<p style="font-size:22px;font-weight:bold;letter-spacing:3px">' + code + '</p>' +
                  '<p>Enter it on the website to set a new password. The code expires in 24 hours.</p>' +
                  '<p>If you did not request this, you can ignore this email.</p>'
      });
    } catch (e) {}
    // … and let the bakery know in case the customer needs a hand.
    try {
      MailApp.sendEmail({ to: ADMIN_EMAIL, replyTo: BAKERY_REPLY_TO,
        subject: 'Password reset requested — ' + email,
        htmlBody: '<p>' + esc_(email) + ' requested a password reset. Code: <b>' + code + '</b> (valid 24h).</p>' +
                  '<p>You can also reset it for them from the Admin panel.</p>' });
    } catch (e) {}

    return { ok:true, message:'If that email has an account, a reset code has been sent.' };
  } catch (err) { return { ok:false, error:String(err) }; }
}

function resetPasswordWithCode(payload) {
  try {
    payload = payload || {};
    const email = String(payload.email||'').trim();
    const code  = String(payload.code||'').trim();
    const pass  = String(payload.newPassword||'');
    if (pass.length < 6) return { ok:false, error:'Password must be at least 6 characters.' };

    const found = findUserRow_(email);
    if (!found) return { ok:false, error:'No account found with that email.' };
    const storedCode = String(found.row[9]||'');
    const exp = found.row[10];
    if (!storedCode || storedCode !== code) return { ok:false, error:'That reset code is not correct.' };
    if (exp && new Date(exp) < new Date()) return { ok:false, error:'That reset code has expired. Please request a new one.' };

    const salt = makeSalt_();
    const hash = hashPassword_(pass, salt);
    const sh = getUsersSheet_();
    sh.getRange(found.rowIndex, 5).setValue(hash);
    sh.getRange(found.rowIndex, 6).setValue(salt);
    sh.getRange(found.rowIndex, 10).setValue('');
    sh.getRange(found.rowIndex, 11).setValue('');
    return { ok:true, message:'Password updated. You can now sign in.' };
  } catch (err) { return { ok:false, error:String(err) }; }
}


/* =======================================================================
   6)  ADMIN  (only the ADMIN_EMAIL account)
   ======================================================================= */

function requireAdmin_(token) {
  const u = userFromToken_(token);
  if (!u || u.role !== 'admin') return null;
  return u;
}

function adminListUsers(payload) {
  if (!requireAdmin_(payload && payload.token)) return { ok:false, error:'Admin only.' };
  const data = getUsersSheet_().getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    users.push({ email:data[i][1], name:data[i][2], phone:data[i][3], role:data[i][6]||'customer',
                 created: data[i][0] ? formatISO(new Date(data[i][0])) : '' });
  }
  return { ok:true, users:users };
}

/* Admin sets a brand-new password for a locked-out customer. */
function adminSetPassword(payload) {
  if (!requireAdmin_(payload && payload.token)) return { ok:false, error:'Admin only.' };
  const found = findUserRow_(payload.email);
  if (!found) return { ok:false, error:'No account with that email.' };
  if (String(payload.newPassword||'').length < 6) return { ok:false, error:'Password must be at least 6 characters.' };
  const salt = makeSalt_();
  const hash = hashPassword_(payload.newPassword, salt);
  const sh = getUsersSheet_();
  sh.getRange(found.rowIndex, 5).setValue(hash);
  sh.getRange(found.rowIndex, 6).setValue(salt);
  sh.getRange(found.rowIndex, 8).setValue('');   // force re-login everywhere
  sh.getRange(found.rowIndex, 9).setValue('');
  // tell the customer
  try {
    MailApp.sendEmail({ to: payload.email, replyTo: BAKERY_REPLY_TO,
      subject: BAKERY_NAME + ' — your password was reset',
      htmlBody: '<p>Hello,</p><p>Our team set a new temporary password for your ' + esc_(BAKERY_NAME) +
                ' account at your request. Please sign in and change it from your account page.</p>' });
  } catch (e) {}
  return { ok:true, message:'Password reset for ' + payload.email + '.' };
}

/* Admin clears a session so a confused customer can log in cleanly. */
function adminForceLogout(payload) {
  if (!requireAdmin_(payload && payload.token)) return { ok:false, error:'Admin only.' };
  const found = findUserRow_(payload.email);
  if (!found) return { ok:false, error:'No account with that email.' };
  const sh = getUsersSheet_();
  sh.getRange(found.rowIndex, 8).setValue('');
  sh.getRange(found.rowIndex, 9).setValue('');
  return { ok:true, message:'Signed out everywhere for ' + payload.email + '.' };
}


/* =======================================================================
   7)  REVIEWS  (customer submits → pending → admin approves)
   ======================================================================= */

function submitReview(payload) {
  try {
    payload = payload || {};
    const u = userFromToken_(payload.token);                 // optional
    const name  = String(payload.name || (u && u.name) || '').trim();
    const stars = Math.max(1, Math.min(5, parseInt(payload.stars, 10) || 0));
    const text  = String(payload.text || '').trim();
    if (!name)  return { ok:false, error:'Please add your name.' };
    if (!stars) return { ok:false, error:'Please choose a star rating.' };
    if (!text)  return { ok:false, error:'Please write a short review.' };

    getReviewsSheet_().appendRow([
      new Date(), newId('REV'), name, (u && u.email) || '', stars, text, 'pending'
    ]);
    // Let the bakery know there is something to moderate.
    try {
      MailApp.sendEmail({ to: ADMIN_EMAIL, replyTo: BAKERY_REPLY_TO,
        subject: 'New review awaiting approval — ' + name,
        htmlBody: '<p><b>' + esc_(name) + '</b> left a ' + stars + '★ review:</p><blockquote>' +
                  esc_(text) + '</blockquote><p>Approve or reject it from the Admin panel.</p>' });
    } catch (e) {}
    return { ok:true, message:'Thank you! Your review was submitted and will appear once approved.' };
  } catch (err) { return { ok:false, error:String(err) }; }
}

function getApprovedReviews() {
  try {
    const data = getReviewsSheet_().getDataRange().getValues();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][6]).toLowerCase() === 'approved') {
        out.push({ id:data[i][1], name:data[i][2], stars:Number(data[i][4])||5, text:data[i][5],
                   date: data[i][0] ? Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'MMM yyyy') : '' });
      }
    }
    return { ok:true, reviews: out.reverse() };
  } catch (err) { return { ok:false, error:String(err), reviews:[] }; }
}

function getPendingReviews(payload) {
  if (!requireAdmin_(payload && payload.token)) return { ok:false, error:'Admin only.', reviews:[] };
  const data = getReviewsSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][6]).toLowerCase() === 'pending') {
      out.push({ id:data[i][1], name:data[i][2], email:data[i][3], stars:Number(data[i][4])||5,
                 text:data[i][5], date: data[i][0] ? formatISO(new Date(data[i][0])) : '' });
    }
  }
  return { ok:true, reviews: out.reverse() };
}

function moderateReview(payload) {
  if (!requireAdmin_(payload && payload.token)) return { ok:false, error:'Admin only.' };
  const action = (payload.action === 'approve') ? 'approved' : 'rejected';
  const sh = getReviewsSheet_();
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(payload.id)) {
      sh.getRange(i + 1, 7).setValue(action);
      return { ok:true, message:'Review ' + action + '.' };
    }
  }
  return { ok:false, error:'Review not found.' };
}


/* =======================================================================
   8)  CONTACT FORM  → emailed to the bakery
   ======================================================================= */

function submitContact(payload) {
  try {
    payload = payload || {};
    const name = String(payload.name||'').trim();
    const email = String(payload.email||'').trim();
    const subject = String(payload.subject||'General Inquiry').trim();
    const message = String(payload.message||'').trim();
    if (!name || !isEmail(email) || !message)
      return { ok:false, error:'Please add your name, a valid email, and a message.' };

    getContactSheet_().appendRow([new Date(), name, email, subject, message]);

    MailApp.sendEmail({
      to: ADMIN_EMAIL, replyTo: email,
      subject: 'Website message: ' + subject + ' — ' + name,
      htmlBody: '<p><b>New message from the website contact form.</b></p>' +
                '<p><b>Name:</b> ' + esc_(name) + '<br>' +
                '<b>Email:</b> ' + esc_(email) + '<br>' +
                '<b>Subject:</b> ' + esc_(subject) + '</p>' +
                '<p><b>Message:</b><br>' + esc_(message).replace(/\n/g,'<br>') + '</p>'
    });
    return { ok:true, message:'Message sent! We will get back to you within 24 hours.' };
  } catch (err) { return { ok:false, error:String(err) }; }
}


/* =======================================================================
   9)  ORDER CALENDAR
   ======================================================================= */

function getGlobalMinDate() {
  return formatISO(addDays(todayLocal(), BLOCK_BEFORE_DAYS));
}

function getBlockedDates() {
  const data = getOrdersSheet_().getDataRange().getValues();
  const blocked = [];
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][2];
    if (!rowDate) continue;
    const rowISO = (typeof rowDate === 'string') ? rowDate : formatISO(new Date(rowDate));
    const booked = parseISODate(rowISO);
    for (let d = 1; d <= BLOCK_AFTER_ORDER_DAYS; d++) blocked.push(formatISO(addDays(booked, d)));
  }
  return blocked;
}

function checkDateAvailability(payload) {
  const orderDateStr = (payload && payload.date) ? payload.date : payload;   // accept string or {date}
  if (!orderDateStr) return { available:false, message:'Please choose a date.' };

  const orderDate = parseISODate(orderDateStr);
  const minLead = addDays(todayLocal(), BLOCK_BEFORE_DAYS);
  if (orderDate < minLead)
    return { available:false, message:'The earliest available date is ' + formatISO(minLead) + '.' };

  const data = getOrdersSheet_().getDataRange().getValues();
  let countForDay = 0;
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][2];
    if (!rowDate) continue;
    const rowISO = (typeof rowDate === 'string') ? rowDate : formatISO(new Date(rowDate));
    if (rowISO === orderDateStr) countForDay++;

    const booked = parseISODate(rowISO);
    for (let d = 1; d <= BLOCK_AFTER_ORDER_DAYS; d++) {
      if (orderDateStr === formatISO(addDays(booked, d)))
        return { available:false, message:'That date is unavailable because it is within ' +
                 BLOCK_AFTER_ORDER_DAYS + ' days of another order.' };
    }
  }
  if (countForDay >= MAX_ORDERS_PER_DAY)
    return { available:false, message:'That date is fully booked. Please choose another.' };

  return { available:true, message:'Date is available.' };
}


/* =======================================================================
   10)  PLACE ORDER  → save, email receipt, link to account
   ======================================================================= */

function saveOrder(order) {
  try {
    order = order || {};
    if (!order.date) return { ok:false, error:'Missing order date.' };

    const check = checkDateAvailability(order.date);
    if (!check.available) return { ok:false, error: check.message };

    const customer = order.customer || {};
    const payment  = order.payment  || {};
    const items    = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return { ok:false, error:'Your cart is empty.' };

    const acct = userFromToken_(order.token);     // optional — links order to account
    const orderId = order.id || newId('BK');

    getOrdersSheet_().appendRow([
      new Date(), orderId, order.date,
      customer.name||'', customer.email||'', customer.phone||'',
      payment.method||'', PAYMENT_HANDLES[payment.method]||'',
      money(order.total), JSON.stringify(items),
      order.writing||'', order.notes||'',
      (acct && acct.email) || customer.email || '', 'received'
    ]);

    const enriched = Object.assign({}, order, { id: orderId, total: money(order.total),
      payment: { method: payment.method, handle: PAYMENT_HANDLES[payment.method]||'' } });

    let pdf = null;
    try { pdf = generatePdfReceipt(enriched); } catch (e) { pdf = null; }
    try { sendCustomerEmail(enriched, pdf); } catch (e) {}
    try { sendAdminEmail(enriched, pdf); } catch (e) {}

    return { ok:true, orderId: orderId, pickupAddress: PICKUP_ADDRESS };
  } catch (err) {
    return { ok:false, error: 'Order failed: ' + err };
  }
}

function getOrderHistory(payload) {
  const u = userFromToken_(payload && payload.token);
  if (!u) return { ok:false, error:'Please sign in to view your orders.', orders:[] };
  const data = getOrdersSheet_().getDataRange().getValues();
  const out = [];
  const me = u.email.toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const acct = String(data[i][12]||'').toLowerCase();
    const cust = String(data[i][4]||'').toLowerCase();
    if (acct === me || cust === me) {
      let items = []; try { items = JSON.parse(data[i][9]||'[]'); } catch (e) {}
      out.push({
        id:data[i][1], date:data[i][2] && typeof data[i][2] !== 'string' ? formatISO(new Date(data[i][2])) : data[i][2],
        total:data[i][8], method:data[i][6], items:items, writing:data[i][10],
        status:data[i][13]||'received',
        placed: data[i][0] ? formatISO(new Date(data[i][0])) : ''
      });
    }
  }
  return { ok:true, orders: out.reverse() };
}


/* =======================================================================
   11)  RECEIPT  +  EMAILS
   ======================================================================= */

function generatePdfReceipt(order) {
  const template = HtmlService.createTemplateFromFile('Receipt');
  template.order = order;
  template.bakeryName = BAKERY_NAME;
  template.pickupAddress = PICKUP_ADDRESS;
  template.paymentHandles = PAYMENT_HANDLES;
  const html = template.evaluate().getContent();
  return Utilities.newBlob(html, 'text/html', 'receipt.html')
    .getAs('application/pdf').setName('Receipt_' + order.id + '.pdf');
}

function itemsHtml_(order) {
  let rows = '';
  (order.items||[]).forEach(function(it){
    const price = Number(String(it.price).replace(/[^0-9.]/g,'')) || 0;
    const qty = it.quantity || it.qty || 1;
    rows += '<tr><td style="padding:6px 10px;border:1px solid #eee">' + esc_(it.name) +
            '</td><td style="padding:6px 10px;border:1px solid #eee;text-align:center">' + qty +
            '</td><td style="padding:6px 10px;border:1px solid #eee;text-align:right">$' + money(price*qty) + '</td></tr>';
  });
  return rows;
}

function paymentLine_(order) {
  const m = order.payment && order.payment.method;
  if (m === 'cash') return 'Please bring cash to pickup at ' + esc_(PICKUP_ADDRESS) + '. No payment is required now.';
  const handle = (order.payment && order.payment.handle) || PAYMENT_HANDLES[m] || '';
  const label = m==='zelle'?'Zelle':m==='venmo'?'Venmo':m==='cashapp'?'Cash App':m||'';
  if (!label) return '';
  return 'Please send $' + money(order.total) + ' via ' + label + ' to <b>' + esc_(handle) +
         '</b> and include your name and Order ID (' + esc_(order.id) + ') in the note.';
}

function sendCustomerEmail(order, pdfBlob) {
  const email = order.customer && order.customer.email;
  if (!email) return;
  const opts = {
    to: email, replyTo: BAKERY_REPLY_TO,
    subject: BAKERY_NAME + ' — Order Confirmation ' + order.id,
    htmlBody:
      '<div style="font-family:Arial,sans-serif;color:#2a2118">' +
      '<h2 style="color:#9e5d44;margin:0 0 4px">' + esc_(BAKERY_NAME) + '</h2>' +
      '<p>Hi ' + esc_(order.customer.name||'') + ', thank you for your order!</p>' +
      '<p><b>Order ID:</b> ' + esc_(order.id) + '<br><b>Pickup date:</b> ' + esc_(order.date) + '</p>' +
      '<table style="border-collapse:collapse;margin:8px 0"><tr>' +
      '<th style="padding:6px 10px;border:1px solid #eee;text-align:left">Item</th>' +
      '<th style="padding:6px 10px;border:1px solid #eee">Qty</th>' +
      '<th style="padding:6px 10px;border:1px solid #eee;text-align:right">Subtotal</th></tr>' +
      itemsHtml_(order) + '</table>' +
      '<p><b>Total: $' + money(order.total) + '</b></p>' +
      (order.writing ? '<p><b>Cake writing:</b> ' + esc_(order.writing) + '</p>' : '') +
      '<p>' + paymentLine_(order) + '</p>' +
      '<p>Your order will be ready for pickup on <b>' + esc_(order.date) + '</b> at ' + esc_(PICKUP_ADDRESS) + '.</p>' +
      '<p style="color:#7a6a5e">A printable receipt is attached. With love, ' + esc_(BAKERY_NAME) + '.</p></div>',
    name: BAKERY_NAME
  };
  if (pdfBlob) opts.attachments = [pdfBlob];
  MailApp.sendEmail(opts);
}

function sendAdminEmail(order, pdfBlob) {
  const c = order.customer || {};
  const opts = {
    to: ADMIN_EMAIL, replyTo: c.email || BAKERY_REPLY_TO,
    subject: 'New order ' + order.id + ' — ' + (c.name||'') + ' (' + order.date + ')',
    htmlBody:
      '<div style="font-family:Arial,sans-serif">' +
      '<h3>New order received</h3>' +
      '<p><b>Order ID:</b> ' + esc_(order.id) + '<br><b>Pickup date:</b> ' + esc_(order.date) + '</p>' +
      '<p><b>Customer:</b> ' + esc_(c.name||'') + '<br><b>Email:</b> ' + esc_(c.email||'') +
      '<br><b>Phone:</b> ' + esc_(c.phone||'') + '</p>' +
      '<table style="border-collapse:collapse;margin:8px 0">' + itemsHtml_(order) + '</table>' +
      '<p><b>Total: $' + money(order.total) + '</b><br><b>Payment:</b> ' +
      esc_((order.payment&&order.payment.method)||'') + '</p>' +
      (order.writing ? '<p><b>Cake writing:</b> ' + esc_(order.writing) + '</p>' : '') + '</div>',
    name: BAKERY_NAME + ' Website'
  };
  if (pdfBlob) opts.attachments = [pdfBlob];
  MailApp.sendEmail(opts);
}


/* =======================================================================
   12)  ONE-TIME SETUP HELPER (optional)
   Run setupSheets() once from the editor to create all tabs/headers.
   ======================================================================= */
function setupSheets() {
  [TAB_ORDERS, TAB_USERS, TAB_REVIEWS, TAB_CONTACT, TAB_RESETS].forEach(getTab_);
  return 'All tabs ready in spreadsheet ' + SHEET_ID;
}
