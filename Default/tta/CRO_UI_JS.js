/* CRO e-Signing (TotalAgility x Circularo) - front end.
   Loaded from server variable CRO_UI_JS by each thin CRO_* form. The page is chosen by a hidden marker:
   <div data-cro-page="dashboard|send|requests|request|users"></div>.
   All data comes from the synchronous CRO API process; the caller is identified on the server. */
(function () {
  if (window.__croUi) return; window.__croUi = 1;
  var VERSION = 'cro-ui 0.1.0';
  var API_ID = '66799B626B1B411EB6FFFA0D0EF5270C';           // CRO API (synchronous)
  var BASE = location.pathname.split(/\/forms\//i)[0];
  var FORMS = (function () { var m = /^(.*?\/forms\/(?:[^\/]+\/)?)[^\/]+\.form$/i.exec(location.pathname); return m ? m[1] : BASE + '/Forms/'; })();
  var PAGES = { dashboard: 'CRO_Dashboard', send: 'CRO_Send', requests: 'CRO_Requests', request: 'CRO_Request', users: 'CRO_Users' };
  var link = function (page, qs) { return FORMS + PAGES[page] + '.form' + (qs ? '?' + qs : ''); };

  /* ---------- SDK plumbing (same headers as the forms runtime) ---------- */
  var sid = function () {
    var raw = sessionStorage.getItem('SESSION_ID') || sessionStorage.getItem('TASessionID') || '';
    try { var o = JSON.parse(raw); return o && typeof o === 'object' ? (o.value || '') : String(o || ''); } catch (e) { return raw; }
  };
  var WSH = function () { return window.Forms && Forms.WebServiceHelper; };
  var useRT = function () { return typeof USE_REQUEST_TOKEN !== 'undefined' && USE_REQUEST_TOKEN; };
  var headers = function () {
    var h = { 'Content-Type': 'application/json; charset=utf-8' }, w = WSH();
    if (w) {
      try {
        h.CSRFGenericToken = w.getCSRFToken(); h.JsonEndpoint = 'true';
        h.DisallowDesignerSession = String(Forms.Common.Common.ShouldDisallowDesignerSession());
        if (useRT()) h.RequestToken = w.getRequestToken();
      } catch (e) { }
    }
    return h;
  };
  var sdk = function (svc, m, body) {
    return fetch(BASE + '/Services/Sdk/' + svc + '.svc/json/' + m, {
      method: 'POST', headers: headers(), credentials: 'include',
      body: JSON.stringify(Object.assign({ sessionId: sid() }, body || {}))
    }).then(function (r) {
      var t = r.headers.get('RequestToken'), w = WSH(); if (t && w && useRT()) w.setRequestToken(t);
      return r.json().then(function (j) {
        if (!r.ok || !j || j.d === undefined) {
          var msg = (j && j.Message) || ('HTTP ' + r.status);
          if (/Invalid Session/i.test(msg)) msg = 'Your session has expired. Please refresh the page or sign in again.';
          throw new Error(msg);
        }
        return j.d;
      });
    });
  };
  var tokP = null;
  var me = null;
  var cro = function (op, args) {
    if (!tokP) tokP = sdk('UserService', 'ValidateSession', {}).then(function (u) { me = { id: u.ResourceId, name: u.DisplayName || '' }; return u.SessionId; })
      .catch(function (e) { tokP = null; throw e; });
    return tokP.then(function (tok) {
      return sdk('JobService', 'CreateJobSync', { processIdentity: { Id: API_ID }, jobInitialization: { InputVariables: [
        { Id: 'OP', Value: op }, { Id: 'ARGS', Value: JSON.stringify(args || {}) }, { Id: 'SESSIONTOKEN', Value: tok }] },
        variablesToReturn: [{ Id: 'RESULT' }, { Id: 'ERROR' }] });
    }).then(function (d) {
      var rv = d.ReturnedVariables || [];
      if (rv[1] && rv[1].Value) throw new Error(rv[1].Value);
      return JSON.parse(rv[0].Value);
    });
  };

  /* ---------- helpers ---------- */
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  var q = function (k) { var m = new RegExp('[?&]' + k + '=([^&]*)', 'i').exec(location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; };
  var asDate = function (v) { if (!v) return null; var s = String(v); var d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(d) ? null : d; };
  var when = function (v) { var d = asDate(v); return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'; };
  var ago = function (v) {
    var d = asDate(v); if (!d) return '';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var dd = Math.round(h / 24); return dd < 30 ? dd + (dd === 1 ? ' day ago' : ' days ago') : when(v);
  };
  // "Leigh Dickinson (75DB...)" -> "Leigh Dickinson"; "someone@x.com.1" -> "someone@x.com"; "system" -> "CRO"
  var who = function (s) { s = String(s || ''); if (/^system$/i.test(s)) return 'CRO'; return s.replace(/\s*\([0-9A-F]{32}\)\s*$/i, '').replace(/(@[^\s]+?)\.\d+$/, '$1'); };
  var dur = function (min) { if (min == null || isNaN(min)) return '-'; min = Math.round(min); if (min < 60) return min + ' min'; var h = Math.floor(min / 60), m = min % 60; if (h < 48) return h + ' h' + (m ? ' ' + m + ' min' : ''); return Math.round(h / 24) + ' days'; };
  var set0 = function (sets) { return (sets && sets[0]) || []; };
  var toast = function (msg, bad) {
    var t = document.createElement('div'); t.className = 'cro-toast' + (bad ? ' bad' : ''); t.textContent = msg; document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, msg.length > 70 ? 6000 : 3500);
  };

  /* ---------- look ---------- */
  var STATE = {
    draft: { label: 'Draft', c: '#98A2B3' }, sending: { label: 'Sending', c: '#7A5AF8' }, inprogress: { label: 'In progress', c: '#2E90FA' },
    completed: { label: 'Completed', c: '#12B76A' }, rejected: { label: 'Rejected', c: '#F04438' }, expired: { label: 'Expired', c: '#F79009' },
    cancelled: { label: 'Cancelled', c: '#667085' }, failed: { label: 'Failed', c: '#B42318' }
  };
  var CSS = [
    ':root{--cro-ink:#101828;--cro-sub:#475467;--cro-mute:#667085;--cro-line:#EAECF0;--cro-bg:#F5F6FA;--cro-card:#fff;--cro-acc:#4E3FD8;--cro-acc2:#EEEBFF;--cro-ok:#12B76A;--cro-bad:#F04438;--cro-warn:#F79009}',
    '.cro{font:14px/1.45 "Segoe UI",Arial,sans-serif;color:var(--cro-ink);background:var(--cro-bg);min-height:100vh;margin:0}',
    '.cro *{box-sizing:border-box}',
    '.cro-top{display:flex;align-items:center;gap:24px;background:#fff;border-bottom:1px solid var(--cro-line);padding:0 28px;height:60px;position:sticky;top:0;z-index:5}',
    '.cro-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;color:var(--cro-ink);text-decoration:none}',
    '.cro-brand i{width:30px;height:30px;border-radius:8px;background:var(--cro-acc);display:grid;place-items:center;color:#fff;font-style:normal;font-size:15px}',
    '.cro-nav{display:flex;gap:4px;flex:1}',
    '.cro-nav a{padding:8px 12px;border-radius:8px;color:var(--cro-sub);text-decoration:none;font-weight:600}',
    '.cro-nav a:hover{background:var(--cro-bg)}.cro-nav a.on{color:var(--cro-acc);background:var(--cro-acc2)}',
    '.cro-me{color:var(--cro-sub);font-size:13px;white-space:nowrap}',
    '.cro-main{max-width:1240px;margin:0 auto;padding:28px}',
    '.cro-h1{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px}',
    '.cro-h1 h1{font-size:22px;margin:0}.cro-h1 .ctl{display:flex;gap:8px;align-items:center}',
    '.cro-seg{display:inline-flex;background:#fff;border:1px solid var(--cro-line);border-radius:8px;overflow:hidden}',
    '.cro-seg button{border:0;background:none;padding:7px 12px;font:inherit;color:var(--cro-sub);cursor:pointer}',
    '.cro-seg button.on{background:var(--cro-acc);color:#fff}',
    '.cro-grid{display:grid;gap:16px}',
    '.cro-g3{grid-template-columns:repeat(3,1fr)}.cro-g5{grid-template-columns:repeat(5,1fr)}.cro-g21{grid-template-columns:2fr 1fr}.cro-g12{grid-template-columns:1fr 2fr}.cro-g11{grid-template-columns:1fr 1fr}',
    '@media(max-width:900px){.cro-g3,.cro-g5,.cro-g21,.cro-g12,.cro-g11{grid-template-columns:1fr}.cro-nav{display:none}}',
    '.cro-card{background:var(--cro-card);border:1px solid var(--cro-line);border-radius:12px;padding:20px}',
    '.cro-card h2{font-size:15px;margin:0 0 14px;display:flex;justify-content:space-between;align-items:center}',
    '.cro-card h2 small{font-weight:400;color:var(--cro-mute);font-size:12px}',
    '.cro-tile{display:flex;gap:16px;align-items:center;text-decoration:none;color:inherit;transition:transform .12s,box-shadow .12s}',
    '.cro-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(16,24,40,.08)}',
    '.cro-tile .ic{width:52px;height:52px;border-radius:50%;background:var(--cro-acc);display:grid;place-items:center;flex:none}',
    '.cro-tile b{display:block;font-size:15px;letter-spacing:.02em}.cro-tile span{color:var(--cro-mute);font-size:13px}',
    '.cro-stat{text-decoration:none;color:inherit;display:block;text-align:center}',
    '.cro-stat .n{font-size:30px;font-weight:700;margin-top:4px}.cro-stat .l{color:var(--cro-sub);font-size:13px}',
    '.cro-stat:hover{border-color:#C7C1FB}',
    '.cro-sec{margin:28px 0 12px;color:var(--cro-mute);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
    '.cro-legend{display:flex;flex-wrap:wrap;gap:10px 16px;font-size:12px;color:var(--cro-sub)}',
    '.cro-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}',
    '.cro-kv{display:grid;grid-template-columns:1fr auto;gap:8px 16px;font-size:13px}.cro-kv span{color:var(--cro-sub)}.cro-kv b{text-align:right}',
    '.cro-big{font-size:34px;font-weight:700}.cro-big small{font-size:14px;color:var(--cro-mute);font-weight:400;margin-left:6px}',
    '.cro-bar{height:8px;border-radius:4px;background:var(--cro-line);overflow:hidden}.cro-bar i{display:block;height:100%;background:var(--cro-acc)}',
    '.cro-act{list-style:none;margin:0;padding:0}.cro-act li{padding:10px 0;border-bottom:1px solid var(--cro-line);font-size:13px;display:flex;gap:10px}',
    '.cro-act li:last-child{border-bottom:0}.cro-act .t{color:var(--cro-mute);min-width:110px}.cro-act a{color:var(--cro-ink);font-weight:600;text-decoration:none}.cro-act a:hover{color:var(--cro-acc)}',
    '.cro-dot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:6px}',
    '.cro-table{width:100%;border-collapse:collapse;font-size:13px}.cro-table th{text-align:left;color:var(--cro-mute);font-weight:600;padding:8px;border-bottom:1px solid var(--cro-line)}',
    '.cro-table td{padding:8px;border-bottom:1px solid var(--cro-line);vertical-align:top}',
    '.cro-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--cro-bg)}',
    '.cro-ok{color:var(--cro-ok)}.cro-badc{color:var(--cro-bad)}.cro-warnc{color:var(--cro-warn)}',
    '.cro-empty{color:var(--cro-mute);padding:16px 0;text-align:center}',
    '.cro-skel{color:var(--cro-mute);padding:40px;text-align:center}',
    '.cro-err{background:#FEF3F2;border:1px solid #FDA29B;color:#B42318;padding:12px 16px;border-radius:8px;margin-bottom:16px}',
    '.cro-toast{position:fixed;right:24px;bottom:24px;background:#101828;color:#fff;padding:12px 16px;border-radius:8px;opacity:0;transform:translateY(8px);transition:.25s;z-index:99}',
    '.cro-toast.show{opacity:1;transform:none}.cro-toast.bad{background:#B42318}',
    '.cro-foot{color:var(--cro-mute);font-size:12px;text-align:center;padding:24px}',
    'svg text{font-family:"Segoe UI",Arial,sans-serif}'
  ].join('\n');
  var ICON = {
    signNow: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 5-3 2 2 4 2"/><path d="M3 21h18"/></svg>',
    weSign: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 1.5-4 4-4s4 1.5 4 4"/></svg>',
    theySign: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/></svg>'
  };

  /* ---------- shell ---------- */
  var page = (function () { var el = document.querySelector('[data-cro-page]'); return el ? el.getAttribute('data-cro-page') : 'dashboard'; })();
  var root;
  var shell = function () {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // hide the TotalAgility form chrome; the marker cell becomes our root
    var marker = document.querySelector('[data-cro-page]');
    root = document.createElement('div'); root.className = 'cro';
    document.body.appendChild(root);
    try { Array.prototype.forEach.call(document.body.children, function (c) { if (c !== root && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && !c.classList.contains('cro-toast')) c.style.display = 'none'; }); } catch (e) { }
    if (marker) marker.style.display = 'none';
    document.body.style.margin = '0'; document.body.style.background = '#F5F6FA';
    root.innerHTML =
      '<div class="cro-top"><a class="cro-brand" href="' + link('dashboard') + '"><i>✓</i>CRO e-Signing</a>' +
      '<nav class="cro-nav">' +
      [['dashboard', 'Dashboard'], ['send', 'Send for signature'], ['requests', 'Requests'], ['users', 'Users']].map(function (p) {
        return '<a href="' + link(p[0]) + '"' + (page === p[0] || (page === 'request' && p[0] === 'requests') ? ' class="on"' : '') + '>' + p[1] + '</a>';
      }).join('') + '</nav><span class="cro-me" id="croMe"></span></div>' +
      '<div class="cro-main" id="croMain"><div class="cro-skel">Loading…</div></div>' +
      '<div class="cro-foot">TotalAgility × Circularo · ' + VERSION + '</div>';
  };
  var main = function () { return document.getElementById('croMain'); };
  var fail = function (e) { main().innerHTML = '<div class="cro-err">' + esc(e && e.message || e) + '</div>'; };

  /* ---------- charts (inline SVG) ---------- */
  var donut = function (parts, total) {
    var R = 70, r = 46, cx = 90, cy = 90, a0 = -Math.PI / 2, out = '';
    if (!total) return '<svg width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="58" fill="none" stroke="#EAECF0" stroke-width="24"/><text x="90" y="96" text-anchor="middle" font-size="14" fill="#667085">No requests</text></svg>';
    parts.forEach(function (p) {
      if (!p.v) return;
      var a1 = a0 + 2 * Math.PI * p.v / total;
      if (p.v === total) { out += '<circle cx="90" cy="90" r="58" fill="none" stroke="' + p.c + '" stroke-width="24"><title>' + esc(p.label + ': ' + p.v) + '</title></circle>'; a0 = a1; return; }
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var P = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2); };
      out += '<path d="M' + P(R, a0) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + P(R, a1) + ' L' + P(r, a1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + P(r, a0) + 'Z" fill="' + p.c + '"><title>' + esc(p.label + ': ' + p.v) + '</title></path>';
      a0 = a1;
    });
    return '<svg width="180" height="180" viewBox="0 0 180 180">' + out +
      '<text x="90" y="88" text-anchor="middle" font-size="26" font-weight="700" fill="#101828">' + total + '</text>' +
      '<text x="90" y="108" text-anchor="middle" font-size="12" fill="#667085">requests</text></svg>';
  };
  var volume = function (rows) {
    var W = 720, H = 220, L = 34, B = 26, T = 10, n = Math.max(rows.length, 1);
    var max = 1; rows.forEach(function (r) { max = Math.max(max, r.sent || 0, r.completed || 0); });
    var step = (W - L - 8) / n, bw = Math.max(2, Math.min(14, step / 2 - 2));
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var g = '';
    var ticks = max <= 4 ? max : 4;
    for (var i = 0; i <= ticks; i++) { var v = Math.round(max * i / ticks); g += '<line x1="' + L + '" x2="' + (W - 4) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#EAECF0"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="#667085">' + v + '</text>'; }
    rows.forEach(function (r, i) {
      var x = L + i * step + step / 2, d = asDate(r.day);
      var lab = d ? d.getUTCDate() + ' ' + 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[d.getUTCMonth()] : '';
      if (r.sent) g += '<rect x="' + (x - bw - 1) + '" y="' + y(r.sent) + '" width="' + bw + '" height="' + (H - B - y(r.sent)) + '" rx="2" fill="#4E3FD8"><title>' + esc(lab + ' sent: ' + r.sent) + '</title></rect>';
      if (r.completed) g += '<rect x="' + (x + 1) + '" y="' + y(r.completed) + '" width="' + bw + '" height="' + (H - B - y(r.completed)) + '" rx="2" fill="#12B76A"><title>' + esc(lab + ' completed: ' + r.completed) + '</title></rect>';
      var every = Math.ceil(n / 8);
      if ((n - 1 - i) % every === 0) g += '<text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#667085">' + esc(lab) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-height:240px">' + g + '</svg>';
  };

  /* ---------- dashboard ---------- */
  var dash = { scope: q('scope') === 'all' ? 'all' : 'mine', days: +(q('days') || 30) };
  var renderDashboard = function () {
    main().innerHTML = '<div class="cro-skel">Loading dashboard…</div>';
    var calls = [cro('dashboard', { scope: dash.scope, days: dash.days })];
    Promise.all(calls).then(function (r) {
      var d = r[0];
      var ov = set0(d.overview)[0] || {};
      var states = (d.overview && d.overview[1]) || [];
      var vol = set0(d.reports);
      var suc = ((d.reports && d.reports[1]) || [])[0] || {};
      var mix = (d.reports && d.reports[2]) || [];
      var act = set0(d.activity);
      var total = 0, parts = Object.keys(STATE).map(function (k) {
        var v = 0; states.forEach(function (s) { if (s.state === k) v = s.requests; }); total += v;
        return { key: k, label: STATE[k].label, c: STATE[k].c, v: v };
      });
      var finished = suc.finished || 0, rate = finished ? Math.round(100 * (suc.completed || 0) / finished) : null;
      var mixTotal = 0; mix.forEach(function (m) { mixTotal += m.requests; });
      var MIXL = { anchors: 'Anchor text', default_position: 'Default position (ad hoc)', 'anchors+default': 'Anchors + default', adhoc: 'Ad hoc', coordinates: 'Coordinates', template: 'Circularo template', word_template: 'Word template', detect: 'Field detection' };
      var stat = function (n, label, colour, filter) {
        return '<a class="cro-card cro-stat" href="' + link('requests', 'filter=' + filter + (dash.scope === 'all' ? '&scope=all' : '')) + '"><div class="l">' + label + '</div><div class="n" style="color:' + colour + '">' + (n || 0) + '</div></a>';
      };
      var tile = function (mode, title, text, icon) {
        return '<a class="cro-card cro-tile" href="' + link('send', 'mode=' + mode) + '"><span class="ic">' + icon + '</span><span><b>' + title + '</b><span>' + text + '</span></span></a>';
      };
      var html =
        '<div class="cro-h1"><h1>Dashboard</h1><div class="ctl">' +
        (d.isAdmin ? '<div class="cro-seg" id="croScope"><button data-v="mine"' + (dash.scope === 'mine' ? ' class="on"' : '') + '>Mine</button><button data-v="all"' + (dash.scope === 'all' ? ' class="on"' : '') + '>All</button></div>' : '') +
        '<div class="cro-seg" id="croDays">' + [7, 30, 90].map(function (n) { return '<button data-v="' + n + '"' + (dash.days === n ? ' class="on"' : '') + '>' + n + ' days</button>'; }).join('') + '</div>' +
        '</div></div>' +
        '<div class="cro-grid cro-g3">' +
        tile('signnow', 'SIGN NOW', 'Sign a document yourself.', ICON.signNow) +
        tile('wesign', 'WE SIGN', 'Sign together with other people.', ICON.weSign) +
        tile('theysign', 'THEY SIGN', 'Send to others for signature.', ICON.theySign) +
        '</div>' +
        '<div class="cro-sec">Overview</div>' +
        '<div class="cro-grid cro-g5">' +
        stat(ov.assigned_to_me, 'Assigned to me', '#F79009', 'assigned') +
        stat(ov.waiting_for_others, 'Waiting for others', '#4E3FD8', 'waiting') +
        stat(ov.completed, 'Completed', '#12B76A', 'completed') +
        stat(ov.approaching_deadline, 'Approaching deadline', '#D92D20', 'deadline') +
        stat(ov.needs_attention, 'Needs attention', '#B42318', 'attention') +
        '</div>' +
        '<div class="cro-sec">Reports · last ' + dash.days + ' days</div>' +
        '<div class="cro-grid cro-g12">' +
        '<div class="cro-card"><h2>Requests by status</h2><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' + donut(parts, total) +
        '<div class="cro-legend" style="flex-direction:column">' + parts.filter(function (p) { return p.v; }).map(function (p) { return '<span><i style="background:' + p.c + '"></i>' + p.label + ' · <b>' + p.v + '</b></span>'; }).join('') + '</div></div></div>' +
        '<div class="cro-card"><h2>Volume over time <span class="cro-legend"><span><i style="background:#4E3FD8"></i>Sent</span><span><i style="background:#12B76A"></i>Completed</span></span></h2>' + volume(vol) + '</div>' +
        '</div>' +
        '<div class="cro-grid cro-g11" style="margin-top:16px">' +
        '<div class="cro-card"><h2>Success &amp; turnaround</h2>' +
        '<div class="cro-big">' + (rate == null ? '–' : rate + '%') + '<small>completed of ' + finished + ' finished</small></div>' +
        '<div class="cro-bar" style="margin:12px 0 16px"><i style="width:' + (rate || 0) + '%;background:#12B76A"></i></div>' +
        '<div class="cro-kv"><span>Average time to complete</span><b>' + dur(suc.avg_minutes_to_complete) + '</b>' +
        '<span>Fastest / slowest</span><b>' + dur(suc.min_minutes_to_complete) + ' / ' + dur(suc.max_minutes_to_complete) + '</b>' +
        '<span>Rejected</span><b class="' + (suc.rejected ? 'cro-badc' : '') + '">' + (suc.rejected || 0) + '</b>' +
        '<span>Expired</span><b class="' + (suc.expired ? 'cro-warnc' : '') + '">' + (suc.expired || 0) + '</b>' +
        '<span>Cancelled</span><b>' + (suc.cancelled || 0) + '</b></div></div>' +
        '<div class="cro-card"><h2>How signature fields were placed</h2>' +
        (mixTotal ? mix.map(function (m) {
          var pct = Math.round(100 * m.requests / mixTotal);
          return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>' + esc(MIXL[m.placement] || m.placement) + '</span><b>' + m.requests + '</b></div><div class="cro-bar"><i style="width:' + pct + '%"></i></div></div>';
        }).join('') : '<div class="cro-empty">Nothing sent in this period.</div>') + '</div>' +
        '</div>' +
        '<div class="cro-sec">Recent activity</div>' +
        '<div class="cro-card">' + (act.length ? '<ul class="cro-act">' + act.map(function (a) {
          var c = /signed|completed|stored/.test(a.what) ? '#12B76A' : /reject|fail|expire|cancel/.test(a.what) ? '#F04438' : '#4E3FD8';
          return '<li><span class="cro-dot" style="background:' + c + '"></span><span class="t" title="' + esc(when(a.at_utc)) + '">' + esc(ago(a.at_utc)) + '</span><span><a href="' + link('request', 'ref=' + encodeURIComponent(a.request_ref)) + '">' + esc(a.title) + '</a> ' + esc(a.what) + (a.who && !/^system$/i.test(a.who) ? ' by ' + esc(who(a.who)) : '') + '</span></li>';
        }).join('') + '</ul>' : '<div class="cro-empty">No activity yet.</div>') + '</div>' +
        (d.isAdmin ? '<div class="cro-sec">Integration health</div><div id="croHealth" class="cro-card"><div class="cro-skel">Checking…</div></div>' : '');
      main().innerHTML = html;
      var bind = function (id, key, num) {
        var el = document.getElementById(id); if (!el) return;
        el.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; dash[key] = num ? +b.getAttribute('data-v') : b.getAttribute('data-v'); renderDashboard(); });
      };
      bind('croScope', 'scope'); bind('croDays', 'days', true);
      if (d.isAdmin) renderHealth();
    }).catch(fail);
  };
  var renderHealth = function () {
    Promise.all([cro('monitor', {}), cro('webhook_recent', { max: 8 })]).then(function (r) {
      var m = set0(r[0])[0] || {}, w = set0(r[1]);
      var since = m.seconds_since_run, syncOk = since != null && since < 600;
      var line = function (label, val, cls) { return '<span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b>'; };
      document.getElementById('croHealth').innerHTML =
        '<div class="cro-grid cro-g12"><div><h2 style="margin-bottom:14px">Sync and webhooks</h2><div class="cro-kv">' +
        line('Last sync run', m.last_run_utc ? ago(m.last_run_utc) : 'never', syncOk ? 'cro-ok' : 'cro-badc') +
        line('Sync runs recorded', m.runs || 0) +
        line('Webhook events waiting', m.webhooks_pending || 0, m.webhooks_pending ? 'cro-warnc' : '') +
        line('Webhooks in last 24 h', m.webhooks_24h || 0) +
        line('Last valid webhook', m.last_valid_webhook_utc ? ago(m.last_valid_webhook_utc) : '–') +
        line('Bad signatures (7 days)', m.bad_signatures_7d || 0, m.bad_signatures_7d ? 'cro-warnc' : '') +
        line('Failed requests', m.failed_requests || 0, m.failed_requests ? 'cro-badc' : '') +
        line('Completed without outputs', m.outputs_missing || 0, m.outputs_missing ? 'cro-warnc' : '') +
        '</div></div><div><h2 style="margin-bottom:14px">Latest webhook events</h2>' +
        (w.length ? '<table class="cro-table"><tr><th>Received</th><th>Event</th><th>Request</th><th>Result</th></tr>' + w.map(function (e) {
          return '<tr><td title="' + esc(when(e.received_utc)) + '">' + esc(ago(e.received_utc)) + '</td><td>' + esc(e.event_name || '?') +
            (e.signature_valid ? '' : ' <span class="cro-pill cro-badc">bad signature</span>') + '</td><td>' + esc(e.title || '–') + '</td><td>' + esc(e.process_result || (e.processed_utc ? 'done' : 'waiting')) + '</td></tr>';
        }).join('') + '</table>' : '<div class="cro-empty">No webhook events yet.</div>') + '</div></div>';
    }).catch(function (e) { var h = document.getElementById('croHealth'); if (h) h.innerHTML = '<div class="cro-err">' + esc(e.message) + '</div>'; });
  };

  /* ---------- pages still to come ---------- */
  var renderSoon = function (title) {
    main().innerHTML = '<div class="cro-h1"><h1>' + esc(title) + '</h1></div><div class="cro-card cro-empty">This page is being built. Use the Dashboard for now.</div>';
  };

  /* ---------- start ---------- */
  shell();
  tokP = null;
  cro('whoami', {}).then(function (u) { var el = document.getElementById('croMe'); if (el) el.textContent = u.name || ''; }).catch(function () { });
  ({
    dashboard: renderDashboard,
    send: function () { renderSoon('Send for signature'); },
    requests: function () { renderSoon('Requests'); },
    request: function () { renderSoon('Request'); },
    users: function () { renderSoon('Users'); }
  }[page] || renderDashboard)();
})();
