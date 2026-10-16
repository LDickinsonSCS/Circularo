/* CRO e-Signing (TotalAgility x Circularo) - front end.
   Loaded from server variable CRO_UI_JS by each thin CRO_* form. The page is chosen by a hidden marker:
   <div data-cro-page="dashboard|send|requests|request|users"></div>.
   All data comes from the synchronous CRO API process; the caller is identified on the server. */
(function () {
  if (window.__croUi) return; window.__croUi = 1;
  var VERSION = 'cro-ui 0.11.0';
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
          if (/Invalid Session/i.test(msg)) { msg = 'Your session has expired. Taking you to the sign-in page…'; setTimeout(toLogin, 800); }
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
    draft: { label: 'Draft', c: '#98A2B3' }, sending: { label: 'Sending', c: '#7000FF' }, inprogress: { label: 'In progress', c: '#22AFFF' },
    completed: { label: 'Completed', c: '#12B76A' }, rejected: { label: 'Rejected', c: '#F04438' }, expired: { label: 'Expired', c: '#F79009' },
    cancelled: { label: 'Cancelled', c: '#667085' }, failed: { label: 'Failed', c: '#B42318' }
  };
  var SIG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 30"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#FF6D69"/><stop offset="1" stop-color="#FFC600"/></linearGradient></defs>' +
    '<path d="M4 20 C 60 10, 120 26, 170 14 C 200 7, 214 12, 206 19 C 200 24, 232 14, 296 8" fill="none" stroke="url(%23g)" stroke-width="5" stroke-linecap="round"/></svg>').replace(/%2523/g, '%23');
  var CSS = [
    ':root{--cro-ink:#1B1B2F;--cro-sub:#4A5265;--cro-mute:#667085;--cro-line:#E4E7EF;--cro-bg:#F6F7FB;--cro-card:#fff;--cro-acc:#0F0069;--cro-acc-h:#7000FF;--cro-acc2:#EFEAFF;--cro-navy:#002854;--cro-sky:#22AFFF;--cro-coral:#FF6D69;--cro-amber:#FFC600;--cro-ok:#12B76A;--cro-bad:#F04438;--cro-warn:#F79009;' +
      '--cro-rh:"Red Hat Display","Segoe UI",system-ui,Arial,sans-serif;--cro-sp:"League Spartan","Red Hat Display",system-ui,Arial,sans-serif}',
    '.cro{font:14px/1.5 var(--cro-rh);color:var(--cro-ink);background:var(--cro-bg);min-height:100vh;margin:0}',
    '.cro *{box-sizing:border-box}',
    '.cro-top{display:flex;align-items:center;gap:24px;padding:0 28px;height:64px;position:sticky;top:0;z-index:5;color:#fff;' +
      'background:linear-gradient(135deg,var(--cro-navy) 0,var(--cro-navy) 340px,var(--cro-acc) 340px,var(--cro-acc) 100%);box-shadow:0 2px 12px rgba(0,16,48,.18)}',
    '.cro-brand{display:flex;align-items:center;gap:10px;font:800 19px/1 var(--cro-sp);letter-spacing:-.2px;color:#fff;text-decoration:none;white-space:nowrap}',
    '.cro-brand i{width:30px;height:30px;border-radius:50%;background:var(--cro-acc-h);display:grid;place-items:center;flex:none;box-shadow:0 4px 12px rgba(112,0,255,.45)}',
    '.cro-nav{display:flex;gap:4px;flex:1}',
    '.cro-nav a{position:relative;padding:8px 12px;color:rgba(255,255,255,.78);text-decoration:none;font-weight:500}',
    '.cro-nav a:hover{color:#fff}.cro-nav a.on{color:#fff;font-weight:700}',
    '.cro-nav a.on:after{content:"";position:absolute;left:12px;right:12px;bottom:-2px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--cro-coral),var(--cro-amber))}',
    '.cro-nav a:focus-visible,.cro-brand:focus-visible,.cro-out:focus-visible{outline:2px solid var(--cro-amber);outline-offset:2px;border-radius:6px}',
    '.cro-me{color:rgba(255,255,255,.8);font-size:13px;white-space:nowrap}',
    '.cro-main{max-width:1240px;margin:0 auto;padding:28px}',
    '.cro-h1{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px}',
    '.cro-h1 h1{font:800 30px/1.1 var(--cro-sp);letter-spacing:-.3px;color:var(--cro-acc);margin:0;padding-bottom:16px;position:relative}.cro-h1 .ctl{display:flex;gap:8px;align-items:center}',
    '.cro-h1 h1:after{content:"";position:absolute;left:-2px;bottom:0;width:132px;height:14px;background:url("' + SIG + '") no-repeat left center/contain;clip-path:inset(0 100% 0 0);animation:croSig .9s .15s cubic-bezier(.6,.1,.3,1) forwards}',
    '@keyframes croSig{to{clip-path:inset(0 0 0 0)}}@media (prefers-reduced-motion:reduce){.cro-h1 h1:after{animation:none;clip-path:none}}',
    '.cro-seg{display:inline-flex;background:#fff;border:1px solid var(--cro-line);border-radius:8px;overflow:hidden}',
    '.cro-seg button{border:0;background:none;padding:7px 12px;font:inherit;font-weight:500;color:var(--cro-sub);cursor:pointer}',
    '.cro-seg button.on{background:var(--cro-acc);color:#fff}',
    '.cro-grid{display:grid;gap:16px}',
    '.cro-g3{grid-template-columns:repeat(3,1fr)}.cro-g5{grid-template-columns:repeat(5,1fr)}.cro-g21{grid-template-columns:2fr 1fr}.cro-g12{grid-template-columns:1fr 2fr}.cro-g11{grid-template-columns:1fr 1fr}',
    '@media(max-width:900px){.cro-g3,.cro-g5,.cro-g21,.cro-g12,.cro-g11{grid-template-columns:1fr}.cro-nav{display:none}}',
    '.cro-card{background:var(--cro-card);border:1px solid var(--cro-line);border-radius:12px;padding:20px;overflow-x:auto}',
    '.cro-card h2{font:700 16px/1.3 var(--cro-rh);color:var(--cro-ink);margin:0 0 14px;display:flex;justify-content:space-between;align-items:center}',
    '.cro-card h2 small{font-weight:400;color:var(--cro-mute);font-size:12px}',
    '.cro-tile{display:flex;gap:16px;align-items:center;text-decoration:none;color:inherit;transition:transform .12s,box-shadow .12s}',
    '.cro-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(16,24,40,.08)}',
    '.cro-tile .ic{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--cro-navy) 50%,var(--cro-acc) 50%);display:grid;place-items:center;flex:none}',
    '.cro-tile:hover .ic{background:var(--cro-acc-h)}',
    '.cro-tile b{display:block;font:700 16px/1.3 var(--cro-rh);color:var(--cro-acc)}.cro-tile span{color:var(--cro-mute);font-size:13px}',
    '.cro-stat{text-decoration:none;color:inherit;display:block;text-align:center}',
    '.cro-stat .n{font:800 34px/1.1 var(--cro-sp);margin-top:6px}.cro-stat .l{color:var(--cro-sub);font-size:13px}',
    '.cro-stat:hover{border-color:#CBB8FF}',
    '.cro-sec{margin:28px 0 12px;color:var(--cro-mute);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
    '.cro-legend{display:flex;flex-wrap:wrap;gap:10px 16px;font-size:12px;color:var(--cro-sub)}',
    '.cro-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}',
    '.cro-kv{display:grid;grid-template-columns:1fr auto;gap:8px 16px;font-size:13px}.cro-kv span{color:var(--cro-sub)}.cro-kv b{text-align:right}',
    '.cro-big{font:800 36px/1.1 var(--cro-sp)}.cro-big small{font-size:14px;color:var(--cro-mute);font-weight:400;margin-left:6px}',
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
    '.cro-in:focus{outline:0;border-color:var(--cro-acc);box-shadow:0 0 0 3px rgba(255,198,0,.45)}.cro-in:disabled{background:var(--cro-bg);color:var(--cro-sub)}',
    '.cro-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:2px dashed #D0D5DD;border-radius:12px;padding:26px;cursor:pointer;margin-bottom:14px;text-align:center}',
    '.cro-drop:hover,.cro-drop.over{border-color:var(--cro-acc);background:var(--cro-acc2)}.cro-drop span{color:var(--cro-mute);font-size:13px}',
    '.cro-radio{display:block;padding:4px 0;font-weight:400 !important;color:var(--cro-ink) !important;font-size:14px !important}.cro-radio.off{color:var(--cro-mute) !important}.cro-radio small{color:var(--cro-mute)}',
    '.cro-check{display:block;margin-bottom:10px;color:var(--cro-sub)}',
    '.cro-note{background:var(--cro-acc2);color:var(--cro-acc);border-radius:8px;padding:10px 12px;font-size:13px}',
    '.cro-hint{font-size:11px;color:var(--cro-acc-h);margin-top:2px}.cro-ro{padding:8px 0;color:var(--cro-sub)}',
    '.cro-rcp td{padding:6px 4px}.cro-x{border:0;background:none;font-size:20px;color:var(--cro-mute);cursor:pointer;padding:4px 8px}.cro-x:hover{color:var(--cro-bad)}',
    '.cro-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}',
    '.cro-btn,.cro-btn2{font:inherit;font-weight:600;border-radius:8px;padding:10px 18px;cursor:pointer;text-decoration:none;display:inline-block}',
    '.cro-btn{background:var(--cro-acc);color:#fff;border:1px solid var(--cro-acc);transition:background .15s,border-color .15s}.cro-btn:hover{background:var(--cro-acc-h);border-color:var(--cro-acc-h)}.cro-btn:disabled{opacity:.6;cursor:wait}',
    '.cro-btn:focus-visible,.cro-btn2:focus-visible,.cro-seg button:focus-visible,.cro-chips button:focus-visible{outline:3px solid var(--cro-amber);outline-offset:2px}',
    '.cro-btn2{background:#fff;color:var(--cro-ink);border:1px solid #D0D5DD}.cro-btn2:hover{background:var(--cro-bg)}',
    '.cro-done{text-align:center;padding:40px}.cro-done .big{width:64px;height:64px;border-radius:50%;background:#D1FADF;color:#039855;font-size:32px;display:grid;place-items:center;margin:0 auto 12px}.cro-done h1{margin:0 0 6px;font:800 28px/1.15 var(--cro-sp);color:var(--cro-acc)}',
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
    '.cro-ptools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.cro-pnav{margin-left:auto;white-space:nowrap;color:var(--cro-sub)}',
    '.cro-page{position:relative;max-width:820px;margin:0 auto;border:1px solid var(--cro-line);box-shadow:0 2px 10px rgba(16,24,40,.08);background:#fff;user-select:none}',
    '.cro-page img{display:block;width:100%}.cro-ov{position:absolute;inset:0;cursor:crosshair}',
    '.cro-fld{position:absolute;border:2px dashed;border-radius:4px;font-size:11px;font-weight:600;cursor:move;display:flex;align-items:center;padding:0 4px;overflow:hidden;white-space:nowrap}',
    '.cro-fld b{margin-left:auto;cursor:pointer;font-size:14px;padding:0 2px}',
    '.cro-groups{margin-top:10px;display:flex;flex-direction:column;gap:6px;color:var(--cro-sub);font-size:13px}.cro-rights{margin-top:4px}',
    '.cro-out{border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;margin-left:12px}.cro-out:hover{background:rgba(255,255,255,.12);border-color:#fff}',
    '.cro-foot{color:var(--cro-mute);font-size:12px;padding:24px 28px;max-width:1240px;margin:0 auto;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.cro svg text{font-family:var(--cro-rh)}'
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
    if (!document.getElementById('croFonts')) {
      var lk = document.createElement('link'); lk.id = 'croFonts'; lk.rel = 'stylesheet';
      lk.href = 'https://fonts.googleapis.com/css2?family=League+Spartan:wght@600;700;800&family=Red+Hat+Display:wght@400;500;700&display=swap';
      document.head.appendChild(lk);
    }
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // hide the TotalAgility form chrome; the marker cell becomes our root
    var marker = document.querySelector('[data-cro-page]');
    root = document.createElement('div'); root.className = 'cro';
    document.body.appendChild(root);
    try { Array.prototype.forEach.call(document.body.children, function (c) { if (c !== root && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE' && !c.classList.contains('cro-toast')) c.style.display = 'none'; }); } catch (e) { }
    if (marker) marker.style.display = 'none';
    document.body.style.margin = '0'; document.body.style.background = '#F6F7FB';
    root.innerHTML =
      '<div class="cro-top"><a class="cro-brand" href="' + link('dashboard') + '"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>CRO e-Signing</a>' +
      '<nav class="cro-nav">' +
      [['dashboard', 'Dashboard'], ['send', 'Send for signature'], ['requests', 'Requests'], ['users', 'Users']].map(function (p) {
        return '<a href="' + link(p[0]) + '"' + (page === p[0] || (page === 'request' && p[0] === 'requests') ? ' class="on"' : '') + '>' + p[1] + '</a>';
      }).join('') + '</nav><span class="cro-me" id="croMe"></span><button class="cro-out" id="croOut" title="Sign out">Sign out</button></div>' +
      '<div class="cro-main" id="croMain"><div class="cro-skel">Loading…</div></div>' +
      '<div class="cro-foot"><span>Tungsten TotalAgility and Circularo integration</span><span>Built by Sudocode Solutions, ' + VERSION + '</span></div>';
  };
  var LOGIN_URL = BASE + '/forms/cro';                         // friendly alias (IIS) for the CRO sign-in form
  var LOGIN_FORM = FORMS + 'CRO_Login.form';
  var signOut = function () {
    var done = function () {
      try { ['SESSION_ID', 'TASessionID', 'croAccessOk', 'croReturn'].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) { }
      location.href = LOGIN_URL;
    };
    sdk('UserService', 'LogOff', {}).then(done, done);
  };
  var toLogin = function () { location.href = LOGIN_FORM + '?return=' + encodeURIComponent(location.pathname + location.search); };
  var main = function () { return document.getElementById('croMain'); };
  document.addEventListener('click', function (e) { if (e.target && e.target.id === 'croOut') { e.target.disabled = true; signOut(); } });
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
      if (r.sent) g += '<rect x="' + (x - bw - 1) + '" y="' + y(r.sent) + '" width="' + bw + '" height="' + (H - B - y(r.sent)) + '" rx="2" fill="#7000FF"><title>' + esc(lab + ' sent: ' + r.sent) + '</title></rect>';
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
      var MIXL = { anchors: 'Anchor text', default_position: 'Default position (ad hoc)', 'anchors+default': 'Anchors + default', adhoc: 'Ad hoc', coordinates: 'Coordinates', template: 'Circularo template', word_template: 'Word template', detect: 'Signing wording', tokens: '{{sign:n}} tokens', 'tokens+default': 'Tokens + default', tta_placer: 'Placed in TotalAgility', 'tta_placer+default': 'Placed + default', 'detect+default': 'Wording + default', circularo_editor: 'Circularo editor' };
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
        stat(ov.waiting_for_others, 'Waiting for others', '#7000FF', 'waiting') +
        stat(ov.completed, 'Completed', '#12B76A', 'completed') +
        stat(ov.approaching_deadline, 'Approaching deadline', '#D92D20', 'deadline') +
        stat(ov.needs_attention, 'Needs attention', '#B42318', 'attention') +
        '</div>' +
        '<div class="cro-sec">Reports · last ' + dash.days + ' days</div>' +
        '<div class="cro-grid cro-g12">' +
        '<div class="cro-card"><h2>Requests by status</h2><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' + donut(parts, total) +
        '<div class="cro-legend" style="flex-direction:column">' + parts.filter(function (p) { return p.v; }).map(function (p) { return '<span><i style="background:' + p.c + '"></i>' + p.label + ' · <b>' + p.v + '</b></span>'; }).join('') + '</div></div></div>' +
        '<div class="cro-card"><h2>Volume over time <span class="cro-legend"><span><i style="background:#7000FF"></i>Sent</span><span><i style="background:#12B76A"></i>Completed</span></span></h2>' + volume(vol) + '</div>' +
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
          var c = /signed|completed|stored/.test(a.what) ? '#12B76A' : /reject|fail|expire|cancel/.test(a.what) ? '#F04438' : '#7000FF';
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
    Promise.all([cro('me', {}), cro('config', {}), cro('user_list', {}).catch(function () { return [[]]; }), cro('contact_list', {}).catch(function () { return [[]]; })]).then(function (r) {
      var ME = r[0], CFG = r[1], USERS = set0(r[2]), CONTACTS = set0(r[3]);
      var isContact = function (em) { em = String(em || '').trim().toLowerCase(); return CONTACTS.some(function (c) { return c.email === em; }); };
      var D = CFG.defaults || {}, O = CFG.options || {}, L = CFG.layouts || {};
      var dl = new Date(Date.now() + (D.deadlineDays || 14) * 864e5);
      var S = { file: null, title: '', layout: '', adhocOption: D.adhocOption || 'default_position', sequential: D.sequential !== false,
        deadline: dl.toISOString().slice(0, 10), rcps: [], busy: false, done: null, message: '', rightsCustom: false, rights: { print: true, delegate: false, rejectWithoutComment: false, uploadFiles: false }, quorum: {} };
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

      /* --- TotalAgility placer: click on the page preview to place each recipient's fields --- */
      S.fields = []; S.pg = 1; S.who = 1; S.ftype = 'signature'; S.pdf = null; S.img = {}; S.pdfFor = null;
      var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
      var loadPdfJs = function () {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        return new Promise(function (ok, bad) {
          var sc = document.createElement('script'); sc.src = PDFJS + 'pdf.min.js';
          sc.onload = function () { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(pdfjsLib); };
          sc.onerror = function () { bad(new Error('Could not load the PDF viewer.')); };
          document.head.appendChild(sc);
        });
      };
      var placing = function () { var lay = L[S.layout]; return !(lay && /^anchors/.test(lay.placement)) && S.adhocOption === 'tta_placer'; };
      var COLORS = ['#7000FF', '#E8590C', '#0E9384', '#C11574', '#2E90FA', '#7A5AF8', '#B54708', '#039855'];
      var signers = function () { return S.rcps.map(function (x, i) { return { n: i + 1, x: x }; }).filter(function (o) { return ['sign', 'approve', 'accept'].indexOf(o.x.purpose) >= 0; }); };
      var placerHtml = function () {
        if (!placing()) return '';
        var body;
        if (!S.file) body = '<div class="cro-empty">Choose the document first.</div>';
        else if (!/\.pdf$/i.test(S.file.name)) body = '<div class="cro-note">The placer works on PDF files. For a Word file use {{sign:n}} tokens or the default position, or save it as PDF.</div>';
        else {
          var sg = signers(); if (!sg.some(function (o) { return o.n === S.who; }) && sg.length) S.who = sg[0].n;
          body = '<div class="cro-ptools"><div class="cro-chips" style="margin:0">' + sg.map(function (o) {
              var c = COLORS[(o.n - 1) % COLORS.length], cnt = S.fields.filter(function (f) { return f.recipient === o.n; }).length;
              return '<button data-who="' + o.n + '" class="' + (S.who === o.n ? 'on' : '') + '" style="' + (S.who === o.n ? 'background:' + c + ';border-color:' + c : 'border-color:' + c + ';color:' + c) + '">#' + o.n + ' ' + esc(o.x.fullName || o.x.email || 'recipient') + ' · ' + cnt + '</button>';
            }).join('') + '</div>' +
            '<select class="cro-in" id="croFType" style="max-width:150px"><option value="signature"' + (S.ftype === 'signature' ? ' selected' : '') + '>Signature</option><option value="initials"' + (S.ftype === 'initials' ? ' selected' : '') + '>Initials</option></select>' +
            '<span class="cro-pnav"><button class="cro-btn2 cro-sm" id="croPrev">‹</button> <span id="croPgLbl">Page ' + S.pg + '</span> <button class="cro-btn2 cro-sm" id="croNext">›</button></span></div>' +
            '<div class="cro-hint" style="margin:8px 0">Choose a recipient, then click on the page where they sign. Drag a box to move it; × removes it. Signers with no box get the default position.</div>' +
            '<div class="cro-page" id="croPage"><div class="cro-skel">Loading preview…</div></div>';
        }
        return '<div class="cro-card" style="margin-top:16px"><h2>Place signature fields <small>' + S.fields.length + ' placed</small></h2>' + body + '</div>';
      };
      var renderPage = function () {
        var box = document.getElementById('croPage'); if (!box) return;
        var paint = function (url) {
          box.innerHTML = '<img src="' + url + '" draggable="false"><div class="cro-ov" id="croOv"></div>';
          var ov = document.getElementById('croOv');
          S.fields.forEach(function (f, i) {
            if (f.page !== S.pg) return;
            var c = COLORS[(f.recipient - 1) % COLORS.length], r = S.rcps[f.recipient - 1] || {};
            var d = document.createElement('div'); d.className = 'cro-fld';
            d.style.cssText = 'left:' + f.x * 100 + '%;top:' + f.y * 100 + '%;width:' + f.w * 100 + '%;height:' + f.h * 100 + '%;border-color:' + c + ';background:' + c + '22;color:' + c;
            d.innerHTML = '<span>#' + f.recipient + ' ' + esc(r.fullName || '') + ' · ' + (f.type === 'initials' ? 'initials' : 'sign') + '</span><b data-rm="' + i + '">×</b>';
            d.onmousedown = function (e) {
              if (e.target.getAttribute('data-rm')) return;
              e.preventDefault(); e.stopPropagation();
              var R = ov.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y;
              var mv = function (ev) { f.x = Math.min(1 - f.w, Math.max(0, ox + (ev.clientX - sx) / R.width)); f.y = Math.min(1 - f.h, Math.max(0, oy + (ev.clientY - sy) / R.height)); d.style.left = f.x * 100 + '%'; d.style.top = f.y * 100 + '%'; };
              var up = function () { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
              document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
            };
            ov.appendChild(d);
          });
          ov.onclick = function (e) {
            var rm = e.target.getAttribute && e.target.getAttribute('data-rm');
            if (rm != null) { S.fields.splice(+rm, 1); draw(); return; }
            if (e.target !== ov) return;
            var R = ov.getBoundingClientRect(), w = S.ftype === 'initials' ? 0.08 : 0.22, h = 0.045;
            var x = Math.min(1 - w, Math.max(0, (e.clientX - R.left) / R.width - w / 2)), y = Math.min(1 - h, Math.max(0, (e.clientY - R.top) / R.height - h / 2));
            S.fields.push({ recipient: S.who, page: S.pg, x: +x.toFixed(4), y: +y.toFixed(4), w: w, h: h, type: S.ftype });
            draw();
          };
        };
        if (S.img[S.pg]) return paint(S.img[S.pg]);
        var go = S.pdf && S.pdfFor === S.file ? Promise.resolve(S.pdf) : loadPdfJs().then(function (lib) {
          return S.file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; }).then(function (doc) { S.pdf = doc; S.pdfFor = S.file; S.img = {}; return doc; });
        });
        go.then(function (doc) {
          if (S.pg > doc.numPages) S.pg = doc.numPages;
          var lbl = document.getElementById('croPgLbl'); if (lbl) lbl.textContent = 'Page ' + S.pg + ' of ' + doc.numPages;
          return doc.getPage(S.pg).then(function (page) {
            var vp = page.getViewport({ scale: 1.4 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
            return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { S.img[S.pg] = cv.toDataURL('image/png'); paint(S.img[S.pg]); });
          });
        }).catch(function (e) { box.innerHTML = '<div class="cro-err">' + esc(e.message) + '</div>'; });
      };
      var wirePlacer = function () {
        if (!placing() || !S.file || !/\.pdf$/i.test(S.file.name)) return;
        main().querySelectorAll('[data-who]').forEach(function (b) { b.onclick = function () { S.who = +b.getAttribute('data-who'); draw(); }; });
        var ft = document.getElementById('croFType'); if (ft) ft.onchange = function () { S.ftype = ft.value; };
        var pv = document.getElementById('croPrev'), nx = document.getElementById('croNext');
        if (pv) pv.onclick = function () { if (S.pg > 1) { S.pg--; draw(); } };
        if (nx) nx.onclick = function () { if (!S.pdf || S.pg < S.pdf.numPages) { S.pg++; draw(); } };
        if (S.pdf && S.pdfFor === S.file) { var lbl = document.getElementById('croPgLbl'); if (lbl) lbl.textContent = 'Page ' + S.pg + ' of ' + S.pdf.numPages; }
        renderPage();
      };

      var groups = function () {
        if (!S.sequential || mode === 'signnow') return [];
        var by = {}; S.rcps.forEach(function (x) { if (['sign', 'approve', 'accept'].indexOf(x.purpose) >= 0) (by[x.order] = by[x.order] || []).push(x); });
        return Object.keys(by).filter(function (o) { return by[o].length > 1; }).map(function (o) { return { order: +o, n: by[o].length }; });
      };
      var groupsHtml = function () {
        var g = groups(); if (!g.length) return '';
        return '<div class="cro-groups">' + g.map(function (x) {
          var q = S.quorum[x.order] || 0, o = '<option value="0"' + (!q ? ' selected' : '') + '>all ' + x.n + ' must act</option>';
          for (var k = 1; k < x.n; k++) o += '<option value="' + k + '"' + (q === k ? ' selected' : '') + '>any ' + k + ' of ' + x.n + '</option>';
          return '<label>Order ' + x.order + ' is a signing group: <select class="cro-in cro-sm" data-q="' + x.order + '" style="width:auto">' + o + '</select></label>';
        }).join('') + '</div>';
      };
      var opt = function (v, label, sel, dis) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + esc(label) + '</option>'; };
      var roleOpts = function (cur) {
        var lay = L[S.layout]; if (!lay) return '';
        return opt('', '(no field – default position)', !cur) + (lay.roles || []).map(function (ro) { return opt(ro.role, ro.role.replace(/_/g, ' '), cur === ro.role); }).join('');
      };
      var showOrder = function () { return S.sequential && mode !== 'signnow'; };
      var rowHtml = function (x, i) {
        var ext = x.kind === 'external', lock = x.me;
        return '<tr data-i="' + i + '"><td class="cro-sub" title="Recipient number (for {{sign:n}} tokens)">' + (i + 1) + '</td>' +
          (showOrder() ? '<td><input class="cro-in" style="width:56px" type="number" min="1" max="20" data-k="order" value="' + esc(x.order) + '"></td>' : '') +
          '<td><input class="cro-in" data-k="fullName" placeholder="Full name" value="' + esc(x.fullName) + '"' + (lock ? ' disabled' : '') + '></td>' +
          '<td><input class="cro-in" data-k="email" list="croUsers" placeholder="name@company.com" value="' + esc(x.email) + '"' + (lock ? ' disabled' : '') + '>' + (lock ? '<div class="cro-hint">You</div>' : ext && /@/.test(x.email || '') ? (isContact(x.email) ? '<div class="cro-hint">In your contacts</div>' : '<label class="cro-hint" style="display:block;color:var(--cro-sub)"><input type="checkbox" data-save="' + i + '"' + (x.saveContact ? ' checked' : '') + '> Save to my contacts</label>') : '') + '</td>' +
          '<td><select class="cro-in" data-k="kind"' + (lock ? ' disabled' : '') + '>' + opt('internal', 'Internal', !ext) + opt('external', 'External', ext) + '</select></td>' +
          '<td><select class="cro-in" data-k="purpose">' + (O.purposes || ['sign']).map(function (p) { return opt(p, PURPOSES[p] || p, x.purpose === p); }).join('') + '</select></td>' +
          '<td>' + (ext
            ? '<select class="cro-in" data-k="protection">' + ['email_otp', 'none', 'password', 'sms_otp', 'oauth'].filter(function (p) { return (O.protection || []).indexOf(p) >= 0; }).map(function (p) {
                var lab = { email_otp: 'Email code', none: 'Email link only', password: 'Password', sms_otp: 'SMS code (not licensed)', oauth: 'OAuth (not built yet)' }[p];
                return opt(p, lab, x.protection === p, p !== 'email_otp' && p !== 'none' && p !== 'password'); }).join('') + '</select>' + (x.protection === 'password' ? '<input class="cro-in" style="margin-top:4px" type="password" autocomplete="new-password" data-k="password" placeholder="Password (min 6, tell them separately)" value="' + esc(x.password || '') + '">' : '')
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
                  var lab = { default_position: 'Default position on the last page', circularo_editor: 'Place in Circularo\'s editor', tta_placer: 'Place in TotalAgility', detect: 'Find "Signed by / on behalf of" wording', tokens: '{{sign:n}} tokens' }[a] || a;
                  var ready = true;
                  return '<label class="cro-radio' + (ready ? '' : ' off') + '"><input type="radio" name="croAdhoc" value="' + a + '"' + (S.adhocOption === a ? ' checked' : '') + (ready ? '' : ' disabled') + '> ' + esc(lab) + (ready ? '' : ' <small>not built yet</small>') + '</label>';
                }).join('') + (S.adhocOption === 'detect' ? '<div class="cro-note" style="margin-top:8px">A signature field goes just above each "Signed by", "Signed on behalf of", "Authorised signatory" or "Signature:" found, top to bottom, one per signing recipient in table order. Recipients left over get the default position.</div>' : '') + (S.adhocOption === 'circularo_editor' ? '<div class="cro-note" style="margin-top:8px">The document opens in Circularo\'s own editor, where you add recipients and fields and send. Needs your Circularo account linked on the Users page; the recipients below are only placeholders – CRO imports the ones you choose in Circularo.</div>' : '') + (S.adhocOption === 'tokens' ? '<div class="cro-note" style="margin-top:8px">Put <b>{{sign:1}}</b>, <b>{{sign:2}}</b> … in the document where each recipient signs (number = row in the recipients table). Recipients without a token get the default position.</div>' : '') + '</div>') +
          '</div></div>' +
          '<div class="cro-card" style="margin-top:16px"><h2>3. Recipients <small>' + (mode === 'signnow' ? 'just you' : S.rcps.length + ' of up to 100') + '</small></h2>' +
            (mode !== 'signnow' ? '<label class="cro-check"><input type="checkbox" id="croSeq"' + (S.sequential ? ' checked' : '') + '> Signing order (same number = sign in parallel)</label>' : '') +
            '<table class="cro-table cro-rcp"><tr><th>#</th>' + (showOrder() ? '<th>Order</th>' : '') + '<th>Name</th><th>Email</th><th>Type</th><th>Action</th><th>Security</th>' + (lay ? '<th>Field</th>' : '') + '<th></th></tr>' +
            S.rcps.map(rowHtml).join('') + '</table>' +
            groupsHtml() + '<datalist id="croUsers">' + USERS.map(function (u) { return '<option value="' + esc(u.email) + '">' + esc(u.full_name) + ' (internal)</option>'; }).join('') + CONTACTS.map(function (c) { return '<option value="' + esc(c.email) + '">' + esc((c.full_name || c.email) + (c.company ? ' · ' + c.company : '') + ' (contact)') + '</option>'; }).join('') + '</datalist>' +
            (mode !== 'signnow' ? '<div style="margin-top:12px;display:flex;gap:8px"><button class="cro-btn2" id="croAdd">+ Add recipient</button>' + (mode === 'theysign' && !S.rcps.some(function (x) { return x.me; }) ? '<button class="cro-btn2" id="croAddMe">+ Add me</button>' : '') + '</div>' : '') +
          '</div>' +
          placerHtml() +
          '<div class="cro-card" style="margin-top:16px"><h2>4. Options</h2><div class="cro-grid cro-g3">' +
            '<div class="cro-f"><label>Deadline</label><input class="cro-in" type="date" id="croDeadline" value="' + esc(S.deadline) + '"></div>' +
            '<div class="cro-f"><label>Reminders</label><div class="cro-ro">' + (CFG.reminders && CFG.reminders.by === 'tta' ? 'TotalAgility emails a link after ' + (CFG.reminders.firstAfterHours || 48) + ' h, then every ' + (CFG.reminders.everyHours || 48) + ' h (max ' + (CFG.reminders.max || 5) + ')' : D.reminders && D.reminders.intervalDays ? 'Circularo: every ' + D.reminders.intervalDays + ' days, starting after ' + D.reminders.startDays + ' days' : 'Off') + '</div></div>' +
            '<div class="cro-f"><label>After sending</label><div class="cro-ro">Circularo emails each recipient' + (mode !== 'theysign' ? '; you can also sign from here' : '') + '</div></div>' +
          '</div>' +
          '<div class="cro-grid cro-g11"><div class="cro-f"><label>Message to recipients (optional)</label><textarea class="cro-in" id="croMsgTxt" rows="3" maxlength="1000">' + esc(S.message) + '</textarea></div>' +
          '<div class="cro-f"><label>Recipient rights</label><label class="cro-check" style="margin:0"><input type="checkbox" id="croRightsDef"' + (S.rightsCustom ? '' : ' checked') + '> Use Circularo\'s organisation defaults</label>' +
          (S.rightsCustom ? '<div class="cro-rights">' + [['print', 'Print / download'], ['delegate', 'Delegate to someone else'], ['rejectWithoutComment', 'Reject without a comment'], ['uploadFiles', 'Upload files']].map(function (r) {
            return '<label class="cro-check" style="margin:2px 0"><input type="checkbox" data-right="' + r[0] + '"' + (S.rights[r[0]] ? ' checked' : '') + '> ' + r[1] + '</label>'; }).join('') + '</div>' : '') +
          '</div></div></div>' +
          '<div id="croMsg"></div>' +
          '<div class="cro-actions"><a class="cro-btn2" href="' + link('dashboard') + '">Cancel</a><button class="cro-btn" id="croGo"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? esc(S.busy) : mode === 'signnow' ? 'Prepare and sign' : 'Send for signature') + '</button></div>';
        wire(); wirePlacer();
      };
      var wire = function () {
        main().querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { mode = b.getAttribute('data-mode'); history.replaceState(null, '', link('send', 'mode=' + mode)); resetRcps(); draw(); }; });
        var fi = document.getElementById('croFile'), drop = document.getElementById('croDrop');
        var setFile = function (f) {
          if (!f) return;
          if (!/\.(pdf|docx)$/i.test(f.name)) return toast('Choose a PDF or Word (.docx) file.', true);
          var max = (CFG.circularo && CFG.circularo.maxUploadMB) || 40;
          if (f.size > max * 1048576) return toast('The file is larger than ' + max + ' MB.', true);
          S.file = f; S.fields = []; S.pg = 1; S.img = {}; S.pdf = null; if (!S.title) S.title = cleanTitle(f.name);
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
        main().querySelectorAll('input[name=croAdhoc]').forEach(function (r) { r.onchange = function () { S.adhocOption = r.value; draw(); }; });
        var seq = document.getElementById('croSeq'); if (seq) seq.onchange = function () { S.sequential = seq.checked; draw(); };
        document.getElementById('croDeadline').onchange = function (e) { S.deadline = e.target.value; };
        document.getElementById('croMsgTxt').oninput = function (e) { S.message = e.target.value; };
        document.getElementById('croRightsDef').onchange = function (e) { S.rightsCustom = !e.target.checked; draw(); };
        main().querySelectorAll('[data-right]').forEach(function (c) { c.onchange = function () { S.rights[c.getAttribute('data-right')] = c.checked; }; });
        main().querySelectorAll('[data-q]').forEach(function (c) { c.onchange = function () { S.quorum[+c.getAttribute('data-q')] = +c.value; }; });
        main().querySelectorAll('.cro-rcp [data-k]').forEach(function (el) {
          var k = el.getAttribute('data-k');
          var put = function () { var x = S.rcps[+el.closest('tr').getAttribute('data-i')]; x[k] = k === 'order' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value; return x; };
          el.oninput = put;
          el.onchange = function () {
            var x = put(), redraw = k === 'kind' || k === 'protection' || k === 'order' || k === 'purpose';
            if (k === 'email' && el.value) {
              var u = USERS.filter(function (u) { return u.email.toLowerCase() === el.value.trim().toLowerCase(); })[0];
              if (u && (x.kind !== 'internal' || !x.fullName)) { x.kind = 'internal'; if (!x.fullName) x.fullName = u.full_name; redraw = true; }
              var ct = CONTACTS.filter(function (c) { return c.email === el.value.trim().toLowerCase(); })[0];
              if (!u && ct) { x.kind = 'external'; if (!x.fullName) x.fullName = ct.full_name || ''; x.saveContact = false; redraw = true; }
              if (!u && !ct) redraw = true;
            }
            if (redraw) draw();
          };
        });
        main().querySelectorAll('[data-save]').forEach(function (c) { c.onchange = function () { S.rcps[+c.getAttribute('data-save')].saveContact = c.checked; }; });
        main().querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { var k = +b.getAttribute('data-del'); S.rcps.splice(k, 1); S.fields = S.fields.filter(function (f) { return f.recipient !== k + 1; }).map(function (f) { if (f.recipient > k + 1) f.recipient--; return f; }); draw(); }; });
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
        for (var pi = 0; pi < S.rcps.length; pi++) if (S.rcps[pi].kind === 'external' && S.rcps[pi].protection === 'password' && String(S.rcps[pi].password || '').length < 6) return fail2('Recipient ' + (pi + 1) + ' needs a password of at least 6 characters.');
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
          options: (function () {
            var o = {}, pw = {}, q = {};
            if (S.message.trim()) o.message = S.message.trim();
            if (S.rightsCustom) o.rights = Object.keys(S.rights).filter(function (k) { return S.rights[k]; });
            S.rcps.forEach(function (x, i) { if (x.kind === 'external' && x.protection === 'password') pw[i + 1] = x.password; });
            groups().forEach(function (g) { if (S.quorum[g.order]) q[g.order] = S.quorum[g.order]; });
            if (Object.keys(pw).length) o.passwords = pw; if (Object.keys(q).length) o.quorum = q;
            return o;
          })(),
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
            var editor = !(L[S.layout] && /^anchors/.test(L[S.layout].placement)) && S.adhocOption === 'circularo_editor';
            S.busy = editor ? 'Uploading to Circularo…' : 'Uploading to Circularo and sharing…'; draw();
            if (editor) return cro('request_prepare', { requestId: created.request_id, fileName: S.file.name, fileB64: b64, returnUrl: location.origin + link('request', 'id=' + created.request_id) }).then(function (r) { r.editor = true; return r; });
            return cro('request_send', { requestId: created.request_id, fileName: S.file.name, fileB64: b64, fields: placing() ? S.fields : [], options: body.options });
          });
        }).then(function (res) {
          var keep = S.rcps.filter(function (x) { return x.kind === 'external' && x.saveContact && !isContact(x.email); }).map(function (x) { return { email: x.email.trim().toLowerCase(), fullName: x.fullName || '' }; });
          if (keep.length) cro('contact_save', { contacts: keep }).then(function () { toast(keep.length + ' contact(s) saved.'); }).catch(function (e) { toast('Contacts not saved: ' + e.message, true); });
          S.busy = false; S.done = { req: created, res: res, title: title, mine: S.rcps.some(function (x) { return x.me && ['sign', 'approve', 'accept'].indexOf(x.purpose) >= 0; }) }; draw();
        }).catch(function (e) {
          S.busy = false; draw();
          fail2((created ? 'Request ' + created.request_id + ' was created but could not be sent: ' : '') + e.message);
        });
      };
      var drawDone = function () {
        var d = S.done, r = d.res || {};
        if (r.editor) {
          main().innerHTML = '<div class="cro-card cro-done"><div class="big">✎</div><h1>Ready for the Circularo editor</h1>' +
            '<p><b>' + esc(d.title) + '</b> · request ' + esc(d.req.request_id) + '</p><p class="cro-sub">' + esc(r.note) + ' When you send in Circularo, CRO picks up the recipients automatically.</p>' +
            '<div class="cro-actions" style="justify-content:center"><a class="cro-btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open Circularo editor</a>' +
            '<a class="cro-btn2" href="' + link('request', 'id=' + d.req.request_id) + '">View request</a><a class="cro-btn2" href="' + link('dashboard') + '">Dashboard</a></div></div>';
          return;
        }
        var first = S.rcps.reduce(function (m, x) { return Math.min(m, S.sequential ? x.order : 1); }, 99);
        var myTurn = S.rcps.some(function (x) { return x.me && (S.sequential ? x.order : 1) === first; });
        main().innerHTML =
          '<div class="cro-card cro-done"><div class="big">✓</div><h1>' + (mode === 'signnow' ? 'Ready to sign' : 'Sent for signature') + '</h1>' +
          '<p><b>' + esc(d.title) + '</b> · request ' + esc(d.req.request_id) + '</p>' +
          '<div class="cro-kv" style="max-width:460px;margin:16px auto;text-align:left">' +
            '<span>Signature fields</span><b>' + esc(r.fields) + ' (' + esc({ anchors: 'anchor text', adhoc: 'ad hoc', 'anchors+default': 'anchors + default position', default_position: 'default position', tokens: '{{sign:n}} tokens', 'tokens+default': 'tokens + default position', tta_placer: 'placed in TotalAgility', 'tta_placer+default': 'placed + default position', detect: 'signing wording', 'detect+default': 'signing wording + default position' }[r.placementUsed] || r.placementUsed) + ')</b>' +
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
            (manage && open ? '<button class="cro-btn2" id="croRemind">Send reminder</button>' : '') +
            (manage && R.state === 'sending' && R.placement_used === 'circularo_editor' ? '<button class="cro-btn" id="croImport">Check Circularo for recipients</button>' : '') +
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
                var c = t.outcome === 'ok' ? (t.source === 'circularo' ? '#12B76A' : '#7000FF') : '#F04438';
                var what = { output_saved: 'File stored', request_set_document: 'Uploaded to Circularo', request_set_shares: 'Shared with recipients', request_detail: 'Access refused', reminder_sent: 'Reminder sent', webhook_receive: 'Webhook received' }[t.what] || t.what;
                if (t.what === 'output_saved' && t.detail) what += ' – ' + String(t.detail).split(/[;,]/)[0];
                return '<li><span class="cro-dot" style="background:' + c + '"></span><span class="t" title="' + esc(when(t.at_utc)) + '">' + esc(ago(t.at_utc)) + '</span><span><b>' + esc(what) + '</b>' + (t.who ? ' · ' + esc(who(t.who)) : '') +
                  (t.outcome !== 'ok' ? ' <span class="cro-pill cro-badc">' + esc(t.outcome) + '</span>' : '') + (t.detail && t.outcome !== 'ok' ? '<div class="cro-sub">' + esc(String(t.detail).slice(0, 200)) + '</div>' : '') + '</span></li>';
              }).join('') : '<li class="cro-empty">Nothing yet.</li>') + '</ul></div>' +
          '</div>';
        var on = function (idv, fn) { var b = document.getElementById(idv); if (b) b.onclick = function () { fn(b); }; };
        on('croSign', function (b) { openSigning(+id, b); });
        on('croRemind', function (b) { b.disabled = true; cro('request_remind', { requestId: +id }).then(function (r) { toast((r.by === 'tta' ? 'Reminder email with the signing link sent to ' : 'Reminder sent to ') + r.reminded + ' recipient(s).'); return load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
        on('croImport', function (b) { b.disabled = true; cro('request_import', { requestId: +id }).then(function (r) { toast(r.imported ? r.imported + ' recipient(s) imported from Circularo.' : 'Not sent from the Circularo editor yet.'); return load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
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

  /* ---------- users (admins) ---------- */
  var USTATUS = { pending: ['Not in Circularo', '#98A2B3'], invited: ['Invited', '#7A5AF8'], active: ['Active', '#12B76A'], suspended: ['Suspended', '#F79009'],
    deleted: ['Deleted', '#667085'], error: ['Error', '#F04438'], newly_created: ['Invited', '#7A5AF8'] };
  var upill = function (st) { var s = USTATUS[st] || [st || '–', '#667085']; return '<span class="cro-pill" style="background:' + s[1] + '1F;color:' + s[1] + '">' + esc(s[0]) + '</span>'; };
  var ROLE_LABEL = { sign: 'Signer', user: 'User', prepare: 'Preparer', read: 'Read only', admin: 'Admin' };
  var renderUsers = function () {
    main().innerHTML = '<div class="cro-skel">Loading…</div>';
    var tta = [];
    var ttaP = sdk('ResourceService', 'GetResources', { resourceFilter: { ResourceType: 0, SearchText: '' }, resourceIconSettings: null })
      .then(function (l) { tta = (l || []).filter(function (r) { return r.EmailAddress; }).map(function (r) { return { id: r.Identity.Id, name: r.Identity.Name, email: String(r.EmailAddress).toLowerCase() }; }); })
      .catch(function () { tta = []; });
    var load = function () {
      return Promise.all([cro('users_overview', {}), ttaP, cro('access_requests', { status: 'pending' }).catch(function () { return [[]]; })]).then(function (r) {
        var AR = set0(r[2]);
        var d = r[0], recs = set0(d.records), cx = d.circularo || [], org = d.org || {}, G = org.groups || {};
        var roleOf = function (groups) { for (var k in G) if ((groups || []).indexOf(G[k]) >= 0 && k !== 'user') return k; return (groups || []).indexOf(G.user) >= 0 ? 'user' : ''; };
        var ttaBy = function (id, email) { return tta.filter(function (t) { return (id && t.id === id) || (!id && email && t.email === email.toLowerCase()); })[0]; };
        var used = {};
        var rows = recs.map(function (u) {
          var c = cx.filter(function (x) { return (u.circularo_username && x.name === u.circularo_username) || x.mail.toLowerCase() === u.email.toLowerCase(); })[0];
          if (c) used[c.name] = 1;
          return { rec: u, cx: c };
        });
        cx.forEach(function (c) { if (!used[c.name]) rows.push({ rec: null, cx: c }); });
        main().innerHTML =
          '<div class="cro-h1"><h1>Users</h1><div class="ctl"><button class="cro-btn2" id="croReload">Refresh</button></div></div>' +
          '<p class="cro-lead">TotalAgility manages the Circularo accounts of internal signers. External signers need no account.</p>' +
          (AR.length ? '<div class="cro-card" style="margin-bottom:16px;border-color:#FEC84B"><h2>Access requests <small>' + AR.length + ' waiting</small></h2><table class="cro-table cro-list"><tr><th>Person</th><th>Asked</th><th>Note</th><th></th></tr>' +
            AR.map(function (q, i) { return '<tr><td><b>' + esc(q.full_name) + '</b><div class="cro-sub">' + esc(q.email || 'no email in TotalAgility') + '</div></td><td title="' + esc(when(q.requested_utc)) + '">' + esc(ago(q.requested_utc)) + '</td><td>' + esc(q.note || '') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' + (q.email ? '<button class="cro-btn cro-sm" data-arinv="' + i + '">Invite to Circularo</button> ' : '') + '<button class="cro-btn2 cro-sm" data-ardec="' + i + '">Decline</button></td></tr>'; }).join('') + '</table></div>' : '') +
          '<div class="cro-card"><h2>People <small>' + rows.length + '</small></h2>' +
          '<table class="cro-table cro-list"><tr><th>Person</th><th>TotalAgility user</th><th>Circularo account</th><th>Role</th><th>Status</th><th></th></tr>' +
          rows.map(function (x, i) {
            var u = x.rec, c = x.cx, t = u ? ttaBy(u.tta_resource_id, u.tta_resource_id ? '' : u.email) : ttaBy('', c.mail);
            var st = u ? u.status : (c.status === 'newly_created' ? 'invited' : c.status);
            var role = u ? u.circularo_role : roleOf(c.groups);
            var acts = '';
            if (!u) acts = '<button class="cro-btn2 cro-sm" data-manage="' + i + '">Manage in CRO</button>';
            else if (!c && (u.status === 'pending' || u.status === 'error')) acts = '<button class="cro-btn cro-sm" data-invite="' + i + '">Invite to Circularo</button>';
            if (u && c && st === 'active') acts += ' <button class="cro-btn2 cro-sm cro-danger" data-st="' + i + '" data-to="suspended">Suspend</button>';
            if (u && c && st === 'suspended') acts += ' <button class="cro-btn2 cro-sm" data-st="' + i + '" data-to="active">Reactivate</button>';
            return '<tr><td><b>' + esc(u ? u.full_name : c.fullname) + '</b><div class="cro-sub">' + esc(u ? u.email : c.mail) + '</div></td>' +
              '<td>' + (t ? esc(t.name) : '<span class="cro-sub">–</span>') + '</td>' +
              '<td>' + (c ? '<span class="cro-mono" style="font-size:12px">' + esc(c.name) + '</span>' : '<span class="cro-sub">none</span>') + (u ? '' : '<div class="cro-sub">not managed by CRO</div>') + '</td>' +
              '<td>' + esc(ROLE_LABEL[role] || role || '–') + '</td>' +
              '<td>' + upill(st) + (u && u.last_error ? '<div class="cro-sub cro-badc" title="' + esc(u.last_error) + '">' + esc(u.last_error.slice(0, 60)) + '</div>' : '') + '</td>' +
              '<td style="text-align:right;white-space:nowrap">' + acts + '</td></tr>';
          }).join('') + '</table></div>' +
          '<div class="cro-card" style="margin-top:16px"><h2>Add a person</h2><div class="cro-grid cro-g3">' +
            '<div class="cro-f"><label>TotalAgility user</label><select class="cro-in" id="croTta"><option value="">– choose, or type below –</option>' +
              tta.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name + ' · ' + t.email) + '</option>'; }).join('') + '</select></div>' +
            '<div class="cro-f"><label>Full name</label><input class="cro-in" id="croUName"></div>' +
            '<div class="cro-f"><label>Email</label><input class="cro-in" id="croUMail"></div>' +
            '<div class="cro-f"><label>Circularo role</label><select class="cro-in" id="croURole">' + (d.roles || ['sign']).map(function (k) { return '<option value="' + k + '">' + esc(ROLE_LABEL[k] || k) + '</option>'; }).join('') + '</select></div>' +
          '</div><div class="cro-note">Invite creates the Circularo account and Circularo emails the person to set a password. If an account with this email already exists it is linked instead. "Record only" keeps the person in CRO without touching Circularo.</div>' +
          '<div class="cro-actions"><button class="cro-btn2" data-save="record">Record only</button><button class="cro-btn" data-save="invite">Save and invite</button></div></div>' +
          (org.organization ? '<div class="cro-foot" style="text-align:left;padding:12px 0">Circularo organization <span class="cro-mono">' + esc(org.organization) + '</span></div>' : '');
        main().querySelectorAll('[data-arinv]').forEach(function (b) {
          b.onclick = function () {
            var q = AR[+b.getAttribute('data-arinv')];
            busy(b, cro('user_save', { email: q.email, fullName: q.full_name, role: 'sign', ttaResourceId: q.resource_id, action: 'invite' }).then(function (res) { return cro('access_request_handle', { id: q.access_request_id, action: 'invite' }).then(function () { return res; }); }))
              .then(function (res) { if (res) toast(res.linked ? 'Linked to the existing Circularo account.' : 'Invitation sent by Circularo.'); });
          };
        });
        main().querySelectorAll('[data-ardec]').forEach(function (b) {
          b.onclick = function () { var q = AR[+b.getAttribute('data-ardec')]; busy(b, cro('access_request_handle', { id: q.access_request_id, action: 'decline' })).then(function () { toast('Request declined.'); }); };
        });
        document.getElementById('croReload').onclick = function () { main().innerHTML = '<div class="cro-skel">Loading…</div>'; load().catch(fail); };
        var sel = document.getElementById('croTta');
        sel.onchange = function () { var t = tta.filter(function (x) { return x.id === sel.value; })[0]; if (t) { document.getElementById('croUName').value = t.name; document.getElementById('croUMail').value = t.email; } };
        var busy = function (b, p) { b.disabled = true; return p.then(function (res) { return load().then(function () { return res; }); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); };
        main().querySelectorAll('[data-save]').forEach(function (b) {
          b.onclick = function () {
            var email = document.getElementById('croUMail').value.trim().toLowerCase(), name = document.getElementById('croUName').value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email address.', true);
            var t = tta.filter(function (x) { return x.id === sel.value; })[0] || tta.filter(function (x) { return x.email === email; })[0];
            busy(b, cro('user_save', { email: email, fullName: name || email, role: document.getElementById('croURole').value, ttaResourceId: t ? t.id : '', action: b.getAttribute('data-save') }))
              .then(function (res) { if (res) toast(res.linked ? 'Linked to the existing Circularo account.' : res.invited ? 'Invitation sent by Circularo.' : 'Saved.'); });
          };
        });
        main().querySelectorAll('[data-manage]').forEach(function (b) {
          b.onclick = function () {
            var c = rows[+b.getAttribute('data-manage')].cx, t = ttaBy('', c.mail);
            busy(b, cro('user_save', { email: c.mail, fullName: c.fullname, role: roleOf(c.groups) || 'sign', ttaResourceId: t ? t.id : '', action: 'link' }))
              .then(function (res) { if (res) toast('Now managed by CRO.'); });
          };
        });
        main().querySelectorAll('[data-invite]').forEach(function (b) {
          b.onclick = function () {
            var u = rows[+b.getAttribute('data-invite')].rec;
            busy(b, cro('user_save', { email: u.email, fullName: u.full_name, role: u.circularo_role, ttaResourceId: u.tta_resource_id || '', action: 'invite' }))
              .then(function (res) { if (res) toast(res.linked ? 'Linked to the existing Circularo account.' : 'Invitation sent by Circularo.'); });
          };
        });
        main().querySelectorAll('[data-st]').forEach(function (b) {
          b.onclick = function () {
            var u = rows[+b.getAttribute('data-st')].rec, to = b.getAttribute('data-to');
            if (to === 'suspended' && b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Click again to suspend'; return; }
            busy(b, cro('user_status', { userId: u.user_id, status: to })).then(function (res) { if (res) toast(to === 'active' ? 'Reactivated.' : 'Suspended in Circularo.'); });
          };
        });
      });
    };
    load().catch(function (e) { fail(/administrator/i.test(e.message) ? 'Only CRO administrators can manage users.' : e); });
  };

  /* ---------- pages still to come ---------- */
  var renderSoon = function (title) {
    main().innerHTML = '<div class="cro-h1"><h1>' + esc(title) + '</h1></div><div class="cro-card cro-empty">This page is being built. Use the Dashboard for now.</div>';
  };

  /* ---------- start ---------- */
  shell();
  tokP = null;
  cro('whoami', {}).then(function (u) { var el = document.getElementById('croMe'); if (el) el.textContent = u.name || ''; }).catch(function () { });
  var renderGate = function (a) {
    main().innerHTML = '<div class="cro-card cro-done"><div class="big" style="background:#FEF0C7;color:#B54708">!</div><h1>A Circularo account is needed</h1>' +
      '<p>' + esc(a.reason || 'Your user has no Circularo account.') + '</p><p class="cro-sub">CRO e-Signing uses your own Circularo account to sign and send documents.</p>' +
      (a.pendingRequest ? '<p><b>Your request was sent to the administrators ' + esc(ago(a.pendingRequest)) + '.</b> You will get an email from Circularo when your account is ready.</p>'
        : '<div class="cro-f" style="max-width:460px;margin:12px auto;text-align:left"><label>Note to the administrators (optional)</label><textarea class="cro-in" id="croNote" rows="2" maxlength="900"></textarea></div>' +
          '<div class="cro-actions" style="justify-content:center"><button class="cro-btn" id="croAsk">Ask an administrator for an account</button></div>') + '</div>';
    var b = document.getElementById('croAsk');
    if (b) b.onclick = function () {
      b.disabled = true;
      cro('access_request', { note: document.getElementById('croNote').value.trim() }).then(function (r) { a.pendingRequest = r.requested || new Date().toISOString(); toast('Request sent' + (r.adminsEmailed ? ' and the administrators emailed.' : '.')); renderGate(a); })
        .catch(function (e) { b.disabled = false; toast(e.message, true); });
    };
  };
  var ACCESS_KEY = 'croAccessOk';
  var gate = (function () { try { var c = JSON.parse(sessionStorage.getItem(ACCESS_KEY) || 'null'); if (c && Date.now() - c.t < 600000) return Promise.resolve(c.a); } catch (e) { } return cro('access_check', {}); })();
  gate.then(function (a) {
    try { var back = sessionStorage.getItem('croReturn'); if (back) { sessionStorage.removeItem('croReturn'); if (back !== location.pathname + location.search) { location.href = back; return; } } } catch (e) { }
    if (!a.allowed) return renderGate(a);
    try { sessionStorage.setItem(ACCESS_KEY, JSON.stringify({ t: Date.now(), a: a })); } catch (e) { }
    if (a.autoCreated) toast('A Circularo account was created for you: check your email to set your password.');
    else if (a.status === 'invited' && page === 'send') toast('Your Circularo invitation is still open: accept it from the Circularo email to sign.');
    if (a.status === 'none' && a.admin) toast('You have no Circularo account (allowed because you are a CRO administrator).');
    go();
  }).catch(function (e) { if (/Unknown operation/i.test(e.message)) go(); else fail(e); });
  var go = function () { ({
    dashboard: renderDashboard,
    send: renderSend,
    requests: renderRequests,
    request: renderRequest,
    users: renderUsers
  }[page] || renderDashboard)(); };
})();
