/*!
 * fx/tilt.js — Module "tilt" cho trang "KHOA"
 * Hiệu ứng: nghiêng 3D theo chuột (kèm vệt sáng kính + viền neon chạy),
 *           nút nam châm, parallax theo con trỏ, phần tử bay lửng lơ.
 * Đăng ký: window.FX.tilt
 * Module KHÔNG tạo overlay toàn màn hình — chỉ thao tác DOM có sẵn.
 * Vanilla JS thuần, chạy được bằng file://
 */
(function () {
  'use strict';

  /* ================= 1. Cấu hình ================= */

  var CFG = {
    PERSPECTIVE: 900,     /* px — chiều sâu phối cảnh */
    TILT_MAX: 14,         /* độ — góc nghiêng tối đa mỗi trục */
    TILT_SCALE: 1.03,     /* phóng nhẹ khi hover */
    TILT_LERP: 0.18,      /* độ mượt khi bám chuột */
    SPRING_K: 0.16,       /* độ cứng lò xo khi bung về 0 */
    SPRING_D: 0.78,       /* tắt dần < 1 => hơi vượt quá rồi ổn định */
    MAGNET_R: 90,         /* px — bán kính hút của nút nam châm */
    MAGNET_PULL: 18,      /* px — độ hút tối đa của nút */
    MAGNET_TEXT: 8,       /* px — chữ bên trong dịch thêm, tạo lớp */
    MAGNET_K: 0.22,
    MAGNET_D: 0.74,
    PARALLAX_MAX: 40,     /* px — biên độ parallax tối đa */
    PARALLAX_LERP: 0.09,
    FLOAT_AMP: 12,        /* px — biên độ bay lên xuống mặc định */
    FLOAT_ROT: 3          /* độ — xoay nhẹ khi bay */
  };

  var STYLE_ID = 'fx-tilt-style';
  var SEL = '[data-fx-tilt],[data-fx-magnet],[data-fx-parallax],[data-fx-float]';
  var CLS_HOT = 'fx-tilt-hot';
  var CLS_GLARE = 'fx-tilt-glare';
  var CLS_NEON = 'fx-tilt-neon';
  var CLS_LABEL = 'fx-magnet-label';
  var CLS_REDUCED = 'fx-tilt-reduced';

  /* ================= 2. Trạng thái ================= */

  var started = false;      /* đã init xong chưa */
  var booting = false;      /* đang chờ DOMContentLoaded */
  var reduced = false;      /* chế độ giảm chuyển động */
  var hoverOK = true;       /* thiết bị có con trỏ thật không */
  var items = [];           /* danh sách phần tử đang quản lý */
  var known = null;         /* Map: element -> item (chống đăng ký trùng) */
  var io = null;            /* IntersectionObserver */
  var rafId = 0;
  var lastT = 0;
  var clock = 0;            /* đồng hồ nội bộ (ms) cho sóng sin */
  var rectsDirty = true;    /* cờ bẩn: cần đo lại getBoundingClientRect */
  var vw = 1, vh = 1;       /* kích thước khung nhìn (cache) */
  var pX = -99999, pY = -99999;
  var hasPointer = false;
  var styleEl = null;

  /* ================= 3. Tiện ích ================= */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Hệ số lerp đã chuẩn hoá theo thời gian khung hình (khỏi lệ thuộc 60fps) */
  function ease(base, k) { return 1 - Math.pow(1 - base, k); }

  function num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function saveStyle(it, prop) {
    if (!(prop in it.saved)) it.saved[prop] = it.el.style[prop];
  }

  /* ================= 4. CSS tự chèn ================= */

  function cssText() {
    return [
      /* --- thẻ nghiêng --- */
      '[data-fx-tilt]{transform-origin:50% 50%;}',
      /* Vệt sáng kính: div do module tự tạo, chạy theo con trỏ */
      '.' + CLS_GLARE + '{position:absolute;inset:0;pointer-events:none;',
      'mix-blend-mode:overlay;border-radius:inherit;opacity:0;z-index:2;',
      'transition:opacity .35s ease;',
      'background:radial-gradient(circle at var(--fx-gx,50%) var(--fx-gy,50%),',
      'rgba(255,255,255,.55) 0%,rgba(255,255,255,.16) 32%,rgba(255,255,255,0) 62%);}',
      '.' + CLS_HOT + ' .' + CLS_GLARE + '{opacity:1;}',
      /* Viền neon chạy vòng quanh: vòng 2px, ruột là conic-gradient quay tròn */
      '.' + CLS_NEON + '{position:absolute;inset:-1px;border-radius:inherit;',
      'pointer-events:none;padding:2px;overflow:hidden;opacity:0;z-index:3;',
      'transition:opacity .35s ease;',
      'filter:drop-shadow(0 0 6px rgba(34,211,238,.55));',
      '-webkit-mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);',
      '-webkit-mask-composite:xor;',
      'mask:linear-gradient(#000,#000) content-box,linear-gradient(#000,#000);',
      'mask-composite:exclude;}',
      '.' + CLS_NEON + ' > i{position:absolute;left:-100%;top:-100%;width:300%;height:300%;',
      'display:block;',
      'background:conic-gradient(from 0deg,rgba(34,211,238,0) 0deg,#22d3ee 40deg,',
      '#a78bfa 95deg,#f472b6 150deg,rgba(251,191,36,.9) 190deg,rgba(34,211,238,0) 240deg,',
      'rgba(34,211,238,0) 360deg);',
      'animation:fx-tilt-spin 2.6s linear infinite;animation-play-state:paused;}',
      '.' + CLS_HOT + ' .' + CLS_NEON + '{opacity:1;}',
      '.' + CLS_HOT + ' .' + CLS_NEON + ' > i{animation-play-state:running;}',
      '@keyframes fx-tilt-spin{to{transform:rotate(360deg);}}',
      /* --- nhãn nút nam châm --- */
      '.' + CLS_LABEL + '{display:inline-block;will-change:transform;}',
      /* --- chế độ giảm chuyển động: tắt hết JS, chỉ còn hover scale nhẹ --- */
      '.' + CLS_REDUCED + ' [data-fx-tilt],',
      '.' + CLS_REDUCED + ' [data-fx-magnet]{transition:transform .3s ease;}',
      '.' + CLS_REDUCED + ' [data-fx-tilt]:hover,',
      '.' + CLS_REDUCED + ' [data-fx-magnet]:hover{transform:scale(1.02);}',
      '.' + CLS_REDUCED + ' [data-fx-float]{transform:none;}',
      '@media (prefers-reduced-motion: reduce){.' + CLS_NEON + ' > i{animation:none;}}'
    ].join('');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      styleEl = document.getElementById(STYLE_ID);
      return;
    }
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.appendChild(document.createTextNode(cssText()));
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function removeStyle() {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
  }

  /* ================= 5. Đăng ký phần tử ================= */

  function makeItem(el) {
    return {
      el: el,
      tilt: false, depth: false, magnet: false, para: 0, flt: false,
      active: false,
      /* hình học đã cache */
      cx: 0, cy: 0, w: 1, h: 1,
      /* nghiêng 3D */
      rx: 0, ry: 0, vrx: 0, vry: 0, trx: 0, tryv: 0, sc: 1, hot: false,
      gx: 50, gy: 50, glare: null, neon: null,
      /* nam châm */
      mx: 0, my: 0, vmx: 0, vmy: 0, labels: null, lastLabel: '',
      /* parallax */
      ox: 0, oy: 0,
      /* bay lửng lơ */
      ph: 0, spd: 1, amp: CFG.FLOAT_AMP, fx: 0, fy: 0, fr: 0,
      /* dọn dẹp */
      saved: {}, made: [], depthKids: null, last: ''
    };
  }

  /* Gom các phần tử con dùng làm "chữ" của nút nam châm.
     Nếu nút không có phần tử con nào thì tự bọc phần chữ vào <span>. */
  function collectLabels(it) {
    var el = it.el, kids = el.children, out = [], i, kid, disp;
    for (i = 0; i < kids.length; i++) {
      kid = kids[i];
      if (kid.classList.contains(CLS_GLARE) || kid.classList.contains(CLS_NEON)) continue;
      out.push(kid);
    }
    if (!out.length) {
      var span = document.createElement('span');
      span.className = CLS_LABEL;
      while (el.firstChild) span.appendChild(el.firstChild);
      el.appendChild(span);
      it.made.push({ node: span, unwrap: true });
      out.push(span);
    } else {
      /* transform không ăn với phần tử inline -> nâng lên inline-block */
      for (i = 0; i < out.length; i++) {
        disp = '';
        try { disp = window.getComputedStyle(out[i]).display; } catch (err) { disp = ''; }
        if (disp === 'inline') out[i].style.display = 'inline-block';
        out[i].style.willChange = 'transform';
      }
    }
    return out;
  }

  function buildLayers(it) {
    var el = it.el;
    /* preserve-3d và overflow:hidden xung khắc nhau (overflow ép về flat),
       nên thẻ có lớp chiều sâu thì không cắt tràn ở thẻ. */
    saveStyle(it, 'position');
    saveStyle(it, 'overflow');
    saveStyle(it, 'transformStyle');
    saveStyle(it, 'willChange');
    saveStyle(it, 'transform');

    var cs = null;
    try { cs = window.getComputedStyle(el); } catch (err) { cs = null; }
    if (cs && cs.position === 'static') el.style.position = 'relative';
    if (!it.depth && cs && cs.overflow === 'visible') el.style.overflow = 'hidden';
    if (it.depth) el.style.transformStyle = 'preserve-3d';
    el.style.willChange = 'transform';

    var glare = document.createElement('div');
    glare.className = CLS_GLARE;
    glare.setAttribute('aria-hidden', 'true');
    /* Đặt thẳng vào style để đúng hợp đồng kể cả khi CSS bị ghi đè */
    glare.style.position = 'absolute';
    glare.style.inset = '0';
    glare.style.pointerEvents = 'none';
    glare.style.mixBlendMode = 'overlay';
    glare.style.borderRadius = 'inherit';
    el.appendChild(glare);
    it.glare = glare;
    it.made.push({ node: glare });

    var neon = document.createElement('div');
    neon.className = CLS_NEON;
    neon.setAttribute('aria-hidden', 'true');
    neon.appendChild(document.createElement('i'));
    el.appendChild(neon);
    it.neon = neon;
    it.made.push({ node: neon });
  }

  function setupDepth(it) {
    var kids = it.el.querySelectorAll('[data-fx-depth]'), i, z;
    it.depthKids = [];
    for (i = 0; i < kids.length; i++) {
      z = num(kids[i].getAttribute('data-fx-depth'), 0);
      /* Lớp con dịch theo trục Z một lần, tạo chiều sâu khi thẻ nghiêng */
      kids[i].style.transform = 'translateZ(' + z + 'px)';
      it.depthKids.push(kids[i]);
    }
  }

  function register(el) {
    if (!el || el.nodeType !== 1 || known.has(el)) return;
    var it = makeItem(el);

    it.tilt = !reduced && hoverOK && el.hasAttribute('data-fx-tilt');
    it.magnet = !reduced && hoverOK && el.hasAttribute('data-fx-magnet');
    it.para = (!reduced && hoverOK && el.hasAttribute('data-fx-parallax'))
      ? num(el.getAttribute('data-fx-parallax'), 0.2) : 0;
    it.flt = !reduced && el.hasAttribute('data-fx-float');

    if (!it.tilt && !it.magnet && !it.para && !it.flt) return;

    if (it.tilt) {
      it.depth = el.hasAttribute('data-fx-tilt-depth');
      if (it.depth) setupDepth(it);
    }
    if (it.magnet) it.labels = collectLabels(it);
    if (it.tilt) buildLayers(it);
    if (it.magnet && !it.tilt) {
      saveStyle(it, 'willChange');
      saveStyle(it, 'transform');
      el.style.willChange = 'transform';
    }
    if (it.flt) {
      it.ph = Math.random() * Math.PI * 2;            /* lệch pha ngẫu nhiên */
      it.spd = 0.55 + Math.random() * 0.55;           /* tốc độ hơi khác nhau */
      it.amp = clamp(num(el.getAttribute('data-fx-float'), CFG.FLOAT_AMP), 4, 40);
      saveStyle(it, 'transform');
      saveStyle(it, 'willChange');
      el.style.willChange = 'transform';
    }

    known.set(el, it);
    el.__fxItem = it;
    items.push(it);
    if (io) io.observe(el); else it.active = true;
    rectsDirty = true;
  }

  function scan(root) {
    if (!started || reduced || !known) return;
    root = root || document;
    if (root.nodeType === 1 && root.matches && root.matches(SEL)) register(root);
    var list = root.querySelectorAll ? root.querySelectorAll(SEL) : [];
    for (var i = 0; i < list.length; i++) register(list[i]);
  }

  /* ================= 6. Đo đạc (cache rect) ================= */

  /* Đo lại hộp bao. Tâm hình học = tâm bbox trừ đi phần dịch chuyển
     do chính module gây ra (xoay/scale quanh tâm nên không đổi tâm). */
  function measure(it) {
    var el = it.el, r = el.getBoundingClientRect();
    var dx = it.ox + it.mx + it.fx;
    var dy = it.oy + it.my + it.fy;
    it.cx = r.left + r.width / 2 - dx;
    it.cy = r.top + r.height / 2 - dy;
    it.w = el.offsetWidth || r.width || 1;
    it.h = el.offsetHeight || r.height || 1;
  }

  function refreshRects() {
    for (var i = 0; i < items.length; i++) {
      if (items[i].active) measure(items[i]);
    }
    rectsDirty = false;
  }

  /* ================= 7. Vòng rAF DUY NHẤT ================= */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);

    var dt = now - lastT;
    lastT = now;
    if (!(dt > 0) || dt > 100) dt = 16.7;
    clock += dt;
    var k = dt / 16.7;
    var steps = dt > 26 ? 2 : 1;   /* số bước tích phân lò xo */

    if (rectsDirty) refreshRects();

    var i, s, it, tx, ty, rot, t, a;

    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!it.active) continue;

      tx = 0; ty = 0; rot = 0;

      /* --- 7.1 Parallax theo con trỏ --- */
      if (it.para) {
        var qx = 0, qy = 0;
        if (hasPointer) {
          qx = clamp(((pX - vw / 2) / (vw / 2)) * CFG.PARALLAX_MAX * it.para,
            -CFG.PARALLAX_MAX, CFG.PARALLAX_MAX);
          qy = clamp(((pY - vh / 2) / (vh / 2)) * CFG.PARALLAX_MAX * it.para,
            -CFG.PARALLAX_MAX, CFG.PARALLAX_MAX);
        }
        a = ease(CFG.PARALLAX_LERP, k);
        it.ox += (qx - it.ox) * a;
        it.oy += (qy - it.oy) * a;
        tx += it.ox; ty += it.oy;
      }

      /* --- 7.2 Bay lửng lơ (sin, lệch pha, xoay nhẹ) --- */
      if (it.flt) {
        var ft = clock * 0.001 * it.spd;
        it.fy = Math.sin(ft + it.ph) * it.amp;
        it.fx = Math.sin(ft * 0.63 + it.ph * 1.7) * it.amp * 0.38;
        it.fr = Math.sin(ft * 0.81 + it.ph * 0.5) * CFG.FLOAT_ROT;
        tx += it.fx; ty += it.fy; rot += it.fr;
      }

      /* --- 7.3 Nút nam châm --- */
      if (it.magnet) {
        var gmx = 0, gmy = 0;
        if (hasPointer) {
          /* khoảng cách tới mép nút (0 khi con trỏ nằm trong nút) */
          var ex = Math.max(it.cx - it.w / 2 - pX, 0, pX - (it.cx + it.w / 2));
          var ey = Math.max(it.cy - it.h / 2 - pY, 0, pY - (it.cy + it.h / 2));
          var d = Math.sqrt(ex * ex + ey * ey);
          if (d < CFG.MAGNET_R) {
            var st = 1 - d / CFG.MAGNET_R;
            var ux = pX - it.cx, uy = pY - it.cy;
            var ul = Math.sqrt(ux * ux + uy * uy) || 1;
            gmx = (ux / ul) * CFG.MAGNET_PULL * st;
            gmy = (uy / ul) * CFG.MAGNET_PULL * st;
          }
        }
        for (s = 0; s < steps; s++) {
          it.vmx += (gmx - it.mx) * CFG.MAGNET_K; it.vmx *= CFG.MAGNET_D; it.mx += it.vmx;
          it.vmy += (gmy - it.my) * CFG.MAGNET_K; it.vmy *= CFG.MAGNET_D; it.my += it.vmy;
        }
        if (Math.abs(it.mx) < 0.01 && Math.abs(it.vmx) < 0.01) { it.mx = 0; it.vmx = 0; }
        if (Math.abs(it.my) < 0.01 && Math.abs(it.vmy) < 0.01) { it.my = 0; it.vmy = 0; }
        tx += it.mx; ty += it.my;

        /* chữ bên trong dịch thêm một chút -> cảm giác nhiều lớp */
        if (it.labels && it.labels.length) {
          var rt = CFG.MAGNET_TEXT / CFG.MAGNET_PULL;
          var ls = (it.mx || it.my)
            ? 'translate3d(' + (it.mx * rt).toFixed(2) + 'px,' + (it.my * rt).toFixed(2) + 'px,0)'
            : '';
          if (ls !== it.lastLabel) {
            it.lastLabel = ls;
            for (s = 0; s < it.labels.length; s++) it.labels[s].style.transform = ls;
          }
        }
      }

      /* --- 7.4 Nghiêng 3D + vệt sáng kính --- */
      if (it.tilt) {
        var hot = false;
        if (hasPointer) {
          var lx = pX - (it.cx - it.w / 2);
          var ly = pY - (it.cy - it.h / 2);
          hot = lx >= 0 && lx <= it.w && ly >= 0 && ly <= it.h;
          if (hot) {
            var nx = lx / it.w - 0.5;
            var ny = ly / it.h - 0.5;
            it.trx = -ny * 2 * CFG.TILT_MAX;
            it.tryv = nx * 2 * CFG.TILT_MAX;
            it.gx = (lx / it.w) * 100;
            it.gy = (ly / it.h) * 100;
          }
        }
        if (hot !== it.hot) {
          it.hot = hot;
          if (hot) it.el.classList.add(CLS_HOT); else it.el.classList.remove(CLS_HOT);
        }

        if (hot) {
          /* bám chuột bằng lerp trong rAF — không dùng CSS transition cho transform */
          a = ease(CFG.TILT_LERP, k);
          var prx = it.rx, pry = it.ry;
          it.rx += (it.trx - it.rx) * a;
          it.ry += (it.tryv - it.ry) * a;
          it.vrx = it.rx - prx;          /* giữ vận tốc để lúc rời ra bung tiếp */
          it.vry = it.ry - pry;
          it.sc += (CFG.TILT_SCALE - it.sc) * a;
          it.el.style.setProperty('--fx-gx', it.gx.toFixed(2) + '%');
          it.el.style.setProperty('--fx-gy', it.gy.toFixed(2) + '%');
        } else {
          /* rời chuột: lò xo về 0, hơi vượt quá rồi ổn định */
          for (s = 0; s < steps; s++) {
            it.vrx += (0 - it.rx) * CFG.SPRING_K; it.vrx *= CFG.SPRING_D; it.rx += it.vrx;
            it.vry += (0 - it.ry) * CFG.SPRING_K; it.vry *= CFG.SPRING_D; it.ry += it.vry;
          }
          if (Math.abs(it.rx) < 0.005 && Math.abs(it.vrx) < 0.005) { it.rx = 0; it.vrx = 0; }
          if (Math.abs(it.ry) < 0.005 && Math.abs(it.vry) < 0.005) { it.ry = 0; it.vry = 0; }
          it.sc += (1 - it.sc) * ease(0.12, k);
          if (Math.abs(it.sc - 1) < 0.0005) it.sc = 1;
        }
      }

      /* --- 7.5 Gộp mọi biến đổi thành MỘT chuỗi, ghi 1 lần/khung --- */
      t = '';
      if (tx || ty) {
        t += 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)';
      }
      if (it.tilt) {
        t += (t ? ' ' : '') + 'perspective(' + CFG.PERSPECTIVE + 'px)'
          + ' rotateX(' + it.rx.toFixed(3) + 'deg)'
          + ' rotateY(' + it.ry.toFixed(3) + 'deg)';
      }
      if (rot) t += (t ? ' ' : '') + 'rotate(' + rot.toFixed(3) + 'deg)';
      if (it.tilt && it.sc !== 1) t += (t ? ' ' : '') + 'scale(' + it.sc.toFixed(4) + ')';

      if (t !== it.last) {
        it.last = t;
        it.el.style.transform = t;
      }
    }
  }

  function startLoop() {
    if (rafId || reduced || !items.length) return;
    lastT = (window.performance && performance.now) ? performance.now() : Date.now();
    rafId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ================= 8. Sự kiện ================= */

  function onPointerMove(e) {
    pX = e.clientX; pY = e.clientY;
    hasPointer = true;
  }

  function onPointerOut() { hasPointer = false; }

  function onResize() {
    vw = window.innerWidth || 1;
    vh = window.innerHeight || 1;
    rectsDirty = true;
  }

  function onScroll() { rectsDirty = true; }

  function onVisibility() {
    if (document.hidden) stopLoop(); else startLoop();
  }

  function bind() {
    if (hoverOK) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('mousemove', onPointerMove, { passive: true });
      document.addEventListener('mouseleave', onPointerOut, false);
      window.addEventListener('blur', onPointerOut, false);
    }
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibility, false);
  }

  function unbind() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseleave', onPointerOut, false);
    window.removeEventListener('blur', onPointerOut, false);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('visibilitychange', onVisibility, false);
  }

  /* ================= 9. init / destroy ================= */

  function boot(opts) {
    injectStyle();

    if (reduced) {
      /* Giảm chuyển động: không chạy JS, chỉ để CSS lo hover scale nhẹ */
      document.documentElement.classList.add(CLS_REDUCED);
      started = true;
      return;
    }

    known = window.Map ? new window.Map() : {
      /* dự phòng cực hiếm (không có Map): dùng cờ gắn trên phần tử */
      has: function (el) { return el.__fxTiltOn === true; },
      set: function (el) { el.__fxTiltOn = true; }
    };

    onResize();

    if (window.IntersectionObserver) {
      /* Chỉ tính toán cho phần tử đang trong khung nhìn */
      io = new window.IntersectionObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var it = recs[i].target.__fxItem;
          if (!it) continue;
          it.active = recs[i].isIntersecting;
          if (it.active) rectsDirty = true;
        }
      }, { root: null, rootMargin: '140px', threshold: 0 });
    }

    started = true;
    scan(document);
    bind();
    if (!document.hidden) startLoop();
  }

  function init(opts) {
    opts = opts || {};
    if (started) { scan(document); return; }

    var mmReduce = false, mmHover = true;
    try {
      mmReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      mmHover = window.matchMedia('(hover: hover)').matches;
    } catch (err) { mmReduce = false; mmHover = true; }

    reduced = opts.reduced === true || mmReduce;
    /* Thiết bị cảm ứng: tắt tilt/magnet/parallax, chỉ giữ data-fx-float */
    hoverOK = mmHover;

    if (document.readyState === 'loading') {
      if (booting) return;
      booting = true;
      document.addEventListener('DOMContentLoaded', function once() {
        document.removeEventListener('DOMContentLoaded', once, false);
        booting = false;
        boot(opts);
      }, false);
      return;
    }
    boot(opts);
  }

  function destroy() {
    stopLoop();
    unbind();
    if (io) { io.disconnect(); io = null; }

    for (var i = 0; i < items.length; i++) {
      var it = items[i], j, m;
      /* gỡ các div do module tự tạo */
      for (j = 0; j < it.made.length; j++) {
        m = it.made[j];
        if (m.unwrap && m.node.parentNode) {
          while (m.node.firstChild) m.node.parentNode.insertBefore(m.node.firstChild, m.node);
        }
        if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
      }
      /* trả lại style gốc */
      for (var p in it.saved) {
        if (Object.prototype.hasOwnProperty.call(it.saved, p)) it.el.style[p] = it.saved[p];
      }
      it.el.style.removeProperty('--fx-gx');
      it.el.style.removeProperty('--fx-gy');
      it.el.classList.remove(CLS_HOT);
      if (it.labels) {
        for (j = 0; j < it.labels.length; j++) {
          it.labels[j].style.transform = '';
          it.labels[j].style.willChange = '';
        }
      }
      if (it.depthKids) {
        for (j = 0; j < it.depthKids.length; j++) it.depthKids[j].style.transform = '';
      }
      try { delete it.el.__fxItem; } catch (e2) { it.el.__fxItem = null; }
      if (it.el.__fxTiltOn) { try { delete it.el.__fxTiltOn; } catch (e3) { it.el.__fxTiltOn = false; } }
    }

    items = [];
    known = null;
    document.documentElement.classList.remove(CLS_REDUCED);
    removeStyle();
    hasPointer = false;
    rectsDirty = true;
    started = false;
    booting = false;
  }

  /* ================= 10. Đăng ký module ================= */

  var api = {
    init: init,
    destroy: destroy,
    scan: scan
  };

  window.FX = window.FX || {};
  window.FX.tilt = api;
})();
