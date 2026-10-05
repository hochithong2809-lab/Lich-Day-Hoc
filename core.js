/**
 * TutorCore — booking rules, accounts and billing.
 *
 * This exact file runs in two places:
 *   1. In the browser (demo mode), loaded by index.html.
 *   2. In Google Apps Script, pasted as backend/Core.gs.
 * Keep it free of browser-only (window, document) and Apps-Script-only APIs.
 * Everything that touches storage or the calendar comes in through `ctx`.
 *
 * All times are milliseconds since epoch. "Local" means Vietnam time (UTC+7, no DST).
 */
var TutorCore = (function () {
  'use strict';

  var MIN = 60000, HOUR = 3600000, DAY = 86400000, OFFSET = 7 * HOUR;

  // ---------- time helpers (Vietnam time) ----------
  function dayStart(ms) { return Math.floor((ms + OFFSET) / DAY) * DAY - OFFSET; }
  function weekday(ms) { return new Date(ms + OFFSET).getUTCDay(); } // 0 = Sunday
  function minuteOfDay(ms) { var d = new Date(ms + OFFSET); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

  /** The days a student may book: today + next 6 days ("rolling") or next Monday–Sunday ("nextWeek"). */
  function bookingWindow(now, rules) {
    var from = dayStart(now);
    if (rules.WINDOW_MODE === 'nextWeek') {
      var add = ((8 - weekday(from)) % 7) || 7;
      from += add * DAY;
    }
    return { from: from, to: from + rules.WINDOW_DAYS * DAY };
  }

  /**
   * Returns null when `start` is a valid lesson start, otherwise an error code.
   * busy: [{start, end}] — tutor's calendar events and other existing lessons.
   * Admin bookings skip the hour/window/lead/buffer rules and only check overlap.
   */
  function slotError(start, busy, now, rules, win, isAdmin) {
    var end = start + rules.SESSION_MINUTES * MIN;
    if (!isAdmin) {
      var m = minuteOfDay(start);
      if (m % rules.SLOT_STEP_MINUTES !== 0) return 'bad_step';
      if (m < rules.DAY_START_HOUR * 60 || end - dayStart(start) > rules.DAY_END_HOUR * HOUR) return 'outside_hours';
      if (start < win.from || start >= win.to) return 'outside_window';
      if (start < now + rules.MIN_LEAD_MINUTES * MIN) return 'too_soon';
    }
    var buf = isAdmin ? 0 : rules.BUFFER_MINUTES * MIN;
    for (var i = 0; i < busy.length; i++) {
      var b = busy[i];
      if (start < b.end + buf && end + buf > b.start) return 'conflict';
    }
    return null;
  }

  function mergeIntervals(list) {
    var s = list.map(function (x) { return { start: x.start, end: x.end }; })
      .sort(function (a, b) { return a.start - b.start; });
    var out = [];
    s.forEach(function (x) {
      var last = out[out.length - 1];
      if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
      else out.push(x);
    });
    return out;
  }

  // ---------- helpers ----------
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function isActive(u) { return !(u.active === false || u.active === 'FALSE' || u.active === 'false'); }

  function publicUser(u) {
    return { id: u.id, username: u.username, name: u.name, role: u.role, price: Number(u.price) || 0, active: isActive(u) };
  }

  function usersById(ctx) {
    var map = {};
    ctx.store.listUsers().forEach(function (u) { map[u.id] = u; });
    return map;
  }

  function bookingView(b, users, lastPaidAt) {
    var u = users && users[b.studentId];
    var v = {
      id: b.id, studentId: b.studentId, studentName: u ? u.name : '',
      start: Number(b.start), end: Number(b.end), status: b.status,
      note: b.note || '', createdAt: Number(b.createdAt) || null
    };
    if (lastPaidAt !== undefined) v.paid = v.status === 'booked' && v.end <= lastPaidAt;
    return v;
  }

  function paymentsOf(studentId, ctx) {
    return ctx.store.listPayments()
      .filter(function (p) { return p.studentId === studentId; })
      .sort(function (a, b) { return a.at - b.at; });
  }

  function lessonsOf(studentId, ctx) {
    return ctx.store.listBookings()
      .filter(function (b) { return b.studentId === studentId; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  /** Lessons that ended in (after, upTo] and were not cancelled. */
  function completedBetween(lessons, after, upTo) {
    return lessons.filter(function (b) { return b.status === 'booked' && b.end > after && b.end <= upTo; });
  }

  /** What the student owes at time `at`: lessons ended since the last payment before `at`. */
  function dueAt(student, at, ctx) {
    var pays = paymentsOf(student.id, ctx).filter(function (p) { return p.at < at; });
    var prev = pays.length ? pays[pays.length - 1].at : 0;
    var count = completedBetween(lessonsOf(student.id, ctx), prev, at).length;
    var price = Number(student.price) || 0;
    return { count: count, price: price, amount: count * price, since: prev || null };
  }

  function billing(student, ctx) {
    var now = ctx.now, users = usersById(ctx);
    var pays = paymentsOf(student.id, ctx);
    var lessons = lessonsOf(student.id, ctx);
    var last = pays.length ? pays[pays.length - 1].at : 0;
    var unpaid = completedBetween(lessons, last, now);
    var price = Number(student.price) || 0;
    var prevAt = 0;
    var history = pays.map(function (p) {
      var covered = completedBetween(lessons, prevAt, p.at).length;
      prevAt = p.at;
      return { id: p.id, at: Number(p.at), amount: Number(p.amount) || 0, note: p.note || '', lessons: covered };
    }).reverse();
    return {
      student: publicUser(student),
      price: price,
      lastPaymentAt: last || null,
      unpaid: unpaid.map(function (b) { return bookingView(b, users); }),
      unpaidCount: unpaid.length,
      debt: unpaid.length * price,
      totalLessons: completedBetween(lessons, 0, now).length,
      upcoming: lessons.filter(function (b) { return b.status === 'booked' && b.start > now; }).length,
      payments: history,
      bank: ctx.bank || null // tutor's account for the VietQR code; only sent to signed-in users
    };
  }

  /** Students only see fees once they have at least STUDENT_FEES_MIN_LESSONS unpaid lessons. */
  function feesVisible(u, ctx) {
    if (u.role !== 'student') return true;
    var min = Number(ctx.rules.STUDENT_FEES_MIN_LESSONS) || 0;
    return !min || billing(u, ctx).unpaidCount >= min;
  }

  // ---------- auth ----------
  function requireUser(token, ctx) {
    if (!token) throw fail('unauthorized');
    var uid = ctx.store.getSession(token);
    var u = uid && ctx.store.getUser(uid);
    if (!u || !isActive(u)) throw fail('unauthorized');
    return u;
  }

  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 6) throw fail('weak_password');
  }

  function login(p, ctx) {
    var username = String(p.username || '').trim().toLowerCase();
    if (!username || !p.password) throw fail('bad_credentials');
    if (ctx.limiter.isLocked(username)) throw fail('locked');
    var u = ctx.store.findUserByUsername(username);
    if (!u || !isActive(u) || ctx.auth.hash(String(p.password), u.salt) !== u.hash) {
      ctx.limiter.fail(username);
      throw fail('bad_credentials');
    }
    ctx.limiter.reset(username);
    return { token: ctx.store.createSession(u.id), user: publicUser(u), bank: ctx.bank || null, feesVisible: feesVisible(u, ctx) };
  }

  // ---------- schedule & booking ----------
  function schedule(p, me, ctx) {
    var rules = ctx.rules, now = ctx.now, admin = me.role === 'admin';
    var win = bookingWindow(now, rules);
    var from, to;
    if (admin) {
      from = Number(p.from) || dayStart(now);
      to = Number(p.to) || from + 7 * DAY;
      if (to - from > 42 * DAY) to = from + 42 * DAY;
    } else {
      from = win.from; to = win.to;
    }
    var users = usersById(ctx);
    var cal = ctx.calendar.events(from, to);
    var bookings = ctx.store.listBookings().filter(function (b) {
      return b.status === 'booked' && b.end > from && b.start < to;
    });
    var events = [], lastPaid = {};
    ctx.store.listPayments().forEach(function (x) { lastPaid[x.studentId] = Math.max(lastPaid[x.studentId] || 0, Number(x.at)); });
    if (admin) {
      cal.forEach(function (e) {
        events.push({ kind: 'calendar', id: e.id, start: e.start, end: e.end, title: e.title || '', location: e.location || '', calendar: e.calendar || '' });
      });
      bookings.forEach(function (b) { var v = bookingView(b, users, lastPaid[b.studentId] || 0); v.kind = 'booking'; events.push(v); });
    } else {
      // Students only see that the tutor is busy — never what or with whom.
      var busy = cal.slice();
      bookings.forEach(function (b) {
        if (b.studentId === me.id) { var v = bookingView(b, users, lastPaid[b.studentId] || 0); v.kind = 'booking'; events.push(v); }
        else busy.push(b);
      });
      mergeIntervals(busy).forEach(function (x) { events.push({ kind: 'busy', start: x.start, end: x.end }); });
    }
    var res = { from: from, to: to, window: win, now: now, events: events };
    if (admin) {
      res.payments = ctx.store.listPayments()
        .filter(function (x) { return x.at >= from && x.at < to; })
        .map(function (x) {
          var u = users[x.studentId];
          return { id: x.id, studentId: x.studentId, studentName: u ? u.name : '', at: Number(x.at), amount: Number(x.amount) || 0, note: x.note || '' };
        });
    }
    return res;
  }

  function book(p, me, ctx) {
    var admin = me.role === 'admin', rules = ctx.rules, now = ctx.now;
    var start = Number(p.start);
    if (!isFinite(start) || start <= 0) throw fail('bad_request');
    var student = admin ? ctx.store.getUser(p.studentId) : me;
    if (!student || student.role !== 'student' || !isActive(student)) throw fail('not_found');
    var end = start + rules.SESSION_MINUTES * MIN;
    var win = bookingWindow(now, rules);
    var busy = ctx.calendar.events(start - DAY, end + DAY)
      .concat(ctx.store.listBookings().filter(function (b) { return b.status === 'booked'; }));
    var code = slotError(start, busy, now, rules, win, admin);
    if (code) throw fail(code);
    if (!admin && rules.MAX_BOOKINGS_PER_WINDOW > 0) {
      var mine = ctx.store.listBookings().filter(function (b) {
        return b.studentId === me.id && b.status === 'booked' && b.start >= win.from && b.start < win.to;
      }).length;
      if (mine >= rules.MAX_BOOKINGS_PER_WINDOW) throw fail('limit_reached');
    }
    var b = {
      id: ctx.auth.newId(), studentId: student.id, start: start, end: end, status: 'booked',
      note: String(p.note || '').slice(0, 300), createdAt: now, createdBy: me.id, calendarEventId: ''
    };
    try { b.calendarEventId = ctx.calendar.onBooked(b, student) || ''; } catch (e) { /* calendar copy is best-effort */ }
    ctx.store.insertBooking(b);
    if (ctx.notify) { try { ctx.notify('booked', b, student, me); } catch (e) { /* ignore */ } }
    return { booking: bookingView(b, usersById(ctx)) };
  }

  function findBooking(id, ctx) {
    var b = ctx.store.listBookings().filter(function (x) { return x.id === id; })[0];
    if (!b) throw fail('not_found');
    return b;
  }

  function cancelBooking(p, me, ctx) {
    var b = findBooking(p.id, ctx);
    var admin = me.role === 'admin';
    if (!admin && b.studentId !== me.id) throw fail('forbidden');
    if (b.status !== 'booked') throw fail('not_found');
    if (!admin && b.start - ctx.now < ctx.rules.CANCEL_MIN_HOURS * HOUR) throw fail('cancel_too_late');
    ctx.store.updateBooking(b.id, { status: 'cancelled', cancelledAt: ctx.now });
    try { ctx.calendar.onCancelled(b); } catch (e) { /* ignore */ }
    if (ctx.notify) { try { ctx.notify('cancelled', b, ctx.store.getUser(b.studentId), me); } catch (e) { /* ignore */ } }
    return { ok: true };
  }

  function restoreBooking(p, me, ctx) {
    var b = findBooking(p.id, ctx);
    if (b.status === 'booked') return { ok: true };
    var others = ctx.store.listBookings().filter(function (x) { return x.status === 'booked' && x.id !== b.id; });
    if (slotError(Number(b.start), others, ctx.now, ctx.rules, null, true)) throw fail('conflict');
    var student = ctx.store.getUser(b.studentId);
    var eventId = '';
    try { eventId = ctx.calendar.onBooked(b, student) || ''; } catch (e) { /* ignore */ }
    ctx.store.updateBooking(b.id, { status: 'booked', cancelledAt: '', calendarEventId: eventId });
    return { ok: true };
  }

  function listBookingsFor(studentId, ctx) {
    var users = usersById(ctx);
    var pays = paymentsOf(studentId, ctx);
    var last = pays.length ? pays[pays.length - 1].at : 0;
    return lessonsOf(studentId, ctx).reverse().map(function (b) { return bookingView(b, users, last); });
  }

  // ---------- students (admin) ----------
  function studentOr404(id, ctx) {
    var u = ctx.store.getUser(id);
    if (!u || u.role !== 'student') throw fail('not_found');
    return u;
  }

  function listStudents(ctx) {
    return ctx.store.listUsers()
      .filter(function (u) { return u.role === 'student'; })
      .map(function (u) {
        var b = billing(u, ctx);
        var pu = publicUser(u);
        pu.unpaidCount = b.unpaidCount; pu.debt = b.debt; pu.upcoming = b.upcoming;
        pu.lastPaymentAt = b.lastPaymentAt; pu.totalLessons = b.totalLessons;
        return pu;
      })
      .sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
  }

  function createStudent(p, ctx) {
    var username = String(p.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw fail('bad_username');
    if (ctx.store.findUserByUsername(username)) throw fail('username_taken');
    checkPassword(p.password);
    var name = String(p.name || '').trim().slice(0, 80);
    if (!name) throw fail('bad_request');
    var salt = ctx.auth.newSalt();
    var u = {
      id: ctx.auth.newId(), username: username, name: name, role: 'student',
      salt: salt, hash: ctx.auth.hash(p.password, salt),
      price: Math.max(0, Number(p.price) || 0), active: true, createdAt: ctx.now
    };
    ctx.store.insertUser(u);
    return { user: publicUser(u) };
  }

  function updateStudent(p, ctx) {
    var u = studentOr404(p.id, ctx);
    var patch = {};
    if (p.name !== undefined) { patch.name = String(p.name).trim().slice(0, 80); if (!patch.name) throw fail('bad_request'); }
    if (p.price !== undefined) patch.price = Math.max(0, Number(p.price) || 0);
    if (p.active !== undefined) patch.active = !!p.active;
    ctx.store.updateUser(u.id, patch);
    if (patch.active === false) ctx.store.deleteSessionsFor(u.id);
    return { user: publicUser(ctx.store.getUser(u.id)) };
  }

  function setPassword(u, pw, ctx) {
    checkPassword(pw);
    var salt = ctx.auth.newSalt();
    ctx.store.updateUser(u.id, { salt: salt, hash: ctx.auth.hash(pw, salt) });
  }

  // ---------- payments (admin) ----------
  function addPayment(p, ctx) {
    var student = studentOr404(p.studentId, ctx);
    var at = Number(p.at) || ctx.now;
    var amount = (p.amount === null || p.amount === undefined || p.amount === '')
      ? dueAt(student, at, ctx).amount
      : Math.max(0, Number(p.amount) || 0);
    var pay = { id: ctx.auth.newId(), studentId: student.id, at: at, amount: amount, note: String(p.note || '').slice(0, 200), createdAt: ctx.now };
    ctx.store.insertPayment(pay);
    return { payment: pay, billing: billing(student, ctx) };
  }

  // ---------- dispatcher ----------
  function handle(action, p, ctx) {
    p = p || {};
    if (action === 'ping') return { pong: true, now: ctx.now };
    if (action === 'config') return { rules: ctx.rules, tutorName: ctx.tutorName, now: ctx.now };
    if (action === 'login') return login(p, ctx);

    var me = requireUser(p.token, ctx);
    var admin = me.role === 'admin';
    function adminOnly() { if (!admin) throw fail('forbidden'); }

    switch (action) {
      case 'me': return { user: publicUser(me), bank: ctx.bank || null, feesVisible: feesVisible(me, ctx) };
      case 'logout': ctx.store.deleteSession(p.token); return { ok: true };
      case 'changePassword':
        if (ctx.auth.hash(String(p.oldPassword || ''), me.salt) !== me.hash) throw fail('bad_credentials');
        setPassword(me, p.newPassword, ctx);
        return { ok: true };

      case 'schedule': return schedule(p, me, ctx);
      case 'book': return book(p, me, ctx);
      case 'cancelBooking': return cancelBooking(p, me, ctx);
      case 'restoreBooking': adminOnly(); return restoreBooking(p, me, ctx);
      case 'bookings':
        if (admin) { studentOr404(p.studentId, ctx); return { bookings: listBookingsFor(p.studentId, ctx) }; }
        return { bookings: listBookingsFor(me.id, ctx), feesVisible: feesVisible(me, ctx) };

      case 'billing':
        if (!admin && !feesVisible(me, ctx)) return { hidden: true };
        return billing(admin ? studentOr404(p.studentId, ctx) : me, ctx);
      case 'dueAt': adminOnly(); return dueAt(studentOr404(p.studentId, ctx), Number(p.at) || ctx.now, ctx);
      case 'addPayment': adminOnly(); return addPayment(p, ctx);
      case 'deletePayment': adminOnly(); ctx.store.deletePayment(p.id); return { ok: true };

      case 'listStudents': adminOnly(); return { students: listStudents(ctx) };
      case 'createStudent': adminOnly(); return createStudent(p, ctx);
      case 'updateStudent': adminOnly(); return updateStudent(p, ctx);
      case 'resetPassword': adminOnly();
        var st = studentOr404(p.id, ctx);
        setPassword(st, p.password, ctx);
        ctx.store.deleteSessionsFor(st.id);
        return { ok: true };
    }
    throw fail('bad_request');
  }

  return {
    MIN: MIN, HOUR: HOUR, DAY: DAY, OFFSET: OFFSET,
    dayStart: dayStart, weekday: weekday, minuteOfDay: minuteOfDay,
    bookingWindow: bookingWindow, slotError: slotError, mergeIntervals: mergeIntervals,
    handle: handle
  };
})();
