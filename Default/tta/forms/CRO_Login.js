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
    title: 'My e-Signing',
    headline: ['Signed in Circularo.', 'Filed in TotalAgility.'],
    sub: 'Send documents for signature from your TotalAgility work, follow every signer, and get the signed copy, audit trail and certificate back automatically.',
    steps: ['Prepared in TotalAgility', 'Signed in Circularo', 'Filed back in TotalAgility'],
    signIn: 'Sign in', signInSub: 'Use your TotalAgility account.',
    foot: 'Tungsten TotalAgility and Circularo integration'
  };
  var LOGO_TA = BASE + '/designer/assets/images/Tungsten-TotalAgility-Registered.svg';
  var LOGO_CIRCULARO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTEiIGhlaWdodD0iMzQiIHZpZXdCb3g9IjAgMCAxNTEgMzQiIGZpbGw9Im5vbmUiPiA8cGF0aCBkPSJNMTM1LjI2IDE3LjE2NzlDMTM1LjI2IDEyLjcxNDkgMTM4LjcxOCA5Ljg4NjU3IDE0Mi43MTcgOS44ODY1N0MxNDYuNzE3IDkuODg2NTcgMTUwLjIwNSAxMi43MTQ5IDE1MC4yMDUgMTcuMTY3OUMxNTAuMjA1IDIxLjYyMDggMTQ2LjcxNyAyNC41MzkxIDE0Mi43MTcgMjQuNTM5MUMxMzguNzE4IDI0LjUzOTEgMTM1LjI2IDIxLjYyMDggMTM1LjI2IDE3LjE2NzlaTTE0Ni42ODYgMTcuMTY3OUMxNDYuNjg2IDE0Ljc2MTMgMTQ0Ljg4MiAxMy4xMzYyIDE0Mi43MTcgMTMuMTM2MkMxNDAuNTUyIDEzLjEzNjIgMTM4Ljc3OCAxNC43NjEzIDEzOC43NzggMTcuMTY3OUMxMzguNzc4IDE5LjYzNSAxNDAuNTUyIDIxLjI4OTkgMTQyLjcxNyAyMS4yODk5QzE0NC44ODIgMjEuMjg5OSAxNDYuNjg2IDE5LjYzNSAxNDYuNjg2IDE3LjE2NzlaIiBmaWxsPSIjMWQwMDkwIi8+IDxwYXRoIGQ9Ik0xMzQuMDIyIDkuODg3MDJDMTMyLjI3OSA5Ljg4NzAyIDEzMC45ODEgMTAuMTg3IDEyOS45OTcgMTIuMjU5NVYxMC4xODdIMTI2LjUwNVYyNC4yMzYzSDEzMC4wMjVWMTguMzk4MkMxMzAuMDI1IDE1LjA2MzkgMTMxLjI4NSAxMy4xNjQ5IDEzMy41NzMgMTMuMTY0OUMxMzMuOTg1IDEzLjE2NDkgMTM0LjUyOCAxMy4yMjEzIDEzNS4xNTIgMTMuNDY0OVY5Ljk5MDIxQzEzNC43OTEgOS45MjQyNSAxMzQuNDAyIDkuODg3MDIgMTM0LjAyMiA5Ljg4NzAyWiIgZmlsbD0iIzFkMDA5MCIvPiA8cGF0aCBkPSJNMTI0LjAzOSAxMC4xODc2VjI0LjIzODVIMTIwLjU1MVYyMi4zNDMyQzExOS41ODggMjMuODQ3NSAxMTcuNjA0IDI0LjUzOTEgMTE1Ljg5IDI0LjUzOTFDMTEyLjE5MSAyNC41MzkxIDEwOC45NzQgMjEuNjgwOSAxMDguOTc0IDE3LjE5NzZDMTA4Ljk3NCAxMi42ODQ2IDExMi4xNjEgOS44ODcwOCAxMTUuODYgOS44ODcwOEMxMTcuNjM0IDkuODg3MDggMTE5LjU4OCAxMC41Nzg2IDEyMC41NTEgMTIuMDUyNlYxMC4xODc2SDEyNC4wMzlaTTEyMC40OTEgMTcuMTY3OUMxMjAuNDkxIDE0LjcwMDcgMTE4LjQ0NSAxMy4xMzYyIDExNi40MzEgMTMuMTM2MkMxMTQuMjY2IDEzLjEzNjIgMTEyLjQ5MiAxNC44MjA5IDExMi40OTIgMTcuMTY3OUMxMTIuNDkyIDE5LjUxNDggMTE0LjI2NiAyMS4yNTk2IDExNi40MzEgMjEuMjU5NkMxMTguNTY2IDIxLjI1OTYgMTIwLjQ5MSAxOS42MzUgMTIwLjQ5MSAxNy4xNjc5WiIgZmlsbD0iIzFkMDA5MCIvPiA8cGF0aCBkPSJNMTAzLjI0NCAzLjkyODY5SDEwNi43MzJWMjQuMjM2M0gxMDMuMjQ0VjMuOTI4NjlaIiBmaWxsPSIjMWQwMDkwIi8+IDxwYXRoIGQ9Ik0xMDAuNjM3IDEwLjE4ODZWMjQuMjM5NEg5Ny4xNDkyVjIyLjA0M0M5Ni40Mjc4IDIzLjc4NzggOTQuMjAyMyAyNC41NzAzIDkyLjc4OTIgMjQuNTcwM0M4OS4xODA0IDI0LjU3MDMgODcuMTY2IDIyLjE2MzIgODcuMTY2IDE4LjA3MTVWMTAuMTg4Nkg5MC42NTQxVjE3Ljc0MDFDOTAuNjU0MSAxOS45OTcyIDkyLjAwNzIgMjEuMTQwMyA5My41NzA3IDIxLjE0MDNDOTUuMTY0NiAyMS4xNDAzIDk3LjE0OTIgMjAuMjY3OSA5Ny4xNDkyIDE3LjUzVjEwLjE4ODZIMTAwLjYzN1oiIGZpbGw9IiMxZDAwOTAiLz4gPHBhdGggZD0iTTc5LjkxMTcgMjEuMjYwMUM3Ny40NzQ3IDIxLjI2MDEgNzUuNzMxNCAxOS41NDM1IDc1LjczMTQgMTcuMTk5MkM3NS43MzE0IDE0LjgyMTQgNzcuNDc0NyAxMy4xMzgzIDc5LjkxMTcgMTMuMTM4M0M4MS4wMjIzIDEzLjEzODMgODIuMTE0MyAxMy41NzkzIDgyLjg0NTMgMTQuMzA1OUw4NS4zNTczIDEyLjM0MDlDODQuMDYzOSAxMC44MzEyIDgyLjE2MTEgOS44ODg2MyA3OS44NTA2IDkuODg4NjNDNzUuNzkyIDkuODg4NjMgNzIuMjExOSAxMi43NDQ3IDcyLjIxMTkgMTcuMTk5MkM3Mi4yMTE5IDIxLjY1MzcgNzUuNzkyIDI0LjUwOTggNzkuODUwNiAyNC41MDk4QzgyLjE2MTEgMjQuNTA5OCA4NC4wNjM5IDIzLjUzNDIgODUuMzU3MyAyMi4wNTIyTDgyLjg0NTMgMjAuMDkyNUM4Mi4xMTQzIDIwLjgxOTEgODEuMDIyMyAyMS4yNjAxIDc5LjkxMTcgMjEuMjYwMVoiIGZpbGw9IiMxZDAwOTAiLz4gPHBhdGggZD0iTTcwLjI5MTggOS44ODcwMkM2OC41NDg2IDkuODg3MDIgNjcuMjUwMyAxMC4xODcgNjYuMjY2MiAxMi4yNTk1VjEwLjE4N0g2Mi43NzQ0VjI0LjIzNjNINjYuMjk0NFYxOC4zOTgyQzY2LjI5NDQgMTUuMDYzOSA2Ny41NTQ5IDEzLjE2NDkgNjkuODQyMSAxMy4xNjQ5QzcwLjI1NDEgMTMuMTY0OSA3MC43OTggMTMuMjIxMyA3MS40MjE2IDEzLjQ2NDlWOS45OTAyMUM3MS4wNjA2IDkuOTI0MjUgNzAuNjcxNCA5Ljg4NzAyIDcwLjI5MTggOS44ODcwMloiIGZpbGw9IiMxZDAwOTAiLz4gPHBhdGggZD0iTTU2LjQyOTcgMTAuMTg1NEg1OS45MTc4VjI0LjIzNjNINTYuNDI5N1YxMC4xODU0WiIgZmlsbD0iIzFkMDA5MCIvPiA8cGF0aCBkPSJNNjAuNDMxNCA2LjE3NTEyQzYwLjQzMTQgNy40MjE0NyA1OS40MjE4IDguNDMxNjQgNTguMTc2MSA4LjQzMTY0QzU2LjkzMDUgOC40MzE2NCA1NS45MjA5IDcuNDIxNDcgNTUuOTIwOSA2LjE3NTEyQzU1LjkyMDkgNC45Mjg3NiA1Ni45MzA1IDMuOTE4NTkgNTguMTc2MSAzLjkxODU5QzU5LjQyMTggMy45MTg1OSA2MC40MzE0IDQuOTI4NzYgNjAuNDMxNCA2LjE3NTEyWiIgZmlsbD0iIzFkMDA5MCIvPiA8cGF0aCBkPSJNNDkuMTE3OCAyMS4yNjAxQzQ2LjY4MDcgMjEuMjYwMSA0NC45Mzc0IDE5LjU0MzUgNDQuOTM3NCAxNy4xOTkyQzQ0LjkzNzQgMTQuODIxNCA0Ni42ODA3IDEzLjEzODMgNDkuMTE3OCAxMy4xMzgzQzUwLjIyODQgMTMuMTM4MyA1MS4zMjA0IDEzLjU3OTMgNTIuMDUxOSAxNC4zMDU5TDU0LjU2MzQgMTIuMzQwOUM1My4yNjk5IDEwLjgzMTMgNTEuMzY3MSA5Ljg4ODY0IDQ5LjA1NjYgOS44ODg2NEM0NC45OTg2IDkuODg4NjQgNDEuNDE4IDEyLjc0NDcgNDEuNDE4IDE3LjE5OTJDNDEuNDE4IDIxLjY1MzcgNDQuOTk4NiAyNC41MDk4IDQ5LjA1NjYgMjQuNTA5OEM1MS4zNjcxIDI0LjUwOTggNTMuMjY5OSAyMy41MzQyIDU0LjU2MzQgMjIuMDUyMkw1Mi4wNTE5IDIwLjA5MjVDNTEuMzIwNCAyMC44MTkxIDUwLjIyODQgMjEuMjYwMSA0OS4xMTc4IDIxLjI2MDFaIiBmaWxsPSIjMWQwMDkwIi8+IDxwYXRoIGQ9Ik0xNi45ODg3IDBDNy42MDQ2NCAwIDAgNy42MTIxOCAwIDE2Ljk5ODRDMCAyNi4zODc4IDcuNjA0NjQgMzQgMTYuOTg4NyAzNEMyNi4zNzI3IDM0IDMzLjk4MDYgMjYuMzg3OCAzMy45ODA2IDE2Ljk5ODRDMzMuOTgwNiA3LjYxMjE4IDI2LjM3MjcgMCAxNi45ODg3IDBaTTE2Ljk3NTkgMTEuNTg3NEwxNC4yNjkzIDE0LjI5OTNMMTEuNTYyMiAxNy4wMDc0TDE0LjI2OTMgMTkuNzE2N0wxNi45NzU5IDIyLjQyOEwxOS42ODYyIDE5LjcxNjdDMjEuMTgzOSAxOC4yMTgyIDIzLjYwODcgMTguMjE4MiAyNS4xMDMyIDE5LjcxNjdDMjYuNjAwOCAyMS4yMTQ2IDI2LjYwMDggMjMuNjQxNCAyNS4xMDMyIDI1LjEzOTNDMjMuNjA4NyAyNi42MzUyIDIxLjE4MzkgMjYuNjM1MiAxOS42ODYyIDI1LjEzOTNMMTYuOTc1OSAyMi40MjhMMTQuMjY5MyAyNS4xMzkzQzEyLjc3MTcgMjYuNjM1MiAxMC4zNDYzIDI2LjYzNTIgOC44NDg2OCAyNS4xMzkzQzcuMzUxNTcgMjMuNjQxNCA3LjM1MTU3IDIxLjIxNDYgOC44NDg2OCAxOS43MTY3TDExLjU1NTggMTcuMDA3NEw4Ljg0ODY4IDE0LjI5OTNDNy4zNTE1NyAxMi44MDA4IDcuMzUxNTcgMTAuMzc0NiA4Ljg0ODY4IDguODc2MDlDMTAuMzQ2MyA3LjM4MDc4IDEyLjc3MTcgNy4zODA3OCAxNC4yNjkzIDguODc2MDlMMTYuOTc1OSAxMS41ODc0TDE5LjY4NjIgOC44NzYwOUMyMS4xODM5IDcuMzgwNzggMjMuNjA4NyA3LjM4MDc4IDI1LjEwMzIgOC44NzYwOUMyNi42MDA4IDEwLjM3NDYgMjYuNjAwOCAxMi44MDA4IDI1LjEwMzIgMTQuMjk5M0MyMy42MDg3IDE1Ljc5NDYgMjEuMTgzOSAxNS43OTQ2IDE5LjY4NjIgMTQuMjk5M0wxNi45NzU5IDExLjU4NzRaTTE4LjYzODQgMTYuOTk4NEMxOC42Mzg0IDE3LjkxMDcgMTcuOTAwNSAxOC42NDg1IDE2Ljk4ODcgMTguNjQ4NUMxNi4wNzY5IDE4LjY0ODUgMTUuMzM5IDE3LjkxMDcgMTUuMzM5IDE2Ljk5ODRDMTUuMzM5IDE2LjA4OTMgMTYuMDc2OSAxNS4zNTEgMTYuOTg4NyAxNS4zNTFDMTcuOTAwNSAxNS4zNTEgMTguNjM4NCAxNi4wODkzIDE4LjYzODQgMTYuOTk4NFoiIGZpbGw9IiMxZDAwOTAiLz4gPC9zdmc+';
  var LOGO_SUDOCODE = 'data:image/png;base64,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';

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
    'body.cro-login:not(.cro-ready) #wrapper{opacity:0}',
    '#wrapper{transition:opacity .2s}',
    // art panel: Tungsten navy and Circularo indigo meeting on a 135-degree seam
    '#croArt{position:fixed;left:0;top:0;bottom:0;width:' + SPLIT + ';z-index:5;overflow:hidden;color:#fff;font-family:' + RH + ';' +
      'background:linear-gradient(135deg,' + C.navy + ' 0%,' + C.navy + ' 52%,' + C.indigo + ' 52%,' + C.indigo + ' 100%)}',
    '#croArt:before{content:"";position:absolute;left:-10%;right:-10%;top:51.2%;height:2px;transform:rotate(-45deg) scaleX(2);transform-origin:center;' +
      'background:linear-gradient(90deg,transparent,' + C.sky + ' 30%,' + C.sky + ' 70%,transparent);opacity:.55}',
    '#croArt .in{position:relative;height:100%;box-sizing:border-box;padding:56px clamp(32px,5vw,72px) 32px;display:flex;flex-direction:column}',
    '#croArt .name{font:700 15px ' + RH + ';letter-spacing:.2px;opacity:.85}',
    '#croArt h1{font:800 clamp(30px,3.4vw,54px)/1.06 ' + SP + ';letter-spacing:-.5px;margin:22px 0 18px}',
    '#croArt h1 span{display:block;white-space:nowrap}',
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
    '#croArt ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;font:500 14px ' + RH + '}',
    '#croArt ol li{display:flex;align-items:center;gap:12px;color:rgba(255,255,255,.9);position:relative}',
    '#croArt ol li b{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font:700 12px ' + RH + ';color:' + C.navy + ';background:#fff}',
    '#croArt ol li.c b{background:' + C.violet + ';color:#fff}',
    '#croArt ol li + li:before{content:"";position:absolute;left:11px;top:-14px;width:2px;height:14px;background:linear-gradient(180deg,' + C.coral + ',' + C.amber + ')}',
    // right side: logos, title, native controls
    '#croSide{position:fixed;left:' + SPLIT + ';right:0;top:0;z-index:4;padding:36px 40px 0;box-sizing:border-box;display:flex;align-items:center;gap:14px;font:500 13px ' + RH + ';color:' + C.mute + '}',
    '#croSide img{display:block;height:30px;width:auto}#croSide img.c{height:24px}#croSide span{font:400 18px ' + RH + ';color:#A3ABBA}',
    '#croHead{position:fixed;z-index:6;font-family:' + RH + '}',
    '#croHead h2{font:800 34px/1.1 ' + SP + ';color:' + C.indigo + ';margin:0 0 6px;letter-spacing:-.3px}',
    '#croHead p{margin:0;font:400 15px ' + RH + ';color:' + C.mute + '}',
    '#croFoot{position:fixed;left:' + SPLIT + ';right:0;bottom:0;z-index:6;padding:16px 40px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:400 12.5px ' + RH + ';color:' + C.mute + ';background:#fff}',
    '#croFoot img{height:26px;width:auto;display:block}#croFoot a{display:flex;align-items:center;gap:8px;white-space:nowrap;flex:none;color:' + C.mute + ';text-decoration:none}',
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
    '<path d="M14 60 C 10 30, 30 6, 44 14 C 58 22, 40 58, 26 66 C 18 70, 22 52, 40 46 C 52 42, 58 48, 60 56 C 62 44, 68 38, 74 44 C 78 50, 76 58, 84 54 C 92 48, 96 22, 104 18 C 110 16, 106 44, 104 60 C 112 46, 120 40, 126 48 C 130 54, 136 56, 142 48 C 148 40, 156 40, 156 50 C 156 58, 166 58, 176 48 C 186 38, 194 42, 192 52 C 190 60, 204 58, 214 50 M 30 76 C 90 70, 190 66, 290 54"/></svg>';
  var art = document.createElement('div'); art.id = 'croArt';
  art.innerHTML = '<div class="in"><div class="name">' + esc(T.title) + '</div><h1>' + T.headline.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</h1><p class="sub">' + esc(T.sub) + '</p>' +
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
  var topOffset = null;
  var layout = function () {
    var w = document.getElementById('wrapper'), mc = window.Ext && Ext.getCmp('_mainContainer');
    var user = document.querySelector('input[type=text].x-form-field, input:not([type]).x-form-field');
    var pass = document.querySelector('input[type=password]'), btn = document.querySelector('a.kta-button');
    if (!w || !mc || !user || !pass || !btn) return false;
    var left = window.innerWidth > 860 ? Math.min(window.innerWidth * 0.56, 860) : 0;
    var top = 96;
    if (topOffset != null) top = Math.max(96 + 110 - topOffset, Math.round(window.innerHeight * 0.44) - topOffset - 60);
    w.style.cssText = 'position:fixed;left:' + left + 'px;right:0;top:' + top + 'px;bottom:60px;overflow:auto;z-index:2;background:transparent';
    mc.setSize(w.clientWidth, w.clientHeight);
    // TotalAgility centres the controls in a 25/50/25 column row; make the middle column a comfortable width
    var cw = Math.min(0.9, Math.min(360, w.clientWidth - 48) / Math.max(1, w.clientWidth));
    [user, pass, btn].forEach(function (el) {
      var n = el.parentElement, c = null;
      while (n && n !== w) { c = n.id && Ext.getCmp(n.id); if (c && c.ownerCt && c.ownerCt.layout && c.ownerCt.layout.type === 'column' && c.ownerCt.items.length === 3) break; c = null; n = n.parentElement; }
      if (!c) return;
      var it = c.ownerCt.items.items, side = (1 - cw) / 2;
      if (Math.abs((it[1].columnWidth || 0) - cw) > 0.001) { it[0].columnWidth = side; it[1].columnWidth = cw; it[2].columnWidth = side; }
    });
    mc.updateLayout();
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
    if (topOffset == null) { topOffset = Math.round(u.top - w.getBoundingClientRect().top); return layout(); }
    document.body.classList.add('cro-ready');
    return true;
  };
  var tries = 0;
  (function wait() { if (!layout() && tries++ < 60) setTimeout(wait, 150); else { document.body.classList.add('cro-ready'); setTimeout(layout, 500); } })();
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
    document.body.classList.remove('cro-login', 'cro-ready');
    var w = document.getElementById('wrapper'); if (w) w.style.cssText = '';
    try { var mc = window.Ext && Ext.getCmp('_mainContainer'); if (mc) { mc.setSize(window.innerWidth, window.innerHeight); mc.updateLayout(); } } catch (e) { }
  }, 200);
})();
