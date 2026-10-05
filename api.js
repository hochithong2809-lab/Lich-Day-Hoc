/**
 * Talks to the backend.
 * - With APP_CONFIG.API_URL set: sends requests to your Google Apps Script web app.
 * - Without it: runs a demo backend in the browser (sample calendar, saved in localStorage).
 */
(function () {
  'use strict';
  var Core = window.TutorCore;
  var MIN = Core.MIN, HOUR = Core.HOUR, DAY = Core.DAY;
  var cfg = window.APP_CONFIG || {};

  // ---------------- real backend ----------------
  function remote(body) {
    // text/plain body = "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
    return fetch(cfg.API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'network' }; });
  }

  // ---------------- demo backend ----------------
  var DEMO_KEY = 'tutorbook-demo-v2';
  var memory = null;

  var DEMO_RULES = {
    SESSION_MINUTES: 120, BUFFER_MINUTES: 30, DAY_START_HOUR: 7, DAY_END_HOUR: 23, SLOT_STEP_MINUTES: 30,
    WINDOW_MODE: 'rolling', WINDOW_DAYS: 7, MIN_LEAD_MINUTES: 120, CANCEL_MIN_HOURS: 12, MAX_BOOKINGS_PER_WINDOW: 0, STUDENT_FEES_MIN_LESSONS: 4
  };

  // Weekly classes copied from the tutor's Google Calendar screenshot (day: 0 = Sunday).
  var WEEKLY = [
    { day: 1, from: '13:00', to: '14:50', title: 'Hệ thống số', location: 'C5-503', calendar: 'Lịch học HK1' },
    { day: 2, from: '12:00', to: '14:50', title: 'Giải tích 1', location: 'B6-GDB6', calendar: 'Lịch học HK1' },
    { day: 2, from: '18:00', to: '21:00', title: 'Học Python HCMUS', location: '', calendar: 'SV261' },
    { day: 4, from: '16:00', to: '17:50', title: 'Nhập môn Điện toán', location: 'C5-303', calendar: 'Lịch học HK1' },
    { day: 4, from: '18:00', to: '21:00', title: 'Học Python HCMUS', location: '', calendar: 'SV261' },
    { day: 6, from: '18:00', to: '21:00', title: 'Học Python HCMUS', location: '', calendar: 'SV261' }
  ];
  function hm(s) { var p = s.split(':'); return (+p[0] * 60 + +p[1]) * MIN; }

  function demoCalendar(from, to) {
    var out = [];
    for (var d = Core.dayStart(from) - DAY; d < to; d += DAY) {
      var wd = Core.weekday(d);
      WEEKLY.forEach(function (w, i) {
        if (w.day !== wd) return;
        var s = d + hm(w.from), e = d + hm(w.to);
        if (e > from && s < to) out.push({ id: 'cal-' + d + '-' + i, start: s, end: e, title: w.title, location: w.location, calendar: w.calendar });
      });
    }
    return out;
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  function seed() {
    var today = Core.dayStart(Date.now());
    var admin = { id: 'u-admin', username: 'admin', name: 'Hồ Chí Thông', role: 'admin', price: 0, active: true, salt: 's', hash: 'plain:admin123', createdAt: today };
    var khoa = { id: 'u-khoa', username: 'minhkhoa', name: 'Nguyễn Minh Khoa', role: 'student', price: 250000, active: true, salt: 's', hash: 'plain:hocvien123', createdAt: today - 30 * DAY };
    var lan = { id: 'u-lan', username: 'lananh', name: 'Trần Lan Anh', role: 'student', price: 200000, active: true, salt: 's', hash: 'plain:hocvien123', createdAt: today - 30 * DAY };
    function lesson(student, dayOffset, hour, minute) {
      var s = today + dayOffset * DAY + (hour * 60 + (minute || 0)) * MIN;
      return { id: uid(), studentId: student.id, start: s, end: s + 2 * HOUR, status: 'booked', note: '', createdAt: s - 3 * DAY, createdBy: student.id };
    }
    var bookings = [
      lesson(khoa, -19, 9), lesson(khoa, -12, 9), lesson(khoa, -9, 9), lesson(khoa, -7, 9), lesson(khoa, -5, 9), lesson(khoa, -2, 9),
      lesson(khoa, 2, 9),
      lesson(lan, -11, 8), lesson(lan, -4, 8), lesson(lan, 4, 9, 30)
    ];
    bookings[6].note = 'Ôn chương 3 Giải tích';
    var payments = [
      { id: uid(), studentId: khoa.id, at: today - 10 * DAY + 20 * HOUR, amount: 500000, note: 'Chuyển khoản', createdAt: today - 10 * DAY },
      { id: uid(), studentId: lan.id, at: today - 3 * DAY + 19 * HOUR, amount: 400000, note: 'Tiền mặt', createdAt: today - 3 * DAY }
    ];
    return { users: [admin, khoa, lan], bookings: bookings, payments: payments, sessions: {} };
  }

  function load() {
    if (memory) return memory;
    try { var raw = localStorage.getItem(DEMO_KEY); if (raw) memory = JSON.parse(raw); } catch (e) { /* storage blocked */ }
    if (!memory) memory = seed();
    return memory;
  }
  function save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(memory)); } catch (e) { /* keep in memory */ } }

  var fails = {};
  function demoCtx() {
    var db = load();
    var byId = function (list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; };
    var patch = function (obj, p) { Object.keys(p).forEach(function (k) { obj[k] = p[k]; }); save(); };
    return {
      now: Date.now(),
      rules: DEMO_RULES,
      tutorName: 'Hồ Chí Thông',
      bank: { bin: '970436', name: 'Vietcombank', account: '1058674907', holder: 'HO CHI THONG' },
      store: {
        listUsers: function () { return db.users; },
        getUser: function (id) { return byId(db.users, id); },
        findUserByUsername: function (u) { return db.users.filter(function (x) { return x.username === u; })[0] || null; },
        insertUser: function (u) { db.users.push(u); save(); },
        updateUser: function (id, p) { patch(byId(db.users, id), p); },
        listBookings: function () { return db.bookings; },
        insertBooking: function (b) { db.bookings.push(b); save(); },
        updateBooking: function (id, p) { patch(byId(db.bookings, id), p); },
        listPayments: function () { return db.payments; },
        insertPayment: function (p) { db.payments.push(p); save(); },
        deletePayment: function (id) { db.payments = db.payments.filter(function (p) { return p.id !== id; }); save(); },
        createSession: function (userId) { var t = uid() + uid(); db.sessions[t] = userId; save(); return t; },
        getSession: function (t) { return db.sessions[t] || null; },
        deleteSession: function (t) { delete db.sessions[t]; save(); },
        deleteSessionsFor: function (userId) { Object.keys(db.sessions).forEach(function (t) { if (db.sessions[t] === userId) delete db.sessions[t]; }); save(); }
      },
      calendar: { events: demoCalendar, onBooked: function () { return ''; }, onCancelled: function () {} },
      auth: { hash: function (pw) { return 'plain:' + pw; }, newSalt: function () { return 's'; }, newId: uid },
      limiter: {
        isLocked: function (u) { return (fails[u] || 0) >= 5; },
        fail: function (u) { fails[u] = (fails[u] || 0) + 1; },
        reset: function (u) { delete fails[u]; }
      }
    };
  }

  function demo(body) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        try { resolve({ ok: true, data: JSON.parse(JSON.stringify(Core.handle(body.action, body, demoCtx()))) }); }
        catch (e) { resolve({ ok: false, error: e.code || 'server', message: String(e) }); }
      }, 120 + Math.random() * 120);
    });
  }

  window.TutorApi = {
    demo: !cfg.API_URL,
    request: function (body) { return cfg.API_URL ? remote(body) : demo(body); },
    resetDemo: function () { memory = seed(); save(); }
  };
})();
