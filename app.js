/* TutorBook — interface. Depends on: config.js, i18n.js, core.js, api.js */
(function () {
  'use strict';

  var Core = window.TutorCore, Api = window.TutorApi, I18N = window.I18N;
  var CFG = window.APP_CONFIG || {};
  var MIN = Core.MIN, HOUR = Core.HOUR, DAY = Core.DAY, OFF = Core.OFFSET;
  var HOUR_PX = 52;

  // ---------------- small utilities ----------------
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  var S = {
    lang: ls.get('tb-lang') || CFG.DEFAULT_LANG || 'vi',
    token: ls.get('tb-token'),
    user: null, rules: null, tutorName: CFG.TUTOR_NAME || '', skew: 0,
    tab: null, data: {}, loading: false,
    weekStart: null, dayIdx: null, payMode: false, feesStudentId: null,
    evMap: {}, evSeq: 0, grid: null
  };
  function now() { return Date.now() + S.skew; }
  function isAdmin() { return S.user && S.user.role === 'admin'; }
  function narrow() { return window.matchMedia('(max-width: 760px)').matches; }

  function t(key, vars) {
    var dict = I18N[S.lang] || I18N.vi;
    var s = dict[key];
    if (s == null) s = I18N.vi[key];
    if (s == null) return key;
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? '' : vars[k]; });
    return s;
  }

  // ---------------- Vietnam-time formatting ----------------
  function parts(ms) {
    var d = new Date(ms + OFF);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
  }
  function fmtTime(ms) { var p = parts(ms); return pad(p.h) + ':' + pad(p.mi); }
  function fmtRange(a, b) { return fmtTime(a) + ' – ' + fmtTime(b); }
  function fmtDay(ms) { var p = parts(ms); return t('daysShort')[p.wd] + ' ' + pad(p.d) + '/' + pad(p.m); }
  function fmtDayLong(ms) { var p = parts(ms); return t('daysLong')[p.wd] + ', ' + pad(p.d) + '/' + pad(p.m) + '/' + p.y; }
  function fmtStamp(ms) { var p = parts(ms); return pad(p.d) + '/' + pad(p.m) + '/' + p.y + ' ' + pad(p.h) + ':' + pad(p.mi); }
  function toInput(ms) { var p = parts(ms); return p.y + '-' + pad(p.m) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi); }
  function fromInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - OFF : NaN;
  }
  function money(n) {
    try { return new Intl.NumberFormat(S.lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n || 0); }
    catch (e) { return (n || 0) + ' VND'; }
  }
  function sundayOf(ms) { var d = Core.dayStart(ms); return d - Core.weekday(d) * DAY; }

  // ---------------- API ----------------
  function api(action, payload) {
    var body = Object.assign({ action: action, token: S.token }, payload || {});
    return Api.request(body).then(function (res) {
      if (!res || !res.ok) {
        var e = new Error((res && res.error) || 'server');
        e.code = (res && res.error) || 'server';
        if (e.code === 'unauthorized' && S.user) { dropSession(); toast(t('err_unauthorized'), 'bad'); }
        throw e;
      }
      return res.data;
    });
  }
  function errText(e) {
    var k = 'err_' + ((e && e.code) || 'server');
    var s = t(k);
    return s === k ? t('err_server') : s;
  }
  function dropSession() {
    S.token = null; S.user = null; S.data = {}; ls.set('tb-token', null);
    renderLogin();
  }

  // ---------------- toast & modal ----------------
  function toast(msg, kind) {
    var root = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'good');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 3800);
  }

  function openModal(o) {
    var root = $('#modal-root');
    root.innerHTML =
      '<div class="scrim" data-close></div>' +
      '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="m-head"><h2 id="m-title">' + o.title + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="' + t('close') + '">&times;</button></div>' +
      '<div class="m-body">' + o.body + '</div>' +
      (o.foot ? '<div class="m-foot">' + o.foot + '</div>' : '') +
      '</div>';
    root.hidden = false;
    var modal = $('.modal', root);
    root.onclick = function (e) { if (e.target.closest('[data-close]')) closeModal(); };
    if (o.mount) o.mount(modal);
    var f = modal.querySelector('input:not([type=hidden]),select,textarea,button.primary');
    if (f) setTimeout(function () { f.focus(); }, 30);
    return modal;
  }
  function closeModal() { var r = $('#modal-root'); r.hidden = true; r.innerHTML = ''; r.onclick = null; }

  /** Two-step confirm for destructive buttons. Returns true on the second click. */
  function armed(btn) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = t('clickAgain');
    btn.classList.add('armed');
    setTimeout(function () {
      if (!btn.isConnected) return;
      delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.classList.remove('armed');
    }, 4000);
    return false;
  }
  function busyBtn(btn, on) { if (!btn) return; btn.disabled = on; btn.classList.toggle('loading', on); }

  // ---------------- boot & session ----------------
  function boot() {
    document.documentElement.lang = S.lang;
    $('#app').innerHTML = '<div class="boot"><span class="mark">2h</span><p>' + t('loading') + '</p></div>';
    api('config').then(function (c) {
      S.rules = c.rules;
      S.tutorName = c.tutorName || S.tutorName;
      if (c.now && Math.abs(c.now - Date.now()) > MIN) S.skew = c.now - Date.now();
      if (!S.token) return renderLogin();
      return api('me').then(function (r) { S.user = r.user; S.bank = r.bank; S.feesVisible = r.feesVisible !== false; enterApp(); }, function () { dropSession(); });
    }, function (e) {
      $('#app').innerHTML = '<div class="boot fatal"><span class="mark">!</span><h1>' + t('fatalTitle') + '</h1><p>' + esc(errText(e)) + '</p><p class="muted">' + t('fatalHint') + '</p></div>';
    });
  }

  function renderLogin() {
    var demo = Api.demo;
    $('#app').innerHTML =
      '<main class="login-wrap">' +
      '<section class="login-card">' +
      '<div class="login-brand"><span class="mark">2h</span><div><h1>' + t('appName') + '</h1><p>' + esc(S.tutorName) + '</p></div>' +
      '<button type="button" class="chip-btn" data-act="lang">' + t('otherLang') + '</button></div>' +
      '<p class="login-lead">' + t('loginLead') + '</p>' +
      '<form id="login-form" novalidate>' +
      '<label class="field"><span>' + t('username') + '</span><input id="li-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
      '<label class="field"><span>' + t('password') + '</span><input id="li-pass" name="password" type="password" autocomplete="current-password" required></label>' +
      '<p class="form-error" id="li-err" hidden></p>' +
      '<button class="btn primary block" type="submit" id="li-go">' + t('loginBtn') + '</button>' +
      '</form>' +
      (demo ? '<div class="demo-box"><b>' + t('demoMode') + '</b><p>' + t('demoHint') + '</p>' +
        '<div class="demo-accounts">' +
        '<button type="button" class="demo-acc" data-user="admin" data-pass="admin123"><span>' + t('roleAdmin') + '</span><code>admin / admin123</code></button>' +
        '<button type="button" class="demo-acc" data-user="minhkhoa" data-pass="hocvien123"><span>' + t('roleStudent') + '</span><code>minhkhoa / hocvien123</code></button>' +
        '</div></div>' : '') +
      '</section></main>';

    $('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#li-go'), err = $('#li-err');
      err.hidden = true; busyBtn(btn, true);
      api('login', { username: $('#li-user').value, password: $('#li-pass').value }).then(function (r) {
        S.token = r.token; S.user = r.user; S.bank = r.bank; S.feesVisible = r.feesVisible !== false; ls.set('tb-token', r.token);
        enterApp();
      }, function (e2) {
        busyBtn(btn, false); err.textContent = errText(e2); err.hidden = false;
      });
    });
    document.querySelectorAll('.demo-acc').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#li-user').value = b.dataset.user; $('#li-pass').value = b.dataset.pass;
        $('#login-form').requestSubmit();
      });
    });
  }

  function enterApp() {
    S.data = {}; S.payMode = false; S.dayIdx = null;
    S.weekStart = sundayOf(now());
    S.tab = isAdmin() ? 'calendar' : 'book';
    loadTab();
  }

  // ---------------- data loading per tab ----------------
  function loadTab() {
    S.loading = true; renderApp();
    var tab = S.tab, jobs;
    if (tab === 'book') jobs = [api('schedule').then(function (r) { S.data.schedule = r; })];
    else if (tab === 'lessons') jobs = [api('bookings').then(function (r) { S.data.bookings = r.bookings; S.feesVisible = r.feesVisible !== false; })];
    else if (tab === 'fees' && !isAdmin()) jobs = [api('billing').then(function (r) {
      if (r.hidden) { S.feesVisible = false; S.tab = 'book'; S.data.billing = null; return loadTab(); }
      S.data.billing = r;
    })];
    else if (tab === 'calendar') jobs = [
      api('schedule', { from: S.weekStart, to: S.weekStart + 7 * DAY }).then(function (r) { S.data.schedule = r; }),
      api('listStudents').then(function (r) { S.data.students = r.students; })
    ];
    else if (tab === 'students') jobs = [api('listStudents').then(function (r) { S.data.students = r.students; })];
    else if (tab === 'fees') jobs = [api('listStudents').then(function (r) {
      S.data.students = r.students;
      var ids = r.students.map(function (s) { return s.id; });
      if (ids.indexOf(S.feesStudentId) < 0) {
        var owing = r.students.filter(function (s) { return s.debt > 0 && s.active; })[0];
        S.feesStudentId = (owing || r.students[0] || {}).id || null;
      }
      if (!S.feesStudentId) { S.data.billing = null; return; }
      return Promise.all([
        api('billing', { studentId: S.feesStudentId }).then(function (b) { S.data.billing = b; }),
        api('bookings', { studentId: S.feesStudentId }).then(function (b) { S.data.bookings = b.bookings; })
      ]);
    })];
    return Promise.all(jobs).then(function () {
      if (tab !== S.tab) return;
      S.loading = false; renderApp();
    }, function (e) {
      S.loading = false;
      if (e.code !== 'unauthorized') { renderApp(); toast(errText(e), 'bad'); }
    });
  }

  // ---------------- shell ----------------
  function tabsFor() {
    return isAdmin()
      ? [['calendar', t('tabCalendar')], ['fees', t('tabFees')], ['students', t('tabStudents')]]
      : [['book', t('tabBook')], ['lessons', t('tabLessons')]].concat(S.feesVisible ? [['fees', t('tabMyFees')]] : []);
  }

  function renderApp() {
    if (!S.user) return;
    var u = S.user;
    var tabs = tabsFor().map(function (x) {
      return '<button type="button" class="tab' + (S.tab === x[0] ? ' on' : '') + '" data-act="tab" data-tab="' + x[0] + '"' + (S.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</button>';
    }).join('');
    var initials = u.name.split(/\s+/).slice(-1)[0].charAt(0).toUpperCase();
    $('#app').innerHTML =
      '<header class="bar">' +
      '<div class="bar-in">' +
      '<div class="brand"><span class="mark">2h</span><div><b>' + t('appName') + '</b><small>' + esc(S.tutorName) + '</small></div></div>' +
      '<nav class="tabs" aria-label="' + t('appName') + '">' + tabs + '</nav>' +
      '<div class="bar-right">' +
      (Api.demo ? '<span class="pill demo">' + t('demoMode') + '</span>' : '') +
      '<button type="button" class="chip-btn" data-act="lang" aria-label="Language">' + t('otherLang') + '</button>' +
      '<details class="menu"><summary aria-label="' + t('account') + '"><span class="avatar">' + esc(initials) + '</span></summary>' +
      '<div class="menu-pop"><div class="menu-who"><b>' + esc(u.name) + '</b><span>@' + esc(u.username) + ' · ' + (isAdmin() ? t('roleAdmin') : t('roleStudent')) + '</span></div>' +
      '<button type="button" data-act="changePw">' + t('changePassword') + '</button>' +
      (Api.demo ? '<button type="button" data-act="resetDemo">' + t('resetDemo') + '</button>' : '') +
      '<button type="button" data-act="logout">' + t('logout') + '</button></div></details>' +
      '</div></div></header>' +
      '<main class="main" id="main">' + (S.loading && !hasData() ? loadingHTML() : viewHTML()) + '</main>';
    afterRender();
  }
  function hasData() {
    var d = S.data;
    switch (S.tab) {
      case 'book': case 'calendar': return !!d.schedule && (S.tab === 'book' || !!d.students);
      case 'lessons': return !!d.bookings;
      case 'fees': return isAdmin() ? !!d.students : !!d.billing;
      case 'students': return !!d.students;
    }
    return false;
  }
  function loadingHTML() { return '<div class="loading-view"><span class="spinner"></span>' + t('loading') + '</div>'; }

  function viewHTML() {
    switch (S.tab) {
      case 'book': return bookViewHTML();
      case 'lessons': return lessonsViewHTML();
      case 'fees': return isAdmin() ? adminFeesHTML() : studentFeesHTML();
      case 'calendar': return adminCalendarHTML();
      case 'students': return studentsHTML();
    }
    return '';
  }

  function afterRender() {
    var cal = $('.cal-scroll');
    if (cal && S.tab === 'calendar' && !cal.dataset.scrolled) {
      cal.dataset.scrolled = '1';
    }
  }

  // ---------------- calendar grid ----------------
  function layoutLanes(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var cluster = [], end = -Infinity;
    function flush() {
      var lanes = [];
      cluster.forEach(function (it) {
        var l = -1;
        for (var i = 0; i < lanes.length; i++) if (lanes[i] <= it.s) { l = i; break; }
        if (l < 0) { l = lanes.length; lanes.push(it.e); } else lanes[l] = it.e;
        it.lane = l;
      });
      cluster.forEach(function (it) { it.lanes = lanes.length; });
      cluster = [];
    }
    items.forEach(function (it) {
      if (cluster.length && it.s >= end) { flush(); end = -Infinity; }
      cluster.push(it); end = Math.max(end, it.e);
    });
    if (cluster.length) flush();
    return items;
  }

  function calendarHTML(o) {
    var gs = o.gs, ge = o.ge, n = now();
    var H = (ge - gs) * HOUR_PX;
    S.grid = { gs: gs, ge: ge, mode: o.mode };
    S.evMap = {};
    var cols = '3.25rem repeat(' + o.days.length + ', minmax(0, 1fr))';
    var head = '<div class="cal-head" style="grid-template-columns:' + cols + '"><div class="tz">GMT+7</div>' +
      o.days.map(function (d) {
        var p = parts(d), today = d === Core.dayStart(n);
        return '<div class="dh' + (today ? ' today' : '') + (d + DAY <= n ? ' gone' : '') + '"><span>' + t('daysShort')[p.wd] + '</span><b>' + p.d + '</b></div>';
      }).join('') + '</div>';
    var hours = '';
    for (var h = gs + 1; h < ge; h++) hours += '<span style="top:' + ((h - gs) * HOUR_PX) + 'px">' + pad(h) + ':00</span>';
    var body = o.days.map(function (d) { return colHTML(d, o, H, n); }).join('');
    return '<div class="cal ' + o.mode + (S.payMode ? ' paying' : '') + '" style="--hp:' + HOUR_PX + 'px">' + head +
      '<div class="cal-body" style="grid-template-columns:' + cols + ';height:' + H + 'px"><div class="hours" aria-hidden="true">' + hours + '</div>' + body + '</div></div>';
  }

  function colHTML(d, o, H, n) {
    var gs = o.gs, ge = o.ge;
    var lo = d + gs * HOUR, hi = d + ge * HOUR;
    var y = function (ms) { return (ms - lo) / HOUR * HOUR_PX; };
    var html = '';
    if (n > lo) { var ph = Math.min(H, y(n)); if (ph > 0) html += '<div class="past" style="height:' + ph + 'px"></div>'; }
    var segs = [];
    o.events.forEach(function (ev) {
      var s = Math.max(ev.start, lo), e = Math.min(ev.end, hi);
      if (e > s) segs.push({ ev: ev, s: s, e: e });
    });
    if (o.mode === 'student') {
      var buf = S.rules.BUFFER_MINUTES * MIN;
      o.events.forEach(function (ev) {
        var s = Math.max(ev.start - buf, lo), e = Math.min(ev.end + buf, hi);
        if (e > s) html += '<div class="c-buf" style="top:' + y(s) + 'px;height:' + (y(e) - y(s)) + 'px"></div>';
      });
    }
    layoutLanes(segs).forEach(function (sg) { html += eventHTML(sg, y); });
    (o.payments || []).forEach(function (p) {
      if (p.at < lo || p.at >= hi) return;
      var key = 'p' + (++S.evSeq); S.evMap[key] = p;
      html += '<button type="button" class="c-pay" data-pay="' + key + '" style="top:' + y(p.at) + 'px" title="' + esc(t('paidAt', { time: fmtStamp(p.at) })) + '">' +
        '<span>' + t('paidShort') + ' ' + money(p.amount) + ' · ' + esc(firstName(p.studentName)) + '</span></button>';
    });
    if (n >= lo && n < hi) html += '<div class="now" style="top:' + y(n) + 'px"></div>';
    return '<div class="col" data-day="' + d + '">' + html + '</div>';
  }

  function firstName(name) { var p = String(name || '').trim().split(/\s+/); return p[p.length - 1] || ''; }

  function eventHTML(sg, y) {
    var ev = sg.ev, key = 'e' + (++S.evSeq);
    S.evMap[key] = ev;
    var top = y(sg.s), h = Math.max(16, y(sg.e) - top - 2);
    var w = 100 / sg.lanes, left = sg.lane * w;
    var cls = 'ev', title, sub = '';
    if (ev.kind === 'busy') { cls += ' busy'; title = t('busy'); }
    else if (ev.kind === 'calendar') { cls += ' cal-ev'; title = ev.title || t('busy'); sub = ev.location; }
    else {
      cls += ' bk' + (ev.end <= now() ? ' done' : '');
      title = isAdmin() ? firstName(ev.studentName) + ' · ' + t('lesson') : t('yourLesson');
    }
    if (h < 38) cls += ' compact';
    var tag = ev.kind === 'busy' ? 'div' : 'button';
    var label = esc(title) + ', ' + fmtRange(ev.start, ev.end);
    return '<' + tag + (tag === 'button' ? ' type="button" data-ev="' + key + '" aria-label="' + label + '"' : '') + ' class="' + cls + '" style="top:' + top + 'px;height:' + h + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px)">' +
      '<b>' + esc(title) + '</b><span>' + fmtRange(ev.start, ev.end) + (sub ? ' · ' + esc(sub) : '') + '</span></' + tag + '>';
  }

  function dayChipsHTML(days, counts) {
    return '<div class="day-chips" role="tablist">' + days.map(function (d, i) {
      var p = parts(d);
      return '<button type="button" role="tab" class="day-chip' + (i === S.dayIdx ? ' on' : '') + '" data-act="day" data-idx="' + i + '" aria-selected="' + (i === S.dayIdx) + '">' +
        '<span>' + t('daysShort')[p.wd] + '</span><b>' + p.d + '</b>' + (counts ? '<i>' + (counts[i] ? counts[i] : '–') + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }

  // ---------------- student: booking ----------------
  function windowDays(sc) { var out = []; for (var d = sc.window.from; d < sc.window.to; d += DAY) out.push(d); return out; }

  function openings() {
    var sc = S.data.schedule, r = S.rules, busy = sc.events, n = now();
    return windowDays(sc).map(function (d) {
      var starts = [];
      for (var m = r.DAY_START_HOUR * 60; m + r.SESSION_MINUTES <= r.DAY_END_HOUR * 60; m += r.SLOT_STEP_MINUTES) {
        var s = d + m * MIN;
        if (!Core.slotError(s, busy, n, r, sc.window, false)) starts.push(s);
      }
      var ranges = [];
      starts.forEach(function (s) {
        var last = ranges[ranges.length - 1];
        if (last && s - last.to === r.SLOT_STEP_MINUTES * MIN) last.to = s; else ranges.push({ from: s, to: s });
      });
      return { day: d, starts: starts, ranges: ranges };
    });
  }

  function bookViewHTML() {
    var sc = S.data.schedule, r = S.rules;
    var days = windowDays(sc), opens = openings();
    if (S.dayIdx == null) {
      var first = opens.findIndex(function (o) { return o.starts.length; });
      S.dayIdx = first < 0 ? 0 : first;
    }
    var shown = narrow() ? [days[S.dayIdx]] : days;
    var mine = sc.events.filter(function (e) { return e.kind === 'booking' && e.start > now(); });
    return '<section class="view">' +
      '<div class="view-head"><div><h1>' + t('bookTitle') + '</h1>' +
      '<p class="lead">' + t('bookLead', { from: fmtDay(sc.window.from), to: fmtDay(sc.window.to - DAY), hours: r.SESSION_MINUTES / 60, buffer: r.BUFFER_MINUTES, start: pad(r.DAY_START_HOUR) + ':00', end: pad(r.DAY_END_HOUR) + ':00' }) + '</p></div>' +
      legendHTML(['open', 'mine', 'busy', 'buf']) + '</div>' +
      (mine.length ? '<div class="notice"><b>' + t('upcomingCount', { n: mine.length }) + '</b> ' + mine.map(function (b) { return fmtDay(b.start) + ' ' + fmtRange(b.start, b.end); }).join(' · ') + '</div>' : '') +
      '<div class="cal-layout single"><div class="cal-card">' +
      (narrow() ? dayChipsHTML(days, opens.map(function (o) { return o.starts.length; })) : '') +
      '<div class="cal-scroll">' + calendarHTML({ days: shown, events: sc.events, mode: 'student', gs: r.DAY_START_HOUR, ge: r.DAY_END_HOUR }) + '</div>' +
      '<p class="cal-tip">' + t('calTipStudent') + '</p></div></div></section>';
  }

  function legendHTML(keys) {
    return '<ul class="legend">' + keys.map(function (k) { return '<li><i class="sw sw-' + k + '"></i>' + t('lg_' + k) + '</li>'; }).join('') + '</ul>';
  }

  function openBookModal(day, pre) {
    var o = openings().filter(function (x) { return x.day === day; })[0];
    if (!o || !o.starts.length) { toast(t('noOpenings'), 'bad'); return; }
    if (o.starts.indexOf(pre) < 0) pre = o.starts[0];
    var len = S.rules.SESSION_MINUTES * MIN;
    openModal({
      title: t('bookModalTitle'),
      body: '<p class="m-date">' + fmtDayLong(day) + '</p>' +
        '<label class="field"><span>' + t('time') + '</span><select id="bk-start">' + o.starts.map(function (s) {
          return '<option value="' + s + '"' + (s === pre ? ' selected' : '') + '>' + fmtRange(s, s + len) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field"><span>' + t('noteOptional') + '</span><textarea id="bk-note" rows="2" maxlength="300" placeholder="' + t('notePlaceholder') + '"></textarea></label>' +
        '<div class="m-sum"><span>' + t('sessionLength', { h: S.rules.SESSION_MINUTES / 60 }) + '</span><b>' + money(S.user.price) + '</b></div>' +
        '<p class="muted small">' + t('cancelRule', { h: S.rules.CANCEL_MIN_HOURS }) + '</p>' +
        '<p class="form-error" id="bk-err" hidden></p>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn primary" id="bk-go">' + t('confirmBooking') + '</button>',
      mount: function (m) {
        $('#bk-go', m).addEventListener('click', function () {
          var btn = this, err = $('#bk-err', m);
          busyBtn(btn, true); err.hidden = true;
          api('book', { start: Number($('#bk-start', m).value), note: $('#bk-note', m).value }).then(function () {
            closeModal(); toast(t('booked')); loadTab();
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
      }
    });
  }

  // ---------------- student: lessons ----------------
  function statusOf(b) {
    if (b.status === 'cancelled') return ['cancelled', t('st_cancelled')];
    if (b.end > now()) return b.start <= now() ? ['live', t('st_live')] : ['upcoming', t('st_upcoming')];
    if (!isAdmin() && !S.feesVisible) return ['done', t('st_done')];
    return b.paid ? ['paid', t('st_paid')] : ['unpaid', t('st_unpaid')];
  }

  function lessonRow(b, opts) {
    var st = statusOf(b);
    var canCancel = b.status === 'booked' && b.start > now() &&
      (isAdmin() || b.start - now() >= S.rules.CANCEL_MIN_HOURS * HOUR);
    return '<li class="lesson"><div class="when"><b>' + fmtDay(b.start) + '</b><span>' + fmtRange(b.start, b.end) + '</span></div>' +
      '<div class="what">' + (opts && opts.showName ? '<b>' + esc(b.studentName) + '</b>' : '') + (b.note ? '<span>' + esc(b.note) + '</span>' : '') + '</div>' +
      '<span class="pill ' + st[0] + '">' + st[1] + '</span>' +
      (canCancel && opts && opts.cancel ? '<button type="button" class="btn small ghost danger" data-act="cancelLesson" data-id="' + b.id + '">' + t('cancel') + '</button>' : '') +
      '</li>';
  }

  function lessonsViewHTML() {
    var list = S.data.bookings || [], n = now();
    var up = list.filter(function (b) { return b.status === 'booked' && b.end > n; }).reverse();
    var past = list.filter(function (b) { return !(b.status === 'booked' && b.end > n); });
    return '<section class="view narrow-view">' +
      '<div class="view-head"><div><h1>' + t('lessonsTitle') + '</h1><p class="lead">' + t('lessonsLead', { h: S.rules.CANCEL_MIN_HOURS }) + '</p></div></div>' +
      '<h2 class="sec">' + t('upcoming') + '</h2>' +
      (up.length ? '<ul class="lessons">' + up.map(function (b) { return lessonRow(b, { cancel: true }); }).join('') + '</ul>'
        : '<div class="empty"><p>' + t('noUpcoming') + '</p><button type="button" class="btn primary" data-act="tab" data-tab="book">' + t('tabBook') + '</button></div>') +
      '<h2 class="sec">' + t('history') + '</h2>' +
      (past.length ? '<ul class="lessons">' + past.map(function (b) { return lessonRow(b); }).join('') + '</ul>' : '<p class="none">' + t('noHistory') + '</p>') +
      '</section>';
  }

  function cancelLesson(id, btn) {
    if (!armed(btn)) return;
    busyBtn(btn, true);
    api('cancelBooking', { id: id }).then(function () { closeModal(); toast(t('cancelled')); loadTab(); },
      function (e) { busyBtn(btn, false); toast(errText(e), 'bad'); });
  }

  // ---------------- fees ----------------
  function feesSummaryHTML(b, admin) {
    return '<div class="debt-card' + (b.debt > 0 ? '' : ' clear') + '">' +
      '<span class="eyebrow">' + (admin ? t('debtOf', { name: esc(b.student.name) }) : t('yourDebt')) + '</span>' +
      '<div class="big num">' + money(b.debt) + '</div>' +
      '<div class="formula num"><span>' + b.unpaidCount + '</span> ' + t('lessonsUnit') + ' <i>×</i> <span>' + money(b.price) + '</span> <i>=</i> <b>' + money(b.debt) + '</b></div>' +
      '<p class="muted small">' + (b.lastPaymentAt ? t('sinceLast', { time: fmtStamp(b.lastPaymentAt) }) : t('noPaymentsYet')) + '</p>' +
      '<dl class="stats"><div><dt>' + t('statTotal') + '</dt><dd class="num">' + b.totalLessons + '</dd></div>' +
      '<div><dt>' + t('statUpcoming') + '</dt><dd class="num">' + b.upcoming + '</dd></div>' +
      '<div><dt>' + t('statPrice') + '</dt><dd class="num">' + money(b.price) + '</dd></div></dl>' +
      '</div>';
  }

  function paymentsListHTML(b, admin) {
    if (!b.payments.length) return '<p class="none">' + t('noPaymentsYet') + '</p>';
    return '<ul class="pays">' + b.payments.map(function (p) {
      return '<li><div class="when"><b>' + fmtStamp(p.at) + '</b><span>' + t('coveredLessons', { n: p.lessons }) + (p.note ? ' · ' + esc(p.note) : '') + '</span></div>' +
        '<b class="num amt">' + money(p.amount) + '</b>' +
        (admin ? '<button type="button" class="btn small ghost danger" data-act="delPay" data-id="' + p.id + '">' + t('delete') + '</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function unpaidListHTML(b, admin) {
    if (!b.unpaid.length) return '<p class="none">' + t('allPaid') + '</p>';
    return '<ul class="lessons">' + b.unpaid.slice().reverse().map(function (x) {
      return '<li class="lesson"><div class="when"><b>' + fmtDay(x.start) + '</b><span>' + fmtRange(x.start, x.end) + '</span></div>' +
        '<div class="what">' + (x.note ? '<span>' + esc(x.note) + '</span>' : '') + '</div>' +
        '<b class="num amt">' + money(b.price) + '</b>' +
        (admin ? '<button type="button" class="btn small ghost" data-act="voidLesson" data-id="' + x.id + '" title="' + t('voidHint') + '">' + t('voidLesson') + '</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function transferNote(username) { return 'HOCPHI ' + username; }

  function qrCardHTML(bank, amount, note, compact) {
    if (!bank || !window.VietQR) return '';
    var code;
    try { code = VietQR.svg(VietQR.payload(bank, amount, note), esc(t('qrTitle'))); } catch (e) { return ''; }
    return '<div class="qr-card' + (compact ? ' compact' : '') + '">' +
      '<div class="qr-img">' + code + '</div>' +
      '<div class="qr-info">' +
      '<span class="eyebrow">' + t('qrTitle') + '</span>' +
      '<b class="qr-bank">' + esc(bank.name) + '</b>' +
      '<div class="qr-acc"><span class="num">' + esc(bank.account) + '</span>' +
      '<button type="button" class="btn small ghost" data-act="copyText" data-text="' + esc(bank.account) + '">' + t('copy') + '</button></div>' +
      '<span class="qr-holder">' + esc(bank.holder) + '</span>' +
      '<dl class="qr-kv"><dt>' + t('amount') + '</dt><dd class="num">' + (amount > 0 ? money(amount) : t('qrAnyAmount')) + '</dd>' +
      '<dt>' + t('transferNote') + '</dt><dd><code>' + esc(VietQR.cleanNote(note)) + '</code></dd></dl>' +
      '</div></div>';
  }

  function studentFeesHTML() {
    var b = S.data.billing;
    var bank = b.bank || S.bank;
    return '<section class="view narrow-view">' +
      '<div class="view-head"><div><h1>' + t('feesTitle') + '</h1><p class="lead">' + t('feesLeadStudent') + '</p></div></div>' +
      feesSummaryHTML(b, false) +
      (bank ? '<h2 class="sec">' + t('payByQr') + '</h2>' + qrCardHTML(bank, b.debt, transferNote(S.user.username)) +
        '<p class="muted small qr-hint">' + (b.debt > 0 ? t('qrHintStudent') : t('qrHintNoDebt')) + '</p>' : '') +
      '<h2 class="sec">' + t('unpaidLessons') + '</h2>' + unpaidListHTML(b, false) +
      '<h2 class="sec">' + t('paymentHistory') + '</h2>' + paymentsListHTML(b, false) +
      '</section>';
  }

  function adminFeesHTML() {
    var studs = S.data.students || [];
    if (!studs.length) return '<section class="view narrow-view"><div class="view-head"><div><h1>' + t('tabFees') + '</h1></div></div>' +
      '<div class="empty"><p>' + t('noStudents') + '</p><button type="button" class="btn primary" data-act="tab" data-tab="students">' + t('addStudent') + '</button></div></section>';
    var b = S.data.billing;
    var picker = '<div class="seg" role="tablist">' + studs.map(function (s) {
      return '<button type="button" role="tab" class="seg-btn' + (s.id === S.feesStudentId ? ' on' : '') + (s.active ? '' : ' off') + '" data-act="feesStudent" data-id="' + s.id + '" aria-selected="' + (s.id === S.feesStudentId) + '">' +
        esc(s.name) + (s.debt > 0 ? '<i class="num">' + money(s.debt) + '</i>' : '') + '</button>';
    }).join('') + '</div>';
    if (!b) return '<section class="view narrow-view">' + picker + loadingHTML() + '</section>';
    var calc = '<div class="calc"><h2>' + t('calcTitle') + '</h2>' +
      '<label class="field"><span>' + t('lessonsCount') + '</span><div class="stepper">' +
      '<button type="button" class="icon-btn" data-act="lessonsStep" data-d="-1" aria-label="' + t('fewer') + '">−</button>' +
      '<input id="fee-lessons" type="number" inputmode="numeric" min="0" step="1" value="' + b.unpaidCount + '">' +
      '<button type="button" class="icon-btn" data-act="lessonsStep" data-d="1" aria-label="' + t('more') + '">+</button></div></label>' +
      '<p class="lessons-hint small" id="fee-lessons-hint">' + lessonsHint(b, b.unpaidCount) + '</p>' +
      '<label class="field"><span>' + t('pricePerSession') + '</span><div class="money-input"><input id="fee-price" type="number" inputmode="numeric" min="0" step="10000" value="' + b.price + '"><span>VND</span></div></label>' +
      '<div class="price-presets">' + [150000, 200000, 250000, 300000, 400000].map(function (v) {
        return '<button type="button" class="chip-btn' + (v === b.price ? ' on' : '') + '" data-act="pricePreset" data-v="' + v + '">' + money(v) + '</button>';
      }).join('') + '</div>' +
      '<div class="calc-out num" id="calc-out">' + calcLine(b.unpaidCount, b.price) + '</div>' +
      '<div id="calc-qr">' + qrCardHTML(b.bank || S.bank, b.unpaidCount * b.price, transferNote(b.student.username), true) + '</div>' +
      '<div class="calc-actions"><button type="button" class="btn ghost" data-act="savePrice" id="price-save" disabled>' + t('savePrice') + '</button>' +
      '<button type="button" class="btn primary" data-act="addPay">' + t('markPaid') + '</button></div>' +
      '<p class="muted small">' + t('markPaidHint') + '</p>' +
      (S.rules.STUDENT_FEES_MIN_LESSONS ? '<p class="muted small">' + t('feesThresholdHint', { n: S.rules.STUDENT_FEES_MIN_LESSONS }) + '</p>' : '') +
      '</div>';
    return '<section class="view">' +
      '<div class="view-head"><div><h1>' + t('tabFees') + '</h1><p class="lead">' + t('feesLeadAdmin') + '</p></div></div>' +
      picker +
      '<div class="fees-grid"><div class="fees-main">' + feesSummaryHTML(b, true) +
      '<h2 class="sec">' + t('unpaidLessons') + '</h2>' + unpaidListHTML(b, true) +
      '<h2 class="sec">' + t('paymentHistory') + '</h2>' + paymentsListHTML(b, true) +
      '<h2 class="sec">' + t('allLessons') + '</h2>' +
      ((S.data.bookings || []).length ? '<ul class="lessons">' + S.data.bookings.map(function (x) { return lessonRow(x, { cancel: true }); }).join('') + '</ul>' : '<p class="none">' + t('noHistory') + '</p>') +
      '</div>' + calc + '</div></section>';
  }
  function lessonsHint(b, n) {
    return n === b.unpaidCount
      ? t('lessonsAuto', { n: b.unpaidCount })
      : t('lessonsManual', { n: b.unpaidCount }) + ' <button type="button" class="link-btn" data-act="lessonsAuto">' + t('resetToAuto') + '</button>';
  }
  function calcLine(count, price) {
    return '<span>' + count + ' ' + t('lessonsUnit') + '</span><i>×</i><span>' + money(price) + '</span><i>=</i><b>' + money(count * price) + '</b>';
  }

  // ---------------- admin: calendar ----------------
  function adminCalendarHTML() {
    var sc = S.data.schedule, days = [];
    for (var i = 0; i < 7; i++) days.push(S.weekStart + i * DAY);
    if (S.dayIdx == null) {
      var ti = days.indexOf(Core.dayStart(now()));
      S.dayIdx = ti < 0 ? 0 : ti;
    }
    var shown = narrow() ? [days[S.dayIdx]] : days;
    var studs = S.data.students || [];
    var owing = studs.filter(function (s) { return s.debt > 0; });
    var lessons = sc.events.filter(function (e) { return e.kind === 'booking'; });
    var p0 = parts(days[0]), p6 = parts(days[6]);
    var range = pad(p0.d) + '/' + pad(p0.m) + ' – ' + pad(p6.d) + '/' + pad(p6.m) + '/' + p6.y;
    var thisWeek = S.weekStart === sundayOf(now());

    var aside = '<aside class="rail"><h2>' + t('owingTitle') + '</h2>' +
      (owing.length ? '<ul class="owing">' + owing.map(function (s) {
        return '<li><button type="button" data-act="gotoFees" data-id="' + s.id + '"><span><b>' + esc(s.name) + '</b><small>' + t('unpaidN', { n: s.unpaidCount }) + '</small></span><b class="num">' + money(s.debt) + '</b></button></li>';
      }).join('') + '</ul>' : '<p class="none">' + t('nobodyOwes') + '</p>') +
      '<h2>' + t('weekLessons') + '</h2>' +
      (lessons.length ? '<ul class="mini">' + lessons.sort(function (a, b) { return a.start - b.start; }).map(function (l) {
        return '<li><span>' + fmtDay(l.start) + ' · ' + fmtRange(l.start, l.end) + '</span><b>' + esc(l.studentName) + '</b></li>';
      }).join('') + '</ul>' : '<p class="none">' + t('noLessonsWeek') + '</p>') +
      '</aside>';

    return '<section class="view">' +
      '<div class="view-head"><div><h1>' + t('calTitle') + '</h1><p class="lead">' + t('calLeadAdmin') + '</p></div>' +
      legendHTML(['cal', 'lesson', 'pay']) + '</div>' +
      '<div class="toolbar">' +
      '<div class="week-nav"><button type="button" class="icon-btn" data-act="week" data-d="-1" aria-label="' + t('prevWeek') + '">‹</button>' +
      '<button type="button" class="chip-btn' + (thisWeek ? ' on' : '') + '" data-act="week" data-d="0">' + t('today') + '</button>' +
      '<button type="button" class="icon-btn" data-act="week" data-d="1" aria-label="' + t('nextWeek') + '">›</button>' +
      '<b class="range num">' + range + '</b></div>' +
      '<button type="button" class="btn ' + (S.payMode ? 'gold' : 'ghost') + '" data-act="payMode" aria-pressed="' + S.payMode + '">' + (S.payMode ? t('payModeOn') : t('payModeOff')) + '</button>' +
      '</div>' +
      (S.payMode ? '<div class="notice gold">' + t('payModeHint') + '</div>' : '') +
      '<div class="cal-layout"><div class="cal-card">' +
      (narrow() ? dayChipsHTML(days) : '') +
      '<div class="cal-scroll">' + calendarHTML({ days: shown, events: sc.events, payments: sc.payments, mode: 'admin', gs: 6, ge: 24 }) + '</div>' +
      '<p class="cal-tip">' + t('calTipAdmin') + '</p></div>' + aside + '</div></section>';
  }

  function adminBookModal(start) {
    var studs = (S.data.students || []).filter(function (s) { return s.active; });
    if (!studs.length) { toast(t('noStudents'), 'bad'); return; }
    var day = Core.dayStart(start), len = S.rules.SESSION_MINUTES * MIN, opts = '';
    for (var m = 6 * 60; m + S.rules.SESSION_MINUTES <= 24 * 60; m += 30) {
      var s = day + m * MIN;
      opts += '<option value="' + s + '"' + (s === start ? ' selected' : '') + '>' + fmtRange(s, s + len) + '</option>';
    }
    openModal({
      title: t('adminBookTitle'),
      body: '<p class="m-date">' + fmtDayLong(day) + '</p>' +
        '<label class="field"><span>' + t('student') + '</span><select id="ab-student">' + studs.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>' + t('time') + '</span><select id="ab-start">' + opts + '</select></label>' +
        '<label class="field"><span>' + t('noteOptional') + '</span><input id="ab-note" maxlength="300"></label>' +
        '<p class="muted small">' + t('adminBookHint') + '</p><p class="form-error" id="ab-err" hidden></p>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn primary" id="ab-go">' + t('createLesson') + '</button>',
      mount: function (m) {
        $('#ab-go', m).addEventListener('click', function () {
          var btn = this, err = $('#ab-err', m);
          busyBtn(btn, true); err.hidden = true;
          api('book', { studentId: $('#ab-student', m).value, start: Number($('#ab-start', m).value), note: $('#ab-note', m).value }).then(function () {
            closeModal(); toast(t('lessonCreated')); loadTab();
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
      }
    });
  }

  function eventModal(ev) {
    if (ev.kind === 'calendar') {
      openModal({
        title: esc(ev.title || t('busy')),
        body: '<dl class="kv"><dt>' + t('time') + '</dt><dd>' + fmtDayLong(ev.start) + '<br>' + fmtRange(ev.start, ev.end) + '</dd>' +
          (ev.location ? '<dt>' + t('location') + '</dt><dd>' + esc(ev.location) + '</dd>' : '') +
          (ev.calendar ? '<dt>' + t('calendarName') + '</dt><dd>' + esc(ev.calendar) + '</dd>' : '') + '</dl>' +
          '<p class="muted small">' + t('readOnlyEvent') + '</p>',
        foot: '<button type="button" class="btn ghost" data-close>' + t('close') + '</button>'
      });
      return;
    }
    var past = ev.end <= now();
    var admin = isAdmin();
    var canCancel = ev.status === 'booked' && (admin || (ev.start - now() >= S.rules.CANCEL_MIN_HOURS * HOUR));
    var foot = '<button type="button" class="btn ghost" data-close>' + t('close') + '</button>';
    if (canCancel) foot = '<button type="button" class="btn ghost danger" id="ev-cancel">' + (past ? t('voidLesson') : t('cancelLesson')) + '</button>' + foot;
    openModal({
      title: admin ? esc(ev.studentName) : t('yourLesson'),
      body: '<dl class="kv"><dt>' + t('time') + '</dt><dd>' + fmtDayLong(ev.start) + '<br>' + fmtRange(ev.start, ev.end) + '</dd>' +
        '<dt>' + t('status') + '</dt><dd><span class="pill ' + statusOf(ev)[0] + '">' + statusOf(ev)[1] + '</span></dd>' +
        (ev.note ? '<dt>' + t('note') + '</dt><dd>' + esc(ev.note) + '</dd>' : '') +
        (admin ? '<dt>' + t('fee') + '</dt><dd class="num">' + money(priceOf(ev.studentId)) + '</dd>' : '') + '</dl>' +
        (!admin && ev.status === 'booked' && !canCancel && !past ? '<p class="muted small">' + t('cancelTooLate', { h: S.rules.CANCEL_MIN_HOURS }) + '</p>' : '') +
        (admin && past ? '<p class="muted small">' + t('voidHint') + '</p>' : ''),
      foot: foot,
      mount: function (m) {
        var b = $('#ev-cancel', m);
        if (b) b.addEventListener('click', function () { cancelLesson(ev.id, b); });
      }
    });
  }
  function priceOf(id) { var s = (S.data.students || []).filter(function (x) { return x.id === id; })[0]; return s ? s.price : 0; }

  function paymentModal(p) {
    openModal({
      title: t('paymentTitle'),
      body: '<dl class="kv"><dt>' + t('student') + '</dt><dd>' + esc(p.studentName) + '</dd>' +
        '<dt>' + t('receivedAt') + '</dt><dd>' + fmtStamp(p.at) + '</dd>' +
        '<dt>' + t('amount') + '</dt><dd class="num">' + money(p.amount) + '</dd>' +
        (p.note ? '<dt>' + t('note') + '</dt><dd>' + esc(p.note) + '</dd>' : '') + '</dl>',
      foot: '<button type="button" class="btn ghost danger" id="pm-del">' + t('delete') + '</button><button type="button" class="btn ghost" data-close>' + t('close') + '</button>',
      mount: function (m) {
        var b = $('#pm-del', m);
        b.addEventListener('click', function () { deletePayment(p.id, b); });
      }
    });
  }

  function deletePayment(id, btn) {
    if (!armed(btn)) return;
    busyBtn(btn, true);
    api('deletePayment', { id: id }).then(function () { closeModal(); toast(t('paymentDeleted')); loadTab(); },
      function (e) { busyBtn(btn, false); toast(errText(e), 'bad'); });
  }

  function addPaymentModal(at, studentId, preset) {
    var studs = S.data.students || [];
    if (!studs.length) { toast(t('noStudents'), 'bad'); return; }
    if (!studentId) {
      var owing = studs.filter(function (s) { return s.debt > 0; });
      studentId = (owing.length === 1 ? owing[0] : studs[0]).id;
    }
    at = at || now();
    openModal({
      title: t('markPaid'),
      body: '<label class="field"><span>' + t('student') + '</span><select id="pa-student">' + studs.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === studentId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field"><span>' + t('receivedAt') + '</span><input id="pa-at" type="datetime-local" value="' + toInput(at) + '"></label>' +
        '<label class="field"><span>' + t('amount') + '</span><div class="money-input"><input id="pa-amount" type="number" inputmode="numeric" min="0" step="1000"><span>VND</span></div></label>' +
        '<p class="calc-out small num" id="pa-calc">…</p>' +
        '<details class="pa-qr-wrap"><summary>' + t('showQr') + '</summary><div id="pa-qr"></div></details>' +
        '<label class="field"><span>' + t('noteOptional') + '</span><input id="pa-note" maxlength="200" placeholder="' + t('payNotePh') + '"></label>' +
        '<p class="muted small">' + t('payExplain') + '</p><p class="form-error" id="pa-err" hidden></p>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn gold" id="pa-go">' + t('savePayment') + '</button>',
      mount: function (m) {
        var amount = $('#pa-amount', m), edited = false, seq = 0;
        function drawQr() {
          var st = studs.filter(function (s) { return s.id === $('#pa-student', m).value; })[0];
          $('#pa-qr', m).innerHTML = qrCardHTML(S.bank, Number(amount.value) || 0, transferNote(st ? st.username : ''), true);
        }
        amount.addEventListener('input', function () { edited = true; drawQr(); });
        function refresh() {
          var my = ++seq, when = fromInput($('#pa-at', m).value);
          if (!isFinite(when)) return;
          api('dueAt', { studentId: $('#pa-student', m).value, at: when }).then(function (d) {
            if (my !== seq) return;
            $('#pa-calc', m).innerHTML = d.count ? calcLine(d.count, d.price) : t('nothingDue');
            if (!edited) amount.value = d.amount;
            drawQr();
          }, function () { /* ignore */ });
        }
        $('#pa-student', m).addEventListener('change', function () { edited = false; refresh(); });
        $('#pa-at', m).addEventListener('change', function () { if (preset) { preset = null; edited = false; } refresh(); });
        if (preset) {
          edited = true; amount.value = preset.amount;
          $('#pa-calc', m).innerHTML = calcLine(preset.count, preset.price) + ' <span class="muted">· ' + t('fromCalculator') + '</span>';
          drawQr();
        } else refresh();
        $('#pa-go', m).addEventListener('click', function () {
          var btn = this, err = $('#pa-err', m), when = fromInput($('#pa-at', m).value);
          if (!isFinite(when)) { err.textContent = t('err_bad_request'); err.hidden = false; return; }
          busyBtn(btn, true); err.hidden = true;
          api('addPayment', { studentId: $('#pa-student', m).value, at: when, amount: amount.value === '' ? null : Number(amount.value), note: $('#pa-note', m).value }).then(function () {
            closeModal(); S.payMode = false; toast(t('paymentSaved', { time: fmtStamp(when) })); loadTab();
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
      }
    });
  }

  // ---------------- admin: students ----------------
  function studentsHTML() {
    var studs = S.data.students || [];
    var rows = studs.map(function (s) {
      return '<tr class="' + (s.active ? '' : 'inactive') + '"><td><b>' + esc(s.name) + '</b><small>@' + esc(s.username) + '</small></td>' +
        '<td class="num">' + money(s.price) + '</td><td class="num">' + s.totalLessons + '</td><td class="num">' + s.upcoming + '</td>' +
        '<td class="num">' + (s.debt > 0 ? '<b class="owe">' + money(s.debt) + '</b>' : '<span class="muted">0</span>') + '</td>' +
        '<td><span class="pill ' + (s.active ? 'paid' : 'cancelled') + '">' + (s.active ? t('active') : t('inactive')) + '</span></td>' +
        '<td class="row-actions"><button type="button" class="btn small ghost" data-act="editStudent" data-id="' + s.id + '">' + t('edit') + '</button>' +
        '<button type="button" class="btn small ghost" data-act="resetPw" data-id="' + s.id + '">' + t('resetPassword') + '</button></td></tr>';
    }).join('');
    return '<section class="view">' +
      '<div class="view-head"><div><h1>' + t('studentsTitle') + '</h1><p class="lead">' + t('studentsLead') + '</p></div>' +
      '<button type="button" class="btn primary" data-act="addStudent">' + t('addStudent') + '</button></div>' +
      (studs.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>' + t('student') + '</th><th>' + t('pricePerSession') + '</th><th>' + t('statTotal') + '</th><th>' + t('statUpcoming') + '</th><th>' + t('owes') + '</th><th>' + t('status') + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty"><p>' + t('noStudents') + '</p></div>') +
      '</section>';
  }

  function randomPassword() {
    var chars = 'abcdefghjkmnpqrstuvwxyz23456789', out = '';
    var buf = new Uint32Array(10);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(buf) : buf.forEach(function (_, i) { buf[i] = Math.random() * 1e9; });
    for (var i = 0; i < 10; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  function credentialsHTML(username, password) {
    var text = t('credText', { url: location.href.split('#')[0], user: username, pass: password });
    return '<div class="cred"><p>' + t('credLead') + '</p><pre id="cred-text">' + esc(text) + '</pre>' +
      '<button type="button" class="btn ghost small" id="cred-copy">' + t('copy') + '</button></div>';
  }
  function wireCopy(m) {
    var b = $('#cred-copy', m);
    if (!b) return;
    b.addEventListener('click', function () {
      var pre = $('#cred-text', m);
      var done = function () { b.textContent = t('copied'); };
      var fallback = function () { var r = document.createRange(); r.selectNodeContents(pre); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); b.textContent = t('selected'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.textContent).then(done, fallback);
      else fallback();
    });
  }

  function studentFormModal(s) {
    var edit = !!s;
    var pw = randomPassword();
    openModal({
      title: edit ? t('editStudent') : t('addStudent'),
      body: '<label class="field"><span>' + t('fullName') + '</span><input id="sf-name" maxlength="80" value="' + esc(edit ? s.name : '') + '" placeholder="Nguyễn Văn A"></label>' +
        (edit ? '' : '<label class="field"><span>' + t('username') + '</span><input id="sf-user" maxlength="32" autocapitalize="none" spellcheck="false" placeholder="nguyenvana"><small>' + t('usernameRule') + '</small></label>' +
          '<label class="field"><span>' + t('password') + '</span><div class="inline"><input id="sf-pass" value="' + pw + '" spellcheck="false"><button type="button" class="btn ghost small" id="sf-gen">' + t('generate') + '</button></div></label>') +
        '<label class="field"><span>' + t('pricePerSession') + '</span><div class="money-input"><input id="sf-price" type="number" inputmode="numeric" min="0" step="10000" value="' + (edit ? s.price : 250000) + '"><span>VND</span></div></label>' +
        (edit ? '<label class="check"><input type="checkbox" id="sf-active"' + (s.active ? ' checked' : '') + '><span>' + t('activeLabel') + '</span></label>' : '') +
        '<p class="form-error" id="sf-err" hidden></p><div id="sf-out"></div>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn primary" id="sf-go">' + (edit ? t('save') : t('createAccount')) + '</button>',
      mount: function (m) {
        var gen = $('#sf-gen', m);
        if (gen) gen.addEventListener('click', function () { $('#sf-pass', m).value = randomPassword(); });
        $('#sf-go', m).addEventListener('click', function () {
          var btn = this, err = $('#sf-err', m);
          busyBtn(btn, true); err.hidden = true;
          var req = edit
            ? api('updateStudent', { id: s.id, name: $('#sf-name', m).value, price: Number($('#sf-price', m).value), active: $('#sf-active', m).checked })
            : api('createStudent', { name: $('#sf-name', m).value, username: $('#sf-user', m).value, password: $('#sf-pass', m).value, price: Number($('#sf-price', m).value) });
          req.then(function (r) {
            if (edit) { closeModal(); toast(t('saved')); loadTab(); return; }
            $('.m-body', m).innerHTML = '<p>' + t('accountCreated', { name: esc(r.user.name) }) + '</p>' + credentialsHTML(r.user.username, $('#sf-pass', m) ? $('#sf-pass', m).value : '');
            $('.m-foot', m).innerHTML = '<button type="button" class="btn primary" data-close>' + t('done') + '</button>';
            wireCopy(m); loadTab();
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
        // keep the generated password readable for the credentials box
        var pass = $('#sf-pass', m);
        if (pass) pass.addEventListener('input', function () { pw = pass.value; });
      }
    });
  }

  function resetPasswordModal(s) {
    var pw = randomPassword();
    openModal({
      title: t('resetPassword'),
      body: '<p>' + t('resetFor', { name: esc(s.name) }) + '</p>' +
        '<label class="field"><span>' + t('newPassword') + '</span><div class="inline"><input id="rp-pass" value="' + pw + '" spellcheck="false"><button type="button" class="btn ghost small" id="rp-gen">' + t('generate') + '</button></div></label>' +
        '<p class="form-error" id="rp-err" hidden></p>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn primary" id="rp-go">' + t('setPassword') + '</button>',
      mount: function (m) {
        $('#rp-gen', m).addEventListener('click', function () { $('#rp-pass', m).value = randomPassword(); });
        $('#rp-go', m).addEventListener('click', function () {
          var btn = this, err = $('#rp-err', m), val = $('#rp-pass', m).value;
          busyBtn(btn, true); err.hidden = true;
          api('resetPassword', { id: s.id, password: val }).then(function () {
            $('.m-body', m).innerHTML = credentialsHTML(s.username, val);
            $('.m-foot', m).innerHTML = '<button type="button" class="btn primary" data-close>' + t('done') + '</button>';
            wireCopy(m);
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
      }
    });
  }

  function changePasswordModal() {
    openModal({
      title: t('changePassword'),
      body: '<form id="cp-form" novalidate><label class="field"><span>' + t('currentPassword') + '</span><input id="cp-old" type="password" autocomplete="current-password"></label>' +
        '<label class="field"><span>' + t('newPassword') + '</span><input id="cp-new" type="password" autocomplete="new-password"><small>' + t('passwordRule') + '</small></label>' +
        '<label class="field"><span>' + t('repeatPassword') + '</span><input id="cp-new2" type="password" autocomplete="new-password"></label>' +
        '<p class="form-error" id="cp-err" hidden></p></form>',
      foot: '<button type="button" class="btn ghost" data-close>' + t('back') + '</button><button type="button" class="btn primary" id="cp-go">' + t('save') + '</button>',
      mount: function (m) {
        $('#cp-go', m).addEventListener('click', function () {
          var btn = this, err = $('#cp-err', m);
          if ($('#cp-new', m).value !== $('#cp-new2', m).value) { err.textContent = t('passwordMismatch'); err.hidden = false; return; }
          busyBtn(btn, true); err.hidden = true;
          api('changePassword', { oldPassword: $('#cp-old', m).value, newPassword: $('#cp-new', m).value }).then(function () {
            closeModal(); toast(t('passwordChanged'));
          }, function (e) { busyBtn(btn, false); err.textContent = errText(e); err.hidden = false; });
        });
      }
    });
  }

  // ---------------- calendar pointer interaction ----------------
  var ghost = null;
  function slotFromPointer(col, clientY, step) {
    var r = col.getBoundingClientRect();
    var mins = S.grid.gs * 60 + Math.max(0, clientY - r.top) / HOUR_PX * 60;
    return Number(col.dataset.day) + Math.floor(mins / step) * step * MIN;
  }
  function ghostFor(col) {
    if (!ghost) { ghost = document.createElement('div'); ghost.className = 'c-ghost'; ghost.setAttribute('aria-hidden', 'true'); }
    if (ghost.parentNode !== col) col.appendChild(ghost);
    return ghost;
  }
  function hideGhost() { if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost); }

  function studentSlotState(start) {
    var sc = S.data.schedule;
    return Core.slotError(start, sc.events, now(), S.rules, sc.window, false);
  }

  function onPointerMove(e) {
    if (!S.grid || e.pointerType === 'touch') return;
    var col = e.target.closest && e.target.closest('.col');
    if (!col || e.target.closest('[data-ev],.c-pay')) { hideGhost(); return; }
    var g = ghostFor(col), lo = Number(col.dataset.day) + S.grid.gs * HOUR;
    var len = S.rules.SESSION_MINUTES * MIN;
    if (S.grid.mode === 'student') {
      var start = slotFromPointer(col, e.clientY, S.rules.SLOT_STEP_MINUTES);
      var code = studentSlotState(start);
      g.className = 'c-ghost ' + (code ? 'bad' : 'ok');
      g.style.top = ((start - lo) / HOUR * HOUR_PX) + 'px';
      g.style.height = (len / HOUR * HOUR_PX - 2) + 'px';
      g.innerHTML = '<b>' + fmtRange(start, start + len) + '</b><span>' + (code ? t('why_' + code) : t('clickToBook')) + '</span>';
    } else if (S.payMode) {
      var at = slotFromPointer(col, e.clientY, 15);
      g.className = 'c-ghost payline';
      g.style.top = ((at - lo) / HOUR * HOUR_PX) + 'px';
      g.style.height = '0px';
      g.innerHTML = '<span>' + t('paidAt', { time: fmtTime(at) }) + '</span>';
    } else {
      var s2 = slotFromPointer(col, e.clientY, 30);
      g.className = 'c-ghost neutral';
      g.style.top = ((s2 - lo) / HOUR * HOUR_PX) + 'px';
      g.style.height = (len / HOUR * HOUR_PX - 2) + 'px';
      g.innerHTML = '<b>' + fmtRange(s2, s2 + len) + '</b><span>' + t('addLessonHere') + '</span>';
    }
  }

  function onColClick(col, e) {
    if (S.grid.mode === 'student') {
      var start = slotFromPointer(col, e.clientY, S.rules.SLOT_STEP_MINUTES);
      var code = studentSlotState(start);
      if (code) { toast(t('why_' + code), 'bad'); return; }
      openBookModal(Core.dayStart(start), start);
    } else if (S.payMode) {
      addPaymentModal(slotFromPointer(col, e.clientY, 15));
    } else {
      adminBookModal(slotFromPointer(col, e.clientY, 30));
    }
  }

  // ---------------- global events ----------------
  document.addEventListener('click', function (e) {
    var menu = document.querySelector('details.menu[open]');
    if (menu && !e.target.closest('details.menu')) menu.open = false;

    var evBtn = e.target.closest('[data-ev]');
    if (evBtn) { eventModal(S.evMap[evBtn.dataset.ev]); return; }
    var payBtn = e.target.closest('[data-pay]');
    if (payBtn) { paymentModal(S.evMap[payBtn.dataset.pay]); return; }

    var a = e.target.closest('[data-act]');
    if (!a) {
      var col = e.target.closest('.col');
      if (col && S.grid && !e.target.closest('.modal')) onColClick(col, e);
      return;
    }
    var act = a.dataset.act;
    if (menu && a.closest('.menu-pop')) menu.open = false;
    switch (act) {
      case 'lang':
        S.lang = S.lang === 'vi' ? 'en' : 'vi'; ls.set('tb-lang', S.lang); document.documentElement.lang = S.lang;
        if (S.user) renderApp(); else renderLogin();
        break;
      case 'tab': if (S.tab !== a.dataset.tab) { S.tab = a.dataset.tab; S.dayIdx = null; S.payMode = false; } loadTab(); break;
      case 'logout': api('logout').catch(function () {}); dropSession(); break;
      case 'changePw': changePasswordModal(); break;
      case 'resetDemo': Api.resetDemo(); dropSession(); toast(t('demoReset')); break;
      case 'day': S.dayIdx = Number(a.dataset.idx); renderApp(); break;
      case 'openBook': openBookModal(Number(a.dataset.day), Number(a.dataset.start)); break;
      case 'cancelLesson': cancelLesson(a.dataset.id, a); break;
      case 'voidLesson': cancelLesson(a.dataset.id, a); break;
      case 'week':
        var d = Number(a.dataset.d);
        S.weekStart = d === 0 ? sundayOf(now()) : S.weekStart + d * 7 * DAY;
        S.dayIdx = d === 0 ? null : S.dayIdx;
        loadTab(); break;
      case 'payMode': S.payMode = !S.payMode; renderApp(); break;
      case 'gotoFees': S.feesStudentId = a.dataset.id; S.tab = 'fees'; S.payMode = false; loadTab(); break;
      case 'feesStudent': S.feesStudentId = a.dataset.id; S.data.billing = null; S.data.bookings = null; renderApp(); loadTab(); break;
      case 'pricePreset': $('#fee-price').value = a.dataset.v; onCalcInput(); break;
      case 'lessonsStep': var li = $('#fee-lessons'); li.value = Math.max(0, (Number(li.value) || 0) + Number(a.dataset.d)); onCalcInput(); break;
      case 'lessonsAuto': $('#fee-lessons').value = S.data.billing.unpaidCount; onCalcInput(); break;
      case 'copyText': copyText(a.dataset.text, a); break;
      case 'savePrice': savePrice(a); break;
      case 'addPay':
        var cv = calcValues(), bill = S.data.billing;
        addPaymentModal(now(), S.feesStudentId, cv.n !== bill.unpaidCount || cv.price !== bill.price ? { amount: cv.n * cv.price, count: cv.n, price: cv.price } : null);
        break;
      case 'delPay': deletePayment(a.dataset.id, a); break;
      case 'addStudent': studentFormModal(null); break;
      case 'editStudent': studentFormModal(findStudent(a.dataset.id)); break;
      case 'resetPw': resetPasswordModal(findStudent(a.dataset.id)); break;
    }
  });
  function findStudent(id) { return (S.data.students || []).filter(function (s) { return s.id === id; })[0]; }

  function calcValues() {
    var li = $('#fee-lessons'), pi = $('#fee-price');
    return {
      n: Math.max(0, Math.floor(Number(li && li.value) || 0)),
      price: Math.max(0, Number(pi && pi.value) || 0)
    };
  }
  function onCalcInput() {
    var b = S.data.billing;
    if (!b || !$('#fee-price')) return;
    var v = calcValues();
    $('#calc-out').innerHTML = calcLine(v.n, v.price);
    $('#price-save').disabled = v.price === b.price;
    $('#fee-lessons-hint').innerHTML = lessonsHint(b, v.n);
    $('#calc-qr').innerHTML = qrCardHTML(b.bank || S.bank, v.n * v.price, transferNote(b.student.username), true);
    document.querySelectorAll('[data-act=pricePreset]').forEach(function (c) { c.classList.toggle('on', Number(c.dataset.v) === v.price); });
  }
  function savePrice(btn) {
    var v = Math.max(0, Number($('#fee-price').value) || 0);
    busyBtn(btn, true);
    api('updateStudent', { id: S.feesStudentId, price: v }).then(function () { toast(t('priceSaved')); loadTab(); },
      function (e) { busyBtn(btn, false); toast(errText(e), 'bad'); });
  }

  document.addEventListener('input', function (e) { if (e.target.id === 'fee-price' || e.target.id === 'fee-lessons') onCalcInput(); });

  function copyText(text, btn) {
    var done = function () { var old = btn.textContent; btn.textContent = t('copied'); setTimeout(function () { btn.textContent = old; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast(text); });
    else toast(text);
  }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerleave', hideGhost);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('#modal-root').hidden) closeModal();
      else if (S.payMode) { S.payMode = false; renderApp(); }
    }
  });

  var wasNarrow = narrow();
  window.addEventListener('resize', function () {
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); if (S.user && hasData()) renderApp(); }
  });
  // keep "now" line and past shading fresh
  setInterval(function () { if (S.user && hasData() && (S.tab === 'book' || S.tab === 'calendar') && $('#modal-root').hidden) renderApp(); }, 5 * MIN);

  boot();
})();
