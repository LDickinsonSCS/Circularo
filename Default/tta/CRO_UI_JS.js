/* CRO e-Signing (TotalAgility x Circularo) - front end.
   Loaded from server variable CRO_UI_JS by each thin CRO_* form. The page is chosen by a hidden marker:
   <div data-cro-page="dashboard|send|requests|request|users"></div>.
   All data comes from the synchronous CRO API process; the caller is identified on the server. */
(function () {
  if (window.__croUi) return; window.__croUi = 1;
  var VERSION = 'cro-ui 0.3.2';
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
    '.cro-lead{color:var(--cro-sub);margin:-12px 0 18px}',
    '.cro-f{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.cro-f>label{font-size:12px;font-weight:600;color:var(--cro-sub)}',
    '.cro-in{font:inherit;padding:8px 10px;border:1px solid #D0D5DD;border-radius:8px;background:#fff;color:var(--cro-ink);width:100%;min-width:0}',
    '.cro-in:focus{outline:2px solid var(--cro-acc2);border-color:var(--cro-acc)}.cro-in:disabled{background:var(--cro-bg);color:var(--cro-sub)}',
    '.cro-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:2px dashed #D0D5DD;border-radius:12px;padding:26px;cursor:pointer;margin-bottom:14px;text-align:center}',
    '.cro-drop:hover,.cro-drop.over{border-color:var(--cro-acc);background:var(--cro-acc2)}.cro-drop span{color:var(--cro-mute);font-size:13px}',
    '.cro-radio{display:block;padding:4px 0;font-weight:400 !important;color:var(--cro-ink) !important;font-size:14px !important}.cro-radio.off{color:var(--cro-mute) !important}.cro-radio small{color:var(--cro-mute)}',
    '.cro-check{display:block;margin-bottom:10px;color:var(--cro-sub)}',
    '.cro-note{background:var(--cro-acc2);color:#3B2DB0;border-radius:8px;padding:10px 12px;font-size:13px}',
    '.cro-hint{font-size:11px;color:var(--cro-acc);margin-top:2px}.cro-ro{padding:8px 0;color:var(--cro-sub)}',
    '.cro-rcp td{padding:6px 4px}.cro-x{border:0;background:none;font-size:20px;color:var(--cro-mute);cursor:pointer;padding:4px 8px}.cro-x:hover{color:var(--cro-bad)}',
    '.cro-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}',
    '.cro-btn,.cro-btn2{font:inherit;font-weight:600;border-radius:8px;padding:10px 18px;cursor:pointer;text-decoration:none;display:inline-block}',
    '.cro-btn{background:var(--cro-acc);color:#fff;border:1px solid var(--cro-acc)}.cro-btn:disabled{opacity:.6;cursor:wait}',
    '.cro-btn2{background:#fff;color:var(--cro-ink);border:1px solid #D0D5DD}.cro-btn2:hover{background:var(--cro-bg)}',
    '.cro-done{text-align:center;padding:40px}.cro-done .big{width:64px;height:64px;border-radius:50%;background:#D1FADF;color:#039855;font-size:32px;display:grid;place-items:center;margin:0 auto 12px}.cro-done h1{margin:0 0 6px;font-size:22px}',
    '.cro-chips{display:flex;flex-wrap:wrap;gap:8px;margin:-4px 0 16px}.cro-chips button{font:inherit;font-size:13px;border:1px solid #D0D5DD;background:#fff;color:var(--cro-sub);border-radius:999px;padding:6px 12px;cursor:pointer}',
    '.cro-chips button.on{background:var(--cro-acc);border-color:var(--cro-acc);color:#fff}',
    '.cro-tools{display:flex;gap:10px;margin-bottom:12px}.cro-list td{vertical-align:middle}',
    '.cro-title{color:var(--cro-ink);font-weight:600;text-decoration:none}.cro-title:hover{color:var(--cro-acc)}.cro-sub{color:var(--cro-mute);font-size:12px;margin-top:2px}',
    '.cro-sm{padding:5px 10px;font-size:12px}.cro-pager{display:flex;justify-content:space-between;align-items:center;padding-top:12px;color:var(--cro-sub);font-size:13px}',
    '.cro-crumb{margin:-8px 0 8px}.cro-crumb a{color:var(--cro-sub);text-decoration:none;font-size:13px}.cro-crumb a:hover{color:var(--cro-acc)}',
    '.cro-h1 h1 .cro-pill{vertical-align:middle;margin-left:6px;font-size:12px}',
    '.cro-danger{color:var(--cro-bad)}.cro-dangerbtn{background:var(--cro-bad);border-color:var(--cro-bad)}.cro-confirm{border-color:#FDA29B;background:#FFFBFA;margin-bottom:16px}',
    '.cro-file{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--cro-line)}.cro-file:last-child{border-bottom:0}',
    '.cro-mono{font-family:Consolas,monospace;font-weight:400}',
    '.cro-foot{color:var(--cro-mute);font-size:12px;text-align:center;padding:24px}',
    'svg text{font-family:"Segoe UI",Arial,sans-serif}'
  ].join('\n');
  var ICON = {
    signNow: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 5-3 2 2 4 2"/><path d="M3 21h18"/></svg>',
    weSign: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 1.5-4 4-4s4 1.5 4 4"/></svg>',
    theySign: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/></svg>'
  };

  /* ---------- shell ---------- */
  // Page: from the form name in the URL (CRO_Send.form -> send), else the marker. TotalAgility renders HTML
  // controls as srcdoc iframes, so the marker is looked for in the iframe markup too.
  var page = (function () {
    var m = /\/([^\/]+)\.form$/i.exec(location.pathname);
    if (m) for (var k in PAGES) if (PAGES[k].toLowerCase() === m[1].toLowerCase()) return k;
    var el = document.querySelector('[data-cro-page]'); if (el) return el.getAttribute('data-cro-page');
    var fr = document.querySelectorAll('iframe[srcdoc]');
    for (var i = 0; i < fr.length; i++) { var x = /data-cro-page=["']?([a-z]+)/i.exec(fr[i].getAttribute('srcdoc') || ''); if (x) return x[1]; }
    return 'dashboard';
  })();
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
    var step = (W - L - 26) / n, bw = Math.max(2, Math.min(14, step / 2 - 2));
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

  /* ---------- send for signature ---------- */
  var MODES = {
    signnow: { t: 'Sign now', d: 'Sign a document yourself.' },
    wesign: { t: 'We sign', d: 'You sign together with other people.' },
    theysign: { t: 'They sign', d: 'Send to other people for signature.' }
  };
  var PURPOSES = { sign: 'Sign', approve: 'Approve', accept: 'Accept', review: 'Review', view: 'View only' };
  var cleanTitle = function (s) { return String(s || '').replace(/\.(pdf|docx?)$/i, '').replace(/[\/?<>\\:*|"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); };
  var fileB64 = function (f) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); ok(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { bad(new Error('Could not read the file.')); };
      r.readAsDataURL(f);
    });
  };
  var openSigning = function (requestId, btn) {
    // open the tab synchronously (pop-up blockers), then point it at the link
    var w = window.open('', '_blank');
    if (w) w.document.write('<p style="font:14px Arial;padding:24px">Opening Circularo…</p>');
    if (btn) btn.disabled = true;
    return cro('sign_url', { requestId: requestId }).then(function (r) {
      if (w) w.location.href = r.url; else location.href = r.url;
      toast(r.note || 'Circularo opened in a new tab.');
    }).catch(function (e) { if (w) w.close(); toast(e.message, true); })
      .then(function () { if (btn) btn.disabled = false; });
  };

  var renderSend = function () {
    var mode = MODES[q('mode')] ? q('mode') : 'theysign';
    main().innerHTML = '<div class="cro-skel">Loading…</div>';
    Promise.all([cro('me', {}), cro('config', {}), cro('user_list', {}).catch(function () { return [[]]; })]).then(function (r) {
      var ME = r[0], CFG = r[1], USERS = set0(r[2]);
      var D = CFG.defaults || {}, O = CFG.options || {}, L = CFG.layouts || {};
      var dl = new Date(Date.now() + (D.deadlineDays || 14) * 864e5);
      var S = { file: null, title: '', layout: '', adhocOption: D.adhocOption || 'default_position', sequential: D.sequential !== false,
        deadline: dl.toISOString().slice(0, 10), rcps: [], busy: false, done: null };
      var meRow = function (order) { return { me: true, kind: 'internal', email: ME.email || '', fullName: ME.name || '', purpose: 'sign', protection: 'none', internalMode: D.internalMode || 'circularo_login', order: order || 1, anchorId: '' }; };
      var blank = function (order) { return { kind: 'external', email: '', fullName: '', purpose: D.purpose || 'sign', protection: D.externalProtection || 'email_otp', internalMode: D.internalMode || 'circularo_login', order: order || 1, anchorId: '' }; };
      var resetRcps = function () {
        var lay = L[S.layout], roles = lay && lay.roles || [];
        if (mode === 'signnow') { S.rcps = [meRow(1)]; if (roles.length) S.rcps[0].anchorId = roles[0].role; return; }
        if (roles.length) {
          S.rcps = roles.map(function (ro) {
            var x = blank(ro.order || 1); x.kind = ro.kind || 'external'; x.purpose = ro.purpose || 'sign'; x.anchorId = ro.role; x.roleLabel = ro.role;
            if (ro.protection) x.protection = ro.protection;
            return x;
          });
          if (mode === 'wesign') { var i = S.rcps.findIndex(function (x) { return x.kind === 'internal'; }); var m = meRow(i >= 0 ? S.rcps[i].order : 1); if (i >= 0) { m.anchorId = S.rcps[i].anchorId; m.purpose = S.rcps[i].purpose; S.rcps[i] = m; } else S.rcps.unshift(m); }
        } else S.rcps = mode === 'wesign' ? [meRow(1), blank(2)] : [blank(1)];
      };
      resetRcps();

      var opt = function (v, label, sel, dis) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + esc(label) + '</option>'; };
      var roleOpts = function (cur) {
        var lay = L[S.layout]; if (!lay) return '';
        return opt('', '(no field – default position)', !cur) + (lay.roles || []).map(function (ro) { return opt(ro.role, ro.role.replace(/_/g, ' '), cur === ro.role); }).join('');
      };
      var showOrder = function () { return S.sequential && mode !== 'signnow'; };
      var rowHtml = function (x, i) {
        var ext = x.kind === 'external', lock = x.me;
        return '<tr data-i="' + i + '">' +
          (showOrder() ? '<td><input class="cro-in" style="width:56px" type="number" min="1" max="20" data-k="order" value="' + esc(x.order) + '"></td>' : '') +
          '<td><input class="cro-in" data-k="fullName" placeholder="Full name" value="' + esc(x.fullName) + '"' + (lock ? ' disabled' : '') + '></td>' +
          '<td><input class="cro-in" data-k="email" list="croUsers" placeholder="name@company.com" value="' + esc(x.email) + '"' + (lock ? ' disabled' : '') + '>' + (lock ? '<div class="cro-hint">You</div>' : '') + '</td>' +
          '<td><select class="cro-in" data-k="kind"' + (lock ? ' disabled' : '') + '>' + opt('internal', 'Internal', !ext) + opt('external', 'External', ext) + '</select></td>' +
          '<td><select class="cro-in" data-k="purpose">' + (O.purposes || ['sign']).map(function (p) { return opt(p, PURPOSES[p] || p, x.purpose === p); }).join('') + '</select></td>' +
          '<td>' + (ext
            ? '<select class="cro-in" data-k="protection">' + ['email_otp', 'none', 'password', 'sms_otp', 'oauth'].filter(function (p) { return (O.protection || []).indexOf(p) >= 0; }).map(function (p) {
                var lab = { email_otp: 'Email code', none: 'Email link only', password: 'Password (not built yet)', sms_otp: 'SMS code (not licensed)', oauth: 'OAuth (not built yet)' }[p];
                return opt(p, lab, x.protection === p, p !== 'email_otp' && p !== 'none'); }).join('') + '</select>'
            : '<select class="cro-in" data-k="internalMode">' + (O.internalModes || ['circularo_login']).map(function (m) {
                var lab = { circularo_login: 'Circularo account', as_external: 'As external (email code)', saml: 'SSO / SAML (not set up)' }[m] || m;
                return opt(m, lab, x.internalMode === m, m === 'saml'); }).join('') + '</select>') + '</td>' +
          (L[S.layout] ? '<td><select class="cro-in" data-k="anchorId">' + roleOpts(x.anchorId) + '</select></td>' : '') +
          '<td>' + (lock && mode === 'signnow' ? '' : '<button class="cro-x" data-del="' + i + '" title="Remove">×</button>') + '</td></tr>';
      };
      var draw = function () {
        if (S.done) return drawDone();
        var lay = L[S.layout];
        main().innerHTML =
          '<div class="cro-h1"><h1>Send for signature</h1><div class="ctl"><div class="cro-seg">' + Object.keys(MODES).map(function (k) {
            return '<button data-mode="' + k + '" class="' + (k === mode ? 'on' : '') + '">' + MODES[k].t + '</button>'; }).join('') + '</div></div></div>' +
          '<p class="cro-lead">' + esc(MODES[mode].d) + '</p>' +
          '<div class="cro-grid cro-g11">' +
          '<div class="cro-card"><h2>1. Document</h2>' +
            '<label class="cro-drop" id="croDrop"><input type="file" id="croFile" accept=".pdf,.docx" hidden>' +
            (S.file ? '<b>' + esc(S.file.name) + '</b><span>' + (S.file.size / 1048576).toFixed(2) + ' MB · click to change</span>' : '<b>Choose a PDF or Word file</b><span>or drop it here</span>') + '</label>' +
            '<div class="cro-f"><label>Title</label><input class="cro-in" id="croTitle" maxlength="200" value="' + esc(S.title) + '" placeholder="Shown to recipients"></div>' +
          '</div>' +
          '<div class="cro-card"><h2>2. Signature fields</h2>' +
            '<div class="cro-f"><label>Layout</label><select class="cro-in" id="croLayout">' + opt('', 'None – ad hoc document', !S.layout) +
              Object.keys(L).filter(function (k) { return L[k].placement !== 'dynamic-word-template'; }).map(function (k) { return opt(k, (L[k].title || k) + ' (' + k + ')', S.layout === k); }).join('') + '</select></div>' +
            (lay && /^anchors/.test(lay.placement)
              ? '<div class="cro-note">Fields are placed by anchor text in the document. Choose which field each recipient gets in the table below.</div>'
              : '<div class="cro-f"><label>Ad hoc placement</label>' + (O.adhocOptions || ['default_position']).map(function (a) {
                  var lab = { default_position: 'Default position on the last page', circularo_editor: 'Place in Circularo\'s editor', tta_placer: 'Place in TotalAgility', detect: 'Detect signature lines', tokens: '{{sign:n}} tokens' }[a] || a;
                  var ready = a === 'default_position';
                  return '<label class="cro-radio' + (ready ? '' : ' off') + '"><input type="radio" name="croAdhoc" value="' + a + '"' + (S.adhocOption === a ? ' checked' : '') + (ready ? '' : ' disabled') + '> ' + esc(lab) + (ready ? '' : ' <small>not built yet</small>') + '</label>';
                }).join('') + '</div>') +
          '</div></div>' +
          '<div class="cro-card" style="margin-top:16px"><h2>3. Recipients <small>' + (mode === 'signnow' ? 'just you' : S.rcps.length + ' of up to 100') + '</small></h2>' +
            (mode !== 'signnow' ? '<label class="cro-check"><input type="checkbox" id="croSeq"' + (S.sequential ? ' checked' : '') + '> Signing order (same number = sign in parallel)</label>' : '') +
            '<table class="cro-table cro-rcp"><tr>' + (showOrder() ? '<th>Order</th>' : '') + '<th>Name</th><th>Email</th><th>Type</th><th>Action</th><th>Security</th>' + (lay ? '<th>Field</th>' : '') + '<th></th></tr>' +
            S.rcps.map(rowHtml).join('') + '</table>' +
            '<datalist id="croUsers">' + USERS.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.full_name) + '</option>'; }).join('') + '</datalist>' +
            (mode !== 'signnow' ? '<div style="margin-top:12px;display:flex;gap:8px"><button class="cro-btn2" id="croAdd">+ Add recipient</button>' + (mode === 'theysign' && !S.rcps.some(function (x) { return x.me; }) ? '<button class="cro-btn2" id="croAddMe">+ Add me</button>' : '') + '</div>' : '') +
          '</div>' +
          '<div class="cro-card" style="margin-top:16px"><h2>4. Options</h2><div class="cro-grid cro-g3">' +
            '<div class="cro-f"><label>Deadline</label><input class="cro-in" type="date" id="croDeadline" value="' + esc(S.deadline) + '"></div>' +
            '<div class="cro-f"><label>Reminders</label><div class="cro-ro">' + (D.reminders && D.reminders.intervalDays ? 'Every ' + D.reminders.intervalDays + ' days, starting after ' + D.reminders.startDays + ' days' : 'Off') + '</div></div>' +
            '<div class="cro-f"><label>After sending</label><div class="cro-ro">Circularo emails each recipient' + (mode !== 'theysign' ? '; you can also sign from here' : '') + '</div></div>' +
          '</div></div>' +
          '<div id="croMsg"></div>' +
          '<div class="cro-actions"><a class="cro-btn2" href="' + link('dashboard') + '">Cancel</a><button class="cro-btn" id="croGo"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? esc(S.busy) : mode === 'signnow' ? 'Prepare and sign' : 'Send for signature') + '</button></div>';
        wire();
      };
      var wire = function () {
        main().querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { mode = b.getAttribute('data-mode'); history.replaceState(null, '', link('send', 'mode=' + mode)); resetRcps(); draw(); }; });
        var fi = document.getElementById('croFile'), drop = document.getElementById('croDrop');
        var setFile = function (f) {
          if (!f) return;
          if (!/\.(pdf|docx)$/i.test(f.name)) return toast('Choose a PDF or Word (.docx) file.', true);
          var max = (CFG.circularo && CFG.circularo.maxUploadMB) || 40;
          if (f.size > max * 1048576) return toast('The file is larger than ' + max + ' MB.', true);
          S.file = f; if (!S.title) S.title = cleanTitle(f.name);
          var base = f.name.replace(/\.[^.]+$/, '');
          if (!S.layout && L[base]) { S.layout = base; resetRcps(); toast('Layout "' + (L[base].title || base) + '" selected from the file name.'); }
          draw();
        };
        fi.onchange = function () { setFile(fi.files[0]); };
        drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
        drop.ondragleave = function () { drop.classList.remove('over'); };
        drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
        document.getElementById('croTitle').oninput = function (e) { S.title = e.target.value; };
        document.getElementById('croLayout').onchange = function (e) { S.layout = e.target.value; resetRcps(); draw(); };
        main().querySelectorAll('input[name=croAdhoc]').forEach(function (r) { r.onchange = function () { S.adhocOption = r.value; }; });
        var seq = document.getElementById('croSeq'); if (seq) seq.onchange = function () { S.sequential = seq.checked; draw(); };
        document.getElementById('croDeadline').onchange = function (e) { S.deadline = e.target.value; };
        main().querySelectorAll('.cro-rcp [data-k]').forEach(function (el) {
          var k = el.getAttribute('data-k');
          var put = function () { var x = S.rcps[+el.closest('tr').getAttribute('data-i')]; x[k] = k === 'order' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value; return x; };
          el.oninput = put;
          el.onchange = function () {
            var x = put(), redraw = k === 'kind';
            if (k === 'email' && el.value) {
              var u = USERS.filter(function (u) { return u.email.toLowerCase() === el.value.trim().toLowerCase(); })[0];
              if (u && (x.kind !== 'internal' || !x.fullName)) { x.kind = 'internal'; if (!x.fullName) x.fullName = u.full_name; redraw = true; }
            }
            if (redraw) draw();
          };
        });
        main().querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { S.rcps.splice(+b.getAttribute('data-del'), 1); draw(); }; });
        var add = document.getElementById('croAdd'); if (add) add.onclick = function () { var mx = S.rcps.reduce(function (m, x) { return Math.max(m, x.order || 1); }, 0); S.rcps.push(blank(S.sequential ? mx + 1 : 1)); draw(); };
        var addMe = document.getElementById('croAddMe'); if (addMe) addMe.onclick = function () { var mx = S.rcps.reduce(function (m, x) { return Math.max(m, x.order || 1); }, 0); S.rcps.push(meRow(S.sequential ? mx + 1 : 1)); draw(); };
        document.getElementById('croGo').onclick = submit;
      };
      var fail2 = function (m) { document.getElementById('croMsg').innerHTML = '<div class="cro-err">' + esc(m) + '</div>'; document.getElementById('croMsg').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      var submit = function () {
        var title = cleanTitle(S.title);
        if (!S.file) return fail2('Choose the document to send.');
        if (!title) return fail2('Enter a title.');
        if (!S.rcps.length) return fail2('Add at least one recipient.');
        for (var i = 0; i < S.rcps.length; i++) {
          var x = S.rcps[i];
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email || '')) return fail2('Recipient ' + (i + 1) + (x.me ? ' (you)' : '') + ' needs a valid email address' + (x.me ? ' – your TotalAgility user has no email address.' : '.'));
        }
        var seen = {}; for (var j = 0; j < S.rcps.length; j++) { var e = S.rcps[j].email.toLowerCase(); if (seen[e]) return fail2(e + ' is listed twice.'); seen[e] = 1; }
        if (!S.rcps.some(function (x) { return ['sign', 'approve', 'accept'].indexOf(x.purpose) >= 0; })) return fail2('At least one recipient must sign, approve or accept.');
        var lay = L[S.layout];
        var until = S.deadline ? new Date(S.deadline + 'T23:59:00') : null;
        if (until && until.getTime() < Date.now()) return fail2('The deadline is in the past.');
        var orders = {}; S.rcps.forEach(function (x) { orders[S.sequential ? x.order : 1] = 1; });
        var body = {
          title: title, layoutKey: S.layout || null,
          placement: lay && /^anchors/.test(lay.placement) ? 'anchors' : 'adhoc',
          adhocOption: lay && /^anchors/.test(lay.placement) ? null : S.adhocOption,
          sequential: Object.keys(orders).length > 1,
          validUntilUtc: until ? until.toISOString() : null,
          businessRef: 'CRO_Send/' + mode,
          recipients: S.rcps.map(function (x) {
            return { order: S.sequential ? x.order : 1, kind: x.kind, email: x.email.trim().toLowerCase(), fullName: x.fullName || null, purpose: x.purpose,
              protection: x.kind === 'external' ? x.protection : 'none', internalMode: x.kind === 'internal' ? x.internalMode : null, anchorId: x.anchorId || null };
          })
        };
        var created = null;
        S.busy = 'Reading the file…'; draw();
        fileB64(S.file).then(function (b64) {
          S.busy = 'Creating the request…'; draw();
          return cro('request_create', body).then(function (c) {
            created = set0(c)[0];
            S.busy = 'Uploading to Circularo and sharing…'; draw();
            return cro('request_send', { requestId: created.request_id, fileName: S.file.name, fileB64: b64 });
          });
        }).then(function (res) {
          S.busy = false; S.done = { req: created, res: res, title: title, mine: S.rcps.some(function (x) { return x.me && ['sign', 'approve', 'accept'].indexOf(x.purpose) >= 0; }) }; draw();
        }).catch(function (e) {
          S.busy = false; draw();
          fail2((created ? 'Request ' + created.request_id + ' was created but could not be sent: ' : '') + e.message);
        });
      };
      var drawDone = function () {
        var d = S.done, r = d.res || {};
        var first = S.rcps.reduce(function (m, x) { return Math.min(m, S.sequential ? x.order : 1); }, 99);
        var myTurn = S.rcps.some(function (x) { return x.me && (S.sequential ? x.order : 1) === first; });
        main().innerHTML =
          '<div class="cro-card cro-done"><div class="big">✓</div><h1>' + (mode === 'signnow' ? 'Ready to sign' : 'Sent for signature') + '</h1>' +
          '<p><b>' + esc(d.title) + '</b> · request ' + esc(d.req.request_id) + '</p>' +
          '<div class="cro-kv" style="max-width:460px;margin:16px auto;text-align:left">' +
            '<span>Signature fields</span><b>' + esc(r.fields) + ' (' + esc({ anchors: 'anchor text', adhoc: 'ad hoc', 'anchors+default': 'anchors + default position', default_position: 'default position' }[r.placementUsed] || r.placementUsed) + ')</b>' +
            '<span>Pages</span><b>' + esc(r.pages) + '</b>' +
            '<span>Signing order</span><b>' + (r.sequential ? 'In order' : 'All at once') + '</b>' +
            '<span>Recipients</span><b>' + esc((r.shares || []).length) + '</b></div>' +
          ((r.notes || []).length ? '<div class="cro-note" style="text-align:left">Notes: ' + esc(r.notes.join('; ')) + '</div>' : '') +
          '<div class="cro-actions" style="justify-content:center">' +
            (d.mine ? '<button class="cro-btn" id="croSign"' + (myTurn ? '' : ' title="Others sign before you; Circularo will email you when it is your turn."') + '>' + (myTurn ? 'Sign now' : 'Open in Circularo') + '</button>' : '') +
            '<a class="cro-btn2" href="' + link('request', 'id=' + d.req.request_id) + '">View request</a>' +
            '<a class="cro-btn2" href="' + link('send', 'mode=' + mode) + '">Send another</a>' +
            '<a class="cro-btn2" href="' + link('dashboard') + '">Dashboard</a></div></div>';
        var b = document.getElementById('croSign'); if (b) b.onclick = function () { openSigning(d.req.request_id, b); };
      };
      draw();
    }).catch(fail);
  };

  /* ---------- requests list ---------- */
  var FILTERS = [['all', 'All'], ['assigned', 'Assigned to me'], ['waiting', 'Waiting for others'], ['completed', 'Completed'],
    ['deadline', 'Approaching deadline'], ['attention', 'Needs attention'], ['sent', 'Sent by me']];
  var RSTATUS = { pending: ['Not yet', '#98A2B3'], waiting: ['Their turn', '#2E90FA'], signed: ['Done', '#12B76A'], rejected: ['Rejected', '#F04438'],
    delegated: ['Delegated', '#7A5AF8'], expired: ['Expired', '#F79009'], cancelled: ['Cancelled', '#667085'] };
  var pill = function (st) { var s = STATE[st] || { label: st, c: '#667085' }; return '<span class="cro-pill" style="background:' + s.c + '1F;color:' + s.c + '">' + esc(s.label) + '</span>'; };
  var rpill = function (st) { var s = RSTATUS[st] || [st, '#667085']; return '<span class="cro-pill" style="background:' + s[1] + '1F;color:' + s[1] + '">' + esc(s[0]) + '</span>'; };
  var renderRequests = function () {
    var F = { filter: q('filter') || 'all', scope: q('scope') === 'all' ? 'all' : 'mine', state: q('state'), search: q('q'), page: +(q('page') || 1) };
    var isAdmin = false, timer = null;
    var url = function () {
      var p = []; if (F.filter !== 'all') p.push('filter=' + F.filter); if (F.scope === 'all') p.push('scope=all');
      if (F.state) p.push('state=' + F.state); if (F.search) p.push('q=' + encodeURIComponent(F.search)); if (F.page > 1) p.push('page=' + F.page);
      history.replaceState(null, '', link('requests', p.join('&')));
    };
    main().innerHTML =
      '<div class="cro-h1"><h1>Requests</h1><div class="ctl"><span id="croScope"></span><a class="cro-btn" href="' + link('send') + '">Send for signature</a></div></div>' +
      '<div class="cro-chips" id="croChips"></div>' +
      '<div class="cro-card"><div class="cro-tools"><input class="cro-in" id="croQ" placeholder="Search title, reference, recipient name or email, request number" value="' + esc(F.search) + '">' +
      '<select class="cro-in" id="croState" style="max-width:200px"><option value="">Any status</option>' + Object.keys(STATE).map(function (k) { return '<option value="' + k + '"' + (F.state === k ? ' selected' : '') + '>' + STATE[k].label + '</option>'; }).join('') + '</select></div>' +
      '<div id="croList"><div class="cro-skel">Loading…</div></div></div>';
    var chips = function () {
      document.getElementById('croChips').innerHTML = FILTERS.map(function (f) { return '<button data-f="' + f[0] + '" class="' + (F.filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('');
      main().querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { F.filter = b.getAttribute('data-f'); F.page = 1; chips(); load(); }; });
      document.getElementById('croScope').innerHTML = isAdmin ? '<div class="cro-seg"><button data-s="mine" class="' + (F.scope === 'mine' ? 'on' : '') + '">Mine</button><button data-s="all" class="' + (F.scope === 'all' ? 'on' : '') + '">All</button></div>' : '';
      main().querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { F.scope = b.getAttribute('data-s'); F.page = 1; chips(); load(); }; });
    };
    var load = function () {
      url();
      var box = document.getElementById('croList'); box.style.opacity = .5;
      cro('request_search', { scope: F.scope, filter: F.filter, state: F.state, search: F.search, page: F.page, pageSize: 25 }).then(function (r) {
        isAdmin = !!r.isAdmin; if (r.scope !== F.scope) F.scope = r.scope; chips();
        var rows = set0(r.rows), total = rows.length ? rows[0].total_count : 0, pages = Math.max(1, Math.ceil(total / 25));
        box.style.opacity = 1;
        if (!rows.length) { box.innerHTML = '<div class="cro-empty">No requests match.</div>'; return; }
        box.innerHTML = '<table class="cro-table cro-list"><tr><th>Request</th><th>Status</th><th>Progress</th><th>Sent by</th><th>Sent</th><th>Deadline</th><th></th></tr>' +
          rows.map(function (x) {
            var dl = asDate(x.valid_until_utc), soon = x.state === 'inprogress' && dl && dl.getTime() - Date.now() < 3 * 864e5;
            var mine = x.state === 'inprogress' && x.my_status === 'waiting';
            return '<tr><td><a class="cro-title" href="' + link('request', 'id=' + x.request_id) + '">' + esc(x.title) + '</a><div class="cro-sub">#' + esc(x.request_id) + (x.business_ref ? ' · ' + esc(x.business_ref) : '') + (x.layout_key ? ' · ' + esc(x.layout_key) : '') + '</div></td>' +
              '<td>' + pill(x.state) + (mine ? ' <span class="cro-pill" style="background:#FEF0C7;color:#B54708">Your turn</span>' : '') + '</td>' +
              '<td><div class="cro-bar" style="width:90px"><i style="width:' + (x.recipients ? Math.round(100 * x.signed / x.recipients) : 0) + '%;background:var(--cro-ok)"></i></div><div class="cro-sub">' + esc(x.signed) + ' of ' + esc(x.recipients) + (x.waiting_for ? ' · waiting for ' + esc(x.waiting_for) : '') + '</div></td>' +
              '<td>' + esc(who(x.created_by_name)) + (x.is_mine ? ' <span class="cro-sub">(you)</span>' : '') + '</td>' +
              '<td title="' + esc(when(x.sent_utc || x.created_utc)) + '">' + esc(ago(x.sent_utc || x.created_utc)) + '</td>' +
              '<td class="' + (soon ? 'cro-warnc' : '') + '">' + (dl ? esc(dl.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })) : '–') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' + (mine ? '<button class="cro-btn cro-sm" data-sign="' + x.request_id + '">Sign</button> ' : '') + '<a class="cro-btn2 cro-sm" href="' + link('request', 'id=' + x.request_id) + '">Open</a></td></tr>';
          }).join('') + '</table>' +
          '<div class="cro-pager"><span>' + total + ' request' + (total === 1 ? '' : 's') + '</span>' + (pages > 1 ? '<span><button class="cro-btn2 cro-sm" data-p="-1"' + (F.page <= 1 ? ' disabled' : '') + '>‹ Previous</button> Page ' + F.page + ' of ' + pages + ' <button class="cro-btn2 cro-sm" data-p="1"' + (F.page >= pages ? ' disabled' : '') + '>Next ›</button></span>' : '') + '</div>';
        box.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { F.page += +b.getAttribute('data-p'); load(); }; });
        box.querySelectorAll('[data-sign]').forEach(function (b) { b.onclick = function () { openSigning(+b.getAttribute('data-sign'), b); }; });
      }).catch(function (e) { box.style.opacity = 1; box.innerHTML = '<div class="cro-err">' + esc(e.message) + '</div>'; });
    };
    chips();
    document.getElementById('croQ').oninput = function (e) { clearTimeout(timer); timer = setTimeout(function () { F.search = e.target.value.trim(); F.page = 1; load(); }, 400); };
    document.getElementById('croState').onchange = function (e) { F.state = e.target.value; F.page = 1; load(); };
    load();
  };

  /* ---------- one request ---------- */
  var download = function (requestId, kind, btn) {
    if (btn) btn.disabled = true;
    return cro('output_get', { requestId: requestId, kind: kind }).then(function (o) {
      var bin = atob(o.b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: o.contentType || 'application/pdf' }));
      a.download = o.fileName || (kind + '.pdf'); document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }).catch(function (e) { toast(e.message, true); }).then(function () { if (btn) btn.disabled = false; });
  };
  var renderRequest = function () {
    var id = q('id');
    if (!/^\d+$/.test(id)) { main().innerHTML = '<div class="cro-err">No request selected.</div><a class="cro-btn2" href="' + link('requests') + '">All requests</a>'; return; }
    var load = function () {
      return cro('request_detail', { requestId: +id }).then(function (d) {
        var R = (d.request[0] || [])[0], RC = d.request[1] || [], OUT = set0(d.outputs), TL = set0(d.timeline), A = d.access || {};
        if (!R) throw new Error('Request not found.');
        var manage = A.creator || A.admin, open = R.state === 'inprogress';
        var mine = open && A.myStatus === 'waiting';
        var kv = function (k, v) { return v ? '<span>' + k + '</span><b>' + v + '</b>' : ''; };
        var PURP = PURPOSES;
        main().innerHTML =
          '<div class="cro-crumb"><a href="' + link('requests') + '">‹ Requests</a></div>' +
          '<div class="cro-h1"><h1>' + esc(R.title) + ' ' + pill(R.state) + '</h1><div class="ctl">' +
            (mine ? '<button class="cro-btn" id="croSign">Sign now</button>' : '') +
            (manage && open ? '<button class="cro-btn2" id="croRefresh">Refresh status</button>' : '') +
            (manage && R.state === 'completed' && !R.outputs_retrieved_utc ? '<button class="cro-btn2" id="croOutputs">Fetch signed copy</button>' : '') +
            (manage && (open || R.state === 'draft' || R.state === 'failed') ? '<button class="cro-btn2 cro-danger" id="croCancel">Cancel request</button>' : '') +
          '</div></div>' +
          '<div id="croConfirm"></div>' +
          (R.state_reason && R.state !== 'inprogress' && R.state !== 'completed' ? '<div class="cro-err">' + esc(R.state_reason) + '</div>' : '') +
          '<div class="cro-grid cro-g21">' +
            '<div class="cro-card"><h2>Recipients <small>' + (R.sequential ? 'in order' : 'all at once') + '</small></h2>' +
              '<table class="cro-table"><tr><th>#</th><th>Recipient</th><th>Action</th><th>Security</th><th>Field</th><th>Status</th></tr>' +
              RC.map(function (x) {
                var me = A.email && x.email.toLowerCase() === A.email.toLowerCase();
                return '<tr><td>' + esc(x.sign_order) + '</td><td><b>' + esc(x.full_name || x.email) + '</b>' + (me ? ' <span class="cro-sub">(you)</span>' : '') +
                  '<div class="cro-sub">' + esc(x.email) + ' · ' + (x.kind === 'internal' ? 'internal' : 'external') + '</div></td>' +
                  '<td>' + esc(PURP[x.share_purpose] || x.share_purpose) + '</td>' +
                  '<td>' + esc(x.kind === 'internal' ? ({ circularo_login: 'Circularo account', as_external: 'Email code', saml: 'SSO' }[x.internal_mode] || '–') : ({ email_otp: 'Email code', none: 'Link only', password: 'Password', sms_otp: 'SMS code', oauth: 'OAuth' }[x.protection] || x.protection)) + '</td>' +
                  '<td>' + esc(x.anchor_id ? x.anchor_id.replace(/_/g, ' ') : (R.placement_used || '').indexOf('default') >= 0 || R.placement === 'adhoc' ? 'default position' : '–') + '</td>' +
                  '<td>' + rpill(x.status) + (x.acted_utc && x.status === 'signed' ? '<div class="cro-sub" title="' + esc(when(x.acted_utc)) + '">' + esc(ago(x.acted_utc)) + '</div>' : '') + '</td></tr>';
              }).join('') + '</table></div>' +
            '<div class="cro-card"><h2>Details</h2><div class="cro-kv">' +
              kv('Request', '#' + esc(R.request_id)) + kv('Reference', esc(R.business_ref || '')) +
              kv('Sent by', esc(who(R.created_by_name))) + kv('Created', esc(when(R.created_utc))) + kv('Sent', R.sent_utc ? esc(when(R.sent_utc)) : '') +
              kv('Deadline', R.valid_until_utc ? esc(when(R.valid_until_utc)) : '') + kv(R.state === 'completed' ? 'Completed' : 'Closed', R.completed_utc ? esc(when(R.completed_utc)) : '') +
              kv('Layout', esc(R.layout_key || 'none (ad hoc)')) + kv('Fields placed by', esc(R.placement_used || R.placement)) +
              kv('Last update', R.last_event_utc || R.last_checked_utc ? esc(ago(R.last_event_utc > R.last_checked_utc ? R.last_event_utc : (R.last_checked_utc || R.last_event_utc))) : '') +
              kv('Circularo id', R.circularo_document_id ? '<span class="cro-mono">' + esc(R.circularo_document_id.slice(0, 8)) + '…</span>' : '') +
            '</div></div>' +
          '</div>' +
          '<div class="cro-grid cro-g12" style="margin-top:16px">' +
            '<div class="cro-card"><h2>Documents</h2>' + (!manage ? '<div class="cro-empty">The sender can download the signed copy.</div>' : OUT.length ? OUT.map(function (o) {
                return '<div class="cro-file"><div><b>' + esc({ signed: 'Signed document', audit: 'Audit trail', certificate: 'Certificate of fulfillment' }[o.kind] || o.kind) + '</b><div class="cro-sub">' + esc(Math.max(1, Math.round(o.size_bytes / 1024))) + ' KB' + (o.has_signature ? ' · digitally signed' : '') + '</div></div><button class="cro-btn2 cro-sm" data-dl="' + esc(o.kind) + '">Download</button></div>';
              }).join('') : '<div class="cro-empty">' + (R.state === 'completed' ? 'Not stored yet – the sync fetches them within a few minutes.' : 'Available when everyone has signed.') + '</div>') + '</div>' +
            '<div class="cro-card"><h2>History</h2><ul class="cro-act">' + (TL.length ? TL.map(function (t) {
                var c = t.outcome === 'ok' ? (t.source === 'circularo' ? '#12B76A' : '#4E3FD8') : '#F04438';
                var what = { output_saved: 'File stored', request_set_document: 'Uploaded to Circularo', request_set_shares: 'Shared with recipients', request_detail: 'Access refused', webhook_receive: 'Webhook received' }[t.what] || t.what;
                if (t.what === 'output_saved' && t.detail) what += ' – ' + String(t.detail).split(/[;,]/)[0];
                return '<li><span class="cro-dot" style="background:' + c + '"></span><span class="t" title="' + esc(when(t.at_utc)) + '">' + esc(ago(t.at_utc)) + '</span><span><b>' + esc(what) + '</b>' + (t.who ? ' · ' + esc(who(t.who)) : '') +
                  (t.outcome !== 'ok' ? ' <span class="cro-pill cro-badc">' + esc(t.outcome) + '</span>' : '') + (t.detail && t.outcome !== 'ok' ? '<div class="cro-sub">' + esc(String(t.detail).slice(0, 200)) + '</div>' : '') + '</span></li>';
              }).join('') : '<li class="cro-empty">Nothing yet.</li>') + '</ul></div>' +
          '</div>';
        var on = function (idv, fn) { var b = document.getElementById(idv); if (b) b.onclick = function () { fn(b); }; };
        on('croSign', function (b) { openSigning(+id, b); });
        on('croRefresh', function (b) { b.disabled = true; cro('request_refresh', { requestId: +id }).then(function () { toast('Status updated from Circularo.'); return load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
        on('croOutputs', function (b) { b.disabled = true; cro('request_outputs', { requestId: +id }).then(function () { toast('Signed copy stored.'); return load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
        on('croCancel', function () {
          var c = document.getElementById('croConfirm');
          c.innerHTML = '<div class="cro-card cro-confirm"><b>Cancel this request?</b> Circularo stops the signing for everyone and recipients can no longer sign. This cannot be undone.' +
            '<div class="cro-f" style="margin-top:10px"><label>Reason (optional)</label><input class="cro-in" id="croWhy" maxlength="400"></div>' +
            '<div class="cro-actions" style="margin-top:8px"><button class="cro-btn2" id="croNo">Keep it</button><button class="cro-btn cro-dangerbtn" id="croYes">Cancel request</button></div></div>';
          document.getElementById('croNo').onclick = function () { c.innerHTML = ''; };
          document.getElementById('croYes').onclick = function (e) {
            e.target.disabled = true;
            cro('request_cancel', { requestId: +id, reason: document.getElementById('croWhy').value.trim() }).then(function () { toast('Request cancelled.'); return load(); })
              .catch(function (er) { e.target.disabled = false; toast(er.message, true); });
          };
        });
        main().querySelectorAll('[data-dl]').forEach(function (b) { b.onclick = function () { download(+id, b.getAttribute('data-dl'), b); }; });
      });
    };
    main().innerHTML = '<div class="cro-skel">Loading…</div>';
    load().catch(fail);
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
    send: renderSend,
    requests: renderRequests,
    request: renderRequest,
    users: function () { renderSoon('Users'); }
  }[page] || renderDashboard)();
})();
