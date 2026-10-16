/* CRO_Login: sign-in page for CRO e-Signing (form-level JavaScript of the CRO_Login log-on form).
   Design: Tungsten TotalAgility meets Circularo. Tungsten's navy and 135° split meet Circularo's indigo along a seam;
   a document on the seam is signed once (Tungsten's coral-to-amber stroke) and sealed (Circularo violet).
   Type: League Spartan (Circularo's Spartan) for the headline, Red Hat Display (Tungsten) for everything else.
   The TotalAgility logon controls (username, password, button -> LogOnWithPassword2 -> redirect to CRO_Dashboard)
   are kept and restyled. ?return=/TotalAgility/Forms/CRO_xxx.form is kept for CRO_UI_JS to follow after sign-in.
   Built from Default/tta/forms/CRO_Login.src.js (logos are injected at build time). */
(function () {
  var BASE = location.pathname.split(/\/forms\//i)[0];
  var C = {
    navy: '#002854', indigo: '#0F0069', violet: '#7000FF', sky: '#22AFFF', coral: '#FF6D69', amber: '#FFC600',
    paper: '#F6F7FB', ink: '#1B1B2F', mute: '#5B6472', line: '#DADFEA'
  };
  var T = {
    title: 'CRO e-Signing',
    headline: 'Signed in Circularo. Filed in TotalAgility.',
    sub: 'Send documents for signature from your TotalAgility work, follow every signer, and get the signed copy, audit trail and certificate back automatically.',
    steps: ['Prepared in TotalAgility', 'Signed in Circularo', 'Filed back in TotalAgility'],
    signIn: 'Sign in', signInSub: 'Use your TotalAgility account.',
    foot: 'Tungsten TotalAgility and Circularo integration'
  };
  var LOGO_TA = BASE + '/designer/assets/images/Tungsten-TotalAgility-Registered.svg';
  var LOGO_CIRCULARO = '__CIRCULARO_SVG__';
  var LOGO_SUDOCODE = '__SUDOCODE_PNG__';

  // where the user was going (CRO pages only)
  try {
    var ret = (/[?&]return=([^&]*)/.exec(location.search) || [])[1]; ret = ret ? decodeURIComponent(ret) : '';
    if (/^\/TotalAgility\/Forms\/(?:[^\/]+\/)?CRO_[A-Za-z]+\.form(\?[^<>"']*)?$/i.test(ret)) sessionStorage.setItem('croReturn', ret);
  } catch (e) { }

  if (!document.getElementById('croFonts')) {
    var lk = document.createElement('link'); lk.id = 'croFonts'; lk.rel = 'stylesheet';
    lk.href = 'https://fonts.googleapis.com/css2?family=League+Spartan:wght@600;700;800&family=Red+Hat+Display:wght@400;500;700&display=swap';
    document.head.appendChild(lk);
  }
  var RH = '"Red Hat Display","Segoe UI",system-ui,Arial,sans-serif', SP = '"League Spartan","Red Hat Display",system-ui,Arial,sans-serif';
  var SPLIT = 'min(56vw, 860px)';
  var css = [
    'html,body{background:#fff !important}',
    // art panel: Tungsten navy and Circularo indigo meeting on a 135-degree seam
    '#croArt{position:fixed;left:0;top:0;bottom:0;width:' + SPLIT + ';z-index:5;overflow:hidden;color:#fff;font-family:' + RH + ';' +
      'background:linear-gradient(135deg,' + C.navy + ' 0%,' + C.navy + ' 52%,' + C.indigo + ' 52%,' + C.indigo + ' 100%)}',
    '#croArt:before{content:"";position:absolute;left:-10%;right:-10%;top:51.2%;height:2px;transform:rotate(-45deg) scaleX(2);transform-origin:center;' +
      'background:linear-gradient(90deg,transparent,' + C.sky + ' 30%,' + C.sky + ' 70%,transparent);opacity:.55}',
    '#croArt .in{position:relative;height:100%;box-sizing:border-box;padding:56px clamp(32px,5vw,72px) 32px;display:flex;flex-direction:column}',
    '#croArt .name{font:700 15px ' + RH + ';letter-spacing:.2px;opacity:.85}',
    '#croArt h1{font:800 clamp(34px,3.6vw,54px)/1.04 ' + SP + ';letter-spacing:-.5px;margin:22px 0 18px;max-width:14ch}',
    '#croArt p.sub{font:400 17px/1.55 ' + RH + ';color:rgba(255,255,255,.82);max-width:44ch;margin:0}',
    '#croArt .stage{flex:1;position:relative;min-height:220px}',
    // the document on the seam
    '#croDoc{position:absolute;left:50%;top:50%;width:min(300px,62%);aspect-ratio:3/3.6;transform:translate(-46%,-48%) rotate(-4deg);background:#fff;border-radius:6px;' +
      'box-shadow:0 30px 60px rgba(0,10,40,.45),0 2px 0 rgba(255,255,255,.4) inset;padding:26px 24px;box-sizing:border-box}',
    '#croDoc i{display:block;height:7px;border-radius:4px;background:#E7EAF2;margin:0 0 10px}',
    '#croDoc .t{height:11px;width:58%;background:' + C.navy + ';opacity:.85;margin-bottom:18px}',
    '#croDoc .sig{position:absolute;left:24px;right:24px;bottom:34px;height:64px;border-bottom:2px solid ' + C.ink + '}',
    '#croDoc .sig small{position:absolute;left:0;bottom:-20px;font:500 11px ' + RH + ';color:' + C.mute + '}',
    '#croDoc svg.pen{position:absolute;left:-6px;bottom:-4px;width:calc(100% + 12px);height:84px;overflow:visible}',
    '#croDoc svg.pen path{fill:none;stroke:url(#croInk);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:900;stroke-dashoffset:900;animation:croDraw 1.7s .5s cubic-bezier(.6,.1,.3,1) forwards}',
    '#croSeal{position:absolute;right:-18px;top:-18px;width:62px;height:62px;border-radius:50%;background:' + C.violet + ';color:#fff;display:grid;place-items:center;' +
      'box-shadow:0 10px 24px rgba(112,0,255,.45);transform:scale(0);animation:croSeal .35s 2.2s cubic-bezier(.3,1.6,.5,1) forwards}',
    '#croSeal svg{width:30px;height:30px}',
    '@keyframes croDraw{to{stroke-dashoffset:0}}@keyframes croSeal{to{transform:scale(1)}}',
    '@media (prefers-reduced-motion:reduce){#croDoc svg.pen path{animation:none;stroke-dashoffset:0}#croSeal{animation:none;transform:none}}',
    // the three-step journey (a real sequence)
    '#croArt ol{list-style:none;margin:0;padding:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font:500 14px ' + RH + '}',
    '#croArt ol li{display:flex;align-items:center;gap:10px;color:rgba(255,255,255,.9)}',
    '#croArt ol li b{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font:700 12px ' + RH + ';color:' + C.navy + ';background:#fff}',
    '#croArt ol li.c b{background:' + C.violet + ';color:#fff}',
    '#croArt ol li + li:before{content:"";width:28px;height:2px;background:linear-gradient(90deg,' + C.coral + ',' + C.amber + ');margin-right:2px}',
    // right side: logos, title, native controls
    '#croSide{position:fixed;left:' + SPLIT + ';right:0;top:0;z-index:4;padding:36px 40px 0;box-sizing:border-box;display:flex;align-items:center;gap:14px;font:500 13px ' + RH + ';color:' + C.mute + '}',
    '#croSide img{display:block;height:30px;width:auto}#croSide img.c{height:24px}#croSide span{font:400 18px ' + RH + ';color:#A3ABBA}',
    '#croHead{position:fixed;z-index:6;font-family:' + RH + '}',
    '#croHead h2{font:800 34px/1.1 ' + SP + ';color:' + C.indigo + ';margin:0 0 6px;letter-spacing:-.3px}',
    '#croHead p{margin:0;font:400 15px ' + RH + ';color:' + C.mute + '}',
    '#croFoot{position:fixed;left:' + SPLIT + ';right:0;bottom:0;z-index:6;padding:16px 40px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:400 12.5px ' + RH + ';color:' + C.mute + ';background:#fff}',
    '#croFoot img{height:26px;width:auto;display:block}#croFoot a{display:flex;align-items:center;gap:8px;color:' + C.mute + ';text-decoration:none}',
    '#wrapper .x-panel,#wrapper .x-panel-body,#wrapper .x-panel-bodyWrap,#wrapper .x-autocontainer-outerCt{background:transparent !important;border-color:transparent !important}',
    'html body #wrapper .kta-textbox .x-form-text-wrap{box-sizing:border-box !important;border:1.5px solid #C7CCD8 !important;border-radius:8px !important;background:#fff !important;transition:border-color .15s,box-shadow .15s}',
    'html body #wrapper .kta-textbox .x-form-trigger-wrap{border:0 !important;background:transparent !important}',
    'html body #wrapper .kta-textbox input.x-form-field{height:46px !important;border:0 !important;border-radius:8px !important;background:transparent !important;font:16px ' + RH + ' !important;padding:0 14px !important;color:' + C.ink + ' !important}',
    'html body #wrapper .kta-textbox input.x-form-field:focus{outline:0}',
    'html body #wrapper .kta-textbox .x-form-text-wrap:focus-within{border-color:' + C.indigo + ' !important;box-shadow:0 0 0 4px rgba(255,198,0,.45) !important}',
    'html body #wrapper a.x-btn.kta-button{background:' + C.indigo + ' !important;border:0 !important;border-radius:8px !important;height:48px !important;box-shadow:0 8px 20px rgba(15,0,105,.25) !important;transition:background .15s}',
    'html body #wrapper a.x-btn.kta-button:hover{background:' + C.violet + ' !important}',
    'html body #wrapper a.x-btn.kta-button:focus-visible{outline:3px solid ' + C.amber + ' !important;outline-offset:2px}',
    'html body #wrapper a.x-btn.kta-button .x-btn-inner{color:#fff !important;font:700 16px ' + RH + ' !important}',
    'html body #wrapper a.x-btn.kta-button .x-btn-icon-el{display:none !important}',
    '@media (max-width:860px){#croArt{display:none}#croSide,#croFoot{left:0}}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.body.classList.add('cro-login');
  document.title = T.title + ' | Sign in';
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

  // signature path: a loose hand-written flourish
  var pen = '<svg class="pen" viewBox="0 0 300 84" preserveAspectRatio="none"><defs><linearGradient id="croInk" x1="0" x2="1"><stop offset="0" stop-color="' + C.coral + '"/><stop offset="1" stop-color="' + C.amber + '"/></linearGradient></defs>' +
    '<path d="M8 58 C 22 20, 34 18, 30 52 S 46 70, 58 40 C 64 26, 70 30, 68 50 C 66 66, 80 62, 88 44 C 94 30, 102 34, 100 52 C 99 62, 110 60, 118 46 L 126 34 C 128 50, 132 60, 146 50 C 164 36, 176 48, 168 58 C 160 66, 190 52, 210 40 C 228 30, 236 44, 226 54 C 220 60, 250 50, 292 30"/></svg>';
  var art = document.createElement('div'); art.id = 'croArt';
  art.innerHTML = '<div class="in"><div class="name">' + esc(T.title) + '</div><h1>' + esc(T.headline) + '</h1><p class="sub">' + esc(T.sub) + '</p>' +
    '<div class="stage"><div id="croDoc"><i class="t"></i><i style="width:92%"></i><i style="width:84%"></i><i style="width:88%"></i><i style="width:64%"></i><i style="width:78%"></i>' +
    '<div class="sig">' + pen + '<small>Signature</small></div>' +
    '<div id="croSeal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div></div></div>' +
    '<ol aria-label="How it works">' + T.steps.map(function (s, i) { return '<li' + (i === 1 ? ' class="c"' : '') + '><b>' + (i + 1) + '</b>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
  document.body.appendChild(art);
  var side = document.createElement('div'); side.id = 'croSide';
  side.innerHTML = '<img src="' + LOGO_TA + '" alt="Tungsten TotalAgility"><span aria-hidden="true">+</span><img class="c" src="' + LOGO_CIRCULARO + '" alt="Circularo">';
  document.body.appendChild(side);
  var head = document.createElement('div'); head.id = 'croHead'; head.innerHTML = '<h2>' + esc(T.signIn) + '</h2><p>' + esc(T.signInSub) + '</p>'; document.body.appendChild(head);
  var foot = document.createElement('div'); foot.id = 'croFoot';
  foot.innerHTML = '<span>' + esc(T.foot) + '</span><a href="https://www.sudocodesolutions.com" target="_blank" rel="noopener"><span>Built by</span><img src="' + LOGO_SUDOCODE + '" alt="Sudocode Solutions"></a>';
  document.body.appendChild(foot);

  // Layout: pin TotalAgility's form wrapper to the right-hand side and let Ext re-measure, so the native
  // logon controls reflow in place; hide TotalAgility's own title and put ours above the fields.
  var layout = function () {
    var w = document.getElementById('wrapper'), mc = window.Ext && Ext.getCmp('_mainContainer');
    var user = document.querySelector('input[type=text].x-form-field, input:not([type]).x-form-field');
    var pass = document.querySelector('input[type=password]'), btn = document.querySelector('a.kta-button');
    if (!w || !mc || !user || !pass || !btn) return false;
    var left = window.innerWidth > 860 ? Math.min(window.innerWidth * 0.56, 860) : 0;
    w.style.cssText = 'position:fixed;left:' + left + 'px;right:0;top:96px;bottom:60px;overflow:auto;z-index:2;background:transparent';
    mc.setSize(w.clientWidth, w.clientHeight); mc.updateLayout();
    user.placeholder = 'Username'; pass.placeholder = 'Password';
    user.setAttribute('autocomplete', 'username'); pass.setAttribute('autocomplete', 'current-password');
    [].slice.call(document.querySelectorAll('#wrapper img')).forEach(function (i) { i.style.display = 'none'; });
    [].slice.call(document.querySelectorAll('#wrapper .x-component, #wrapper label, #wrapper span, #wrapper div')).forEach(function (e) {
      if (!e.children.length && /^\s*Sign in\s*$/i.test(e.textContent || '') && !e.closest('a')) e.style.visibility = 'hidden';
    });
    var cell = user.closest('.kta-cell'), fw = Math.max(240, Math.min(380, Math.floor(cell ? cell.getBoundingClientRect().width : 380) - 6));
    [user.closest('.x-field'), pass.closest('.x-field'), btn].forEach(function (x) { var c = x && Ext.getCmp(x.id); if (c && c.getWidth() !== fw) c.setWidth(fw); });
    btn.style.transform = ''; btn.style.transform = 'translateX(' + Math.round(user.getBoundingClientRect().left - btn.getBoundingClientRect().left) + 'px)';
    var u = user.closest('.x-field').getBoundingClientRect();
    head.style.left = u.left + 'px'; head.style.width = fw + 'px'; head.style.top = Math.max(110, u.top - head.offsetHeight - 26) + 'px';
    return true;
  };
  var tries = 0;
  (function wait() { if (!layout() && tries++ < 60) setTimeout(wait, 150); else setTimeout(layout, 500); })();
  var onResize = function () { setTimeout(layout, 60); };
  window.addEventListener('resize', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(layout, 50); });
  var onKey = function (e) { if (e.key === 'Enter' && e.target && e.target.type === 'password') { var b = document.querySelector('a.kta-button'); if (b) b.click(); } };
  document.addEventListener('keydown', onKey);

  // TotalAgility can swap the next form into this page after sign-in: remove everything this script added.
  var seen = false;
  var watch = setInterval(function () {
    if (document.querySelector('input[type=password]')) { seen = true; return; }
    if (!seen) return;
    clearInterval(watch);
    [st, art, side, head, foot].forEach(function (e) { if (e && e.parentNode) e.parentNode.removeChild(e); });
    window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey);
    document.body.classList.remove('cro-login');
    var w = document.getElementById('wrapper'); if (w) w.style.cssText = '';
    try { var mc = window.Ext && Ext.getCmp('_mainContainer'); if (mc) { mc.setSize(window.innerWidth, window.innerHeight); mc.updateLayout(); } } catch (e) { }
  }, 200);
})();
