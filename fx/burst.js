/*!
 * fx/burst.js — Module hiệu ứng "ăn mừng" cho trang KHOA
 * Đăng ký: window.FX.burst
 * z-index: 9000 (theo CONTRACT.md mục 3)
 *
 * API: init, destroy, confetti, fireworks, emojiRain, shake, floatText, ring, megaBoom, flash
 * Vanilla JS thuần, không import, không CDN, chạy được qua file://
 */
(function () {
  'use strict';

  /* ==========================================================
   * 0. HẰNG SỐ & TIỆN ÍCH
   * ========================================================== */

  /* Bảng màu bắt buộc (CONTRACT mục 6). Cyan/hồng/tím lặp lại
     nhiều lần để làm màu chủ đạo, lime/amber chỉ là điểm nhấn. */
  var PALETTE = [
    '#22d3ee', '#f472b6', '#a78bfa',
    '#22d3ee', '#f472b6', '#a78bfa',
    '#22d3ee', '#f472b6',
    '#a3e635', '#fbbf24'
  ];

  var TAU = Math.PI * 2;
  var HARD_MAX = 1400;          /* trần cứng tổng số hạt sống */
  var Z_INDEX = 9000;           /* dải z-index được phân cho burst */
  var RESIDUAL_TIME = 0.55;     /* giây: thời gian xoá nốt vệt đuôi trước khi ngủ */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function d2r(d) { return d * Math.PI / 180; }

  /* Bộ nhớ đệm phân tích màu hex -> [r,g,b] (tránh parse lại mỗi khung hình) */
  var HEX_CACHE = {};
  function parseHex(hex) {
    var c = HEX_CACHE[hex];
    if (c) { return c; }
    var h = String(hex).replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var n = parseInt(h, 16);
    if (isNaN(n)) { n = 0xffffff; }
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    HEX_CACHE[hex] = c;
    return c;
  }
  /* Trả về chuỗi 'rgba(...)' với alpha cho trước */
  function rgba(hex, a) {
    var c = parseHex(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  /* Làm tối / làm sáng màu theo hệ số f (0.5 = tối một nửa) */
  function shade(hex, f) {
    var c = parseHex(hex);
    return 'rgb(' + clamp(Math.round(c[0] * f), 0, 255) + ',' +
                    clamp(Math.round(c[1] * f), 0, 255) + ',' +
                    clamp(Math.round(c[2] * f), 0, 255) + ')';
  }

  /* ==========================================================
   * 1. TRẠNG THÁI MODULE
   * ========================================================== */

  var inited = false;
  var mounted = false;
  var canvas = null;
  var ctx = null;
  var dpr = 1;
  var W = 0, H = 0;

  var parts = [];      /* MỘT mảng chung cho TẤT CẢ các loại hạt */
  var emitters = [];   /* bộ phát (mưa emoji) — cũng chạy trong cùng 1 vòng rAF */
  var topLayer = [];   /* hàng đợi vẽ lớp trên cùng (chữ + chớp trắng), tái sử dụng */

  var rafId = 0;
  var running = false;
  var lastT = 0;
  var residual = 0;    /* thời gian còn lại để xoá nốt vệt đuôi */

  var reduced = false;
  var density = 1;     /* hệ số nhân số hạt khi spawn */
  var maxParts = HARD_MAX;

  var shakeTarget = null;
  var shakeState = null;   /* {t, dur, amp, prevTransform, prevWill} */

  var boundResize = null;
  var boundVis = null;
  var boundReady = null;

  /* ==========================================================
   * 2. KHỞI TẠO / DỌN DẸP
   * ========================================================== */

  /* Tính lại mật độ hạt theo màn hình (CONTRACT mục 5) */
  function recalcDensity() {
    var mobile = (window.innerWidth || 0) < 700;
    density = reduced ? 0.15 : (mobile ? 0.45 : 1);

    /* Trần số hạt theo diện tích màn hình, không bao giờ vượt HARD_MAX */
    var area = Math.max(1, W * H);
    var cap = Math.min(HARD_MAX, Math.round(area / 850));
    if (mobile) { cap = Math.round(cap * 0.4); }
    if (reduced) { cap = Math.round(cap * 0.15); }
    maxParts = Math.max(40, cap);
  }

  function resize() {
    if (!canvas) { return; }
    W = window.innerWidth || document.documentElement.clientWidth || 1;
    H = window.innerHeight || document.documentElement.clientHeight || 1;
    dpr = Math.min(2, window.devicePixelRatio || 1);   /* cap devicePixelRatio ở 2 */
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   /* mọi phép vẽ dùng đơn vị CSS pixel */
    recalcDensity();
  }

  function mount() {
    if (mounted || !canvas) { return; }
    var host = document.body || document.documentElement;
    if (!host) { return; }
    host.appendChild(canvas);
    mounted = true;
    /* KHÔNG rung <body>: đặt transform lên body sẽ biến nó thành containing
       block cho mọi phần tử position:fixed bên trong, khiến toàn bộ lớp nền,
       con trỏ và lớp pháo hoa bị neo theo vị trí cuộn và văng khỏi màn hình.
       Ưu tiên rung phần tử bọc nội dung. */
    if (!shakeTarget) {
      shakeTarget = document.getElementById('main')
                 || document.querySelector('main')
                 || document.body || null;
    }
  }

  function init(opts) {
    opts = opts || {};
    if (inited) {
      /* idempotent: gọi lại chỉ cập nhật tuỳ chọn, không tạo thêm canvas */
      if (typeof opts.reduced === 'boolean') { reduced = opts.reduced || prefersReduced(); }
      if (opts.shakeTarget && opts.shakeTarget.style) { shakeTarget = opts.shakeTarget; }
      recalcDensity();
      mount();
      return api;
    }
    inited = true;

    reduced = (opts.reduced === true) || prefersReduced();
    Z_INDEX = (typeof opts.zIndex === 'number') ? opts.zIndex : 9000;
    if (opts.shakeTarget && opts.shakeTarget.style) { shakeTarget = opts.shakeTarget; }

    canvas = document.createElement('canvas');
    canvas.className = 'fx-burst-layer';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';   /* không bao giờ chặn click/scroll */
    canvas.style.zIndex = String(Z_INDEX);
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');

    resize();

    boundResize = function () { resize(); };
    boundVis = function () {
      if (document.hidden) {
        sleep(false);            /* tạm dừng, giữ nguyên hạt */
      } else if (alive()) {
        lastT = 0;
        wake();
      }
    };
    window.addEventListener('resize', boundResize, false);
    window.addEventListener('orientationchange', boundResize, false);
    document.addEventListener('visibilitychange', boundVis, false);

    /* init phải chạy được cả khi gọi trước DOMContentLoaded -> tự hoãn gắn DOM */
    if (document.body) {
      mount();
    } else {
      boundReady = function () { mount(); };
      document.addEventListener('DOMContentLoaded', boundReady, false);
    }
    return api;
  }

  function prefersReduced() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* Bảo đảm module đã sẵn sàng — mọi API công khai đều gọi hàm này trước,
     nên gọi confetti() trước init() vẫn an toàn (tự init ngầm). */
  function ensure() {
    if (!inited) { init({}); }
    if (!mounted) { mount(); }
    if (!W || !H) { resize(); }
    return !!ctx;
  }

  function destroy() {
    sleep(true);
    if (boundResize) {
      window.removeEventListener('resize', boundResize, false);
      window.removeEventListener('orientationchange', boundResize, false);
    }
    if (boundVis) { document.removeEventListener('visibilitychange', boundVis, false); }
    if (boundReady) { document.removeEventListener('DOMContentLoaded', boundReady, false); }
    boundResize = boundVis = boundReady = null;

    endShake();                       /* khôi phục transform gốc */
    parts.length = 0;
    emitters.length = 0;
    topLayer.length = 0;

    if (canvas && canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
    canvas = null;
    ctx = null;
    mounted = false;
    inited = false;
  }

  /* ==========================================================
   * 3. VÒNG rAF DUY NHẤT — TỰ NGỦ / TỰ THỨC
   * ========================================================== */

  function alive() {
    return parts.length > 0 || emitters.length > 0 || !!shakeState || residual > 0;
  }

  function wake() {
    if (running || !ctx) { return; }
    if (document.hidden) { return; }     /* tab ẩn thì không chạy */
    running = true;
    lastT = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  function sleep(clearAll) {
    if (rafId) { window.cancelAnimationFrame(rafId); }
    rafId = 0;
    running = false;
    if (clearAll && ctx) { ctx.clearRect(0, 0, W, H); }
  }

  function trim() {
    /* Vượt trần thì loại bỏ các hạt CŨ NHẤT (đầu mảng) */
    if (parts.length > maxParts) { parts.splice(0, parts.length - maxParts); }
  }

  function add(p) {
    parts.push(p);
    return p;
  }

  /* Số hạt sau khi áp mật độ (mobile / reduced) */
  function n(count, min) {
    return Math.max(min || 1, Math.round(count * density));
  }

  function tick(now) {
    rafId = 0;
    if (!ctx) { running = false; return; }

    if (!lastT) { lastT = now; }
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) { dt = 0.05; }        /* chống nhảy cóc khi tab quay lại */
    if (dt <= 0) { dt = 1 / 60; }

    stepEmitters(dt);
    stepShake(dt);

    /* --- cập nhật hạt, nén mảng tại chỗ (giữ nguyên thứ tự cũ -> mới) --- */
    var j = 0, i, p, trailing = false;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (update(p, dt)) {
        if (p.trail) { trailing = true; }
        parts[j++] = p;
      }
    }
    parts.length = j;
    trim();

    /* --- xoá khung: có hạt để lại vệt thì xoá mờ dần, không thì xoá sạch --- */
    if (trailing || residual > 0) {
      /* Kỹ thuật "vẽ đè nền đen alpha thấp" để tạo vệt đuôi.
         Vì đây là overlay trong suốt nằm trên nội dung trang, ta dùng
         destination-out: xoá dần theo alpha thay vì tô đen đè lên trang. */
      var fade = 1 - Math.pow(0.72, dt * 60);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + fade.toFixed(4) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      residual = trailing ? RESIDUAL_TIME : (residual - dt);
    } else {
      ctx.clearRect(0, 0, W, H);
    }

    /* --- vẽ --- */
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    topLayer.length = 0;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.k === 'text' || p.k === 'flash') { topLayer.push(p); continue; }
      draw(p);
    }
    for (i = 0; i < topLayer.length; i++) { draw(topLayer[i]); }
    topLayer.length = 0;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;

    /* --- tự NGỦ khi màn hình trống, không để rAF chạy vô ích --- */
    if (!alive()) {
      ctx.clearRect(0, 0, W, H);
      residual = 0;
      running = false;
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  }

  /* ==========================================================
   * 4. CẬP NHẬT HẠT (một switch duy nhất)
   * ========================================================== */

  function update(p, dt) {
    p.age += dt;

    switch (p.k) {

      /* ---- Giấy vụn: trọng lực + sức cản + lắc ngang + xoay 3D ---- */
      case 'conf': {
        var damp = Math.pow(p.drag, dt * 60);
        p.vx *= damp;
        p.vy = p.vy * damp + p.g * dt;
        /* lắc ngang theo sin (sway) */
        p.x += (p.vx + Math.sin(p.age * p.swayF + p.swayP) * p.swayA) * dt;
        p.y += p.vy * dt;
        p.ang += p.spin * dt;          /* góc lật mô phỏng 3D */
        p.tilt += p.tiltS * dt;
        return p.age < p.life && p.y < H + 60;
      }

      /* ---- Quả đạn pháo hoa bay lên ---- */
      case 'shell': {
        p.px = p.x; p.py = p.y;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        /* nhả vệt khói phía sau */
        p.acc += dt;
        while (p.acc > 0.018) {
          p.acc -= 0.018;
          if (parts.length < maxParts) {
            add({
              k: 'smoke', trail: false, age: 0, life: rand(0.35, 0.7),
              x: p.x + rand(-2, 2), y: p.y + rand(-2, 4),
              vx: rand(-14, 14), vy: rand(6, 34),
              r: rand(1.2, 2.8), col: p.col
            });
          }
        }
        if (p.age >= p.T || p.y <= p.ty) {
          explode(p.x, p.y, p.col, p.dbl, 0);
          return false;
        }
        return p.y < H + 40;
      }

      /* ---- Tia sáng pháo hoa (có vệt đuôi) ---- */
      case 'spark': {
        p.px = p.x; p.py = p.y;
        var d2 = Math.pow(p.drag, dt * 60);
        p.vx *= d2;
        p.vy = p.vy * d2 + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        /* nổ kép: tới giữa đời thì tia lại nổ nhỏ lần 2 */
        if (p.sec && p.age > p.life * 0.55) {
          p.sec = 0;
          miniBurst(p.x, p.y, p.hex);
        }
        return p.age < p.life;
      }

      /* ---- Khói mờ của quả đạn ---- */
      case 'smoke': {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += dt * 6;
        return p.age < p.life;
      }

      /* ---- Mưa emoji ---- */
      case 'emo': {
        p.vy += 26 * dt;
        p.x += Math.sin(p.age * p.swayF + p.swayP) * p.swayA * dt;
        p.y += p.vy * dt;
        p.rot += p.rotS * dt;
        return p.y < H + p.size;
      }

      /* ---- Chữ neon bay lên (damage number) ---- */
      case 'text': {
        p.vy += 240 * dt;              /* giảm tốc dần khi bay lên */
        p.y += p.vy * dt;
        p.x += p.vx * dt;
        return p.age < p.life;
      }

      /* ---- Vòng xung kích ---- */
      case 'ring': {
        p.r += p.spd * dt;
        p.spd *= Math.pow(0.965, dt * 60);
        return p.age < p.life;
      }

      /* ---- Chớp trắng toàn màn hình ---- */
      case 'flash':
        return p.age < p.life;
    }
    return false;
  }

  /* ==========================================================
   * 5. VẼ HẠT
   * ========================================================== */

  function draw(p) {
    var t, a;

    switch (p.k) {

      case 'conf': {
        t = p.age / p.life;
        a = t > 0.75 ? (1 - (t - 0.75) / 0.25) : 1;
        /* Mô phỏng lật 3D: co chiều rộng theo |cos(góc)|,
           mặt sau (cos < 0) tô màu tối hơn. */
        var c = Math.cos(p.ang);
        var w = p.w * Math.abs(c);
        if (w < 0.6) { w = 0.6; }
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.tilt);
        ctx.fillStyle = (c >= 0) ? p.col : p.colBack;
        ctx.fillRect(-w * 0.5, -p.h * 0.5, w, p.h);
        ctx.restore();
        return;
      }

      case 'shell': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        return;
      }

      case 'spark': {
        t = p.age / p.life;
        a = (1 - t);
        a = a * a;                       /* tắt dần nhanh về cuối */
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.strokeStyle = p.col;
        ctx.lineWidth = p.wgt * (0.35 + 0.65 * a);
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return;
      }

      case 'smoke': {
        t = p.age / p.life;
        ctx.globalAlpha = (1 - t) * 0.28;
        ctx.fillStyle = p.col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }

      case 'emo': {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = p.size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif';
        ctx.fillText(p.ch, 0, 0);
        ctx.restore();
        return;
      }

      case 'text': {
        t = p.age / p.life;
        a = t < 0.12 ? (t / 0.12) : (1 - (t - 0.12) / 0.88);
        var sc = 1 + t * 0.38;           /* phóng to nhẹ khi mờ dần */
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.translate(p.x, p.y);
        ctx.scale(sc, sc);
        ctx.font = '900 ' + p.size + 'px "Segoe UI", system-ui, -apple-system, sans-serif';
        ctx.shadowColor = p.col;
        ctx.shadowBlur = 24;
        ctx.fillStyle = p.col;
        ctx.fillText(p.txt, 0, 0);       /* lượt 1: quầng neon */
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.txt, 0, 0);       /* lượt 2: lõi trắng */
        ctx.shadowBlur = 0;
        ctx.restore();
        return;
      }

      case 'ring': {
        t = p.age / p.life;
        a = (1 - t) * (1 - t);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.strokeStyle = p.col;
        ctx.lineWidth = Math.max(0.5, p.lw * (1 - t));   /* viền dày mờ dần */
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, TAU);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return;
      }

      case 'flash': {
        t = p.age / p.life;
        ctx.globalAlpha = clamp(p.a0 * (1 - t), 0, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        return;
      }
    }
  }

  /* ==========================================================
   * 6. BỘ PHÁT (mưa emoji) & RUNG MÀN HÌNH
   * ========================================================== */

  function stepEmitters(dt) {
    for (var i = emitters.length - 1; i >= 0; i--) {
      var e = emitters[i];
      e.t += dt;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (parts.length < maxParts) { spawnEmoji(e.list); }
      }
      if (e.t >= e.dur) { emitters.splice(i, 1); }
    }
  }

  function spawnEmoji(list) {
    var size = rand(20, 56);
    add({
      k: 'emo', trail: false, age: 0,
      ch: pick(list),
      x: rand(size * 0.5, Math.max(size, W - size * 0.5)),
      y: -size,
      vy: rand(70, 190) * (reduced ? 0.6 : 1),
      size: size,
      rot: rand(0, TAU),
      rotS: rand(-2.4, 2.4) * (reduced ? 0.4 : 1),
      swayA: rand(18, 70) * (reduced ? 0.3 : 1),
      swayF: rand(1.1, 2.8),
      swayP: rand(0, TAU)
    });
  }

  function stepShake(dt) {
    if (!shakeState) { return; }
    var s = shakeState;
    s.t += dt;
    var k = 1 - (s.t / s.dur);
    if (k <= 0) { endShake(); return; }
    var amp = s.amp * k * k;                       /* nhiễu giảm dần */
    var dx = (Math.random() * 2 - 1) * amp;
    var dy = (Math.random() * 2 - 1) * amp;
    var rz = (Math.random() * 2 - 1) * amp * 0.06;
    /* 'none' không nối chuỗi được nên coi như không có transform nền */
    var base = (s.prevTransform && s.prevTransform !== 'none') ? (s.prevTransform + ' ') : '';
    s.el.style.transform = base +
      'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0) rotate(' + rz.toFixed(3) + 'deg)';
  }

  function endShake() {
    if (!shakeState) { return; }
    var s = shakeState;
    shakeState = null;
    /* Khôi phục CHÍNH XÁC transform gốc: rỗng thì gỡ hẳn thuộc tính */
    if (s.prevTransform === '') { s.el.style.removeProperty('transform'); }
    else { s.el.style.transform = s.prevTransform; }
    if (s.prevWill === '') { s.el.style.removeProperty('will-change'); }
    else { s.el.style.willChange = s.prevWill; }
  }

  /* ==========================================================
   * 7. CÁC HÀM SINH HẠT NỘI BỘ
   * ========================================================== */

  function cx() { return W * 0.5; }
  function cy() { return H * 0.5; }

  function miniBurst(x, y, hex) {
    var m = n(8, 3);
    for (var i = 0; i < m; i++) {
      if (parts.length >= maxParts) { break; }
      var a = (i / m) * TAU + rand(-0.2, 0.2);
      var sp = rand(60, 130);
      add({
        k: 'spark', trail: true, age: 0, life: rand(0.35, 0.65),
        x: x, y: y, px: x, py: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 130, drag: 0.955, wgt: 1.6,
        hex: hex, col: rgba(hex, 0.95), sec: 0
      });
    }
  }

  function explode(x, y, hex, dbl, power) {
    var N = n(120, 10);
    var base = power || rand(200, 300);
    for (var i = 0; i < N; i++) {
      if (parts.length >= maxParts) { break; }
      var a = (i / N) * TAU + rand(-0.02, 0.02);       /* toả đều quanh tâm */
      var ringF = (i % 2) ? 1 : 0.62;                  /* hai lớp cho dày */
      var sp = base * ringF * rand(0.85, 1.15);
      add({
        k: 'spark', trail: true, age: 0, life: rand(0.9, 1.7),
        x: x, y: y, px: x, py: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 115, drag: 0.968, wgt: rand(1.8, 3),
        hex: hex, col: rgba(hex, 0.95),
        sec: (dbl && i % 7 === 0) ? 1 : 0              /* nổ kép */
      });
    }
    /* quầng sáng tại tâm vụ nổ */
    add({
      k: 'ring', trail: false, age: 0, life: 0.45,
      x: x, y: y, r: 4, spd: 320, lw: 6, col: rgba(hex, 0.9)
    });
    trim();
  }

  /* ==========================================================
   * 8. API CÔNG KHAI
   * ========================================================== */

  /* --- Giấy vụn --------------------------------------------------------- */
  function confetti(x, y, opts) {
    if (!ensure()) { return api; }
    opts = opts || {};
    if (typeof x !== 'number' || isNaN(x)) { x = cx(); }
    if (typeof y !== 'number' || isNaN(y)) { y = cy(); }

    var colors = (opts.colors && opts.colors.length) ? opts.colors : PALETTE;
    var count = n(typeof opts.count === 'number' ? opts.count : 90, 6);
    var spread = d2r(typeof opts.spread === 'number' ? opts.spread : 120);   /* độ */
    var dir = d2r(typeof opts.angle === 'number' ? opts.angle : -90);        /* -90 = lên trên */
    var power = typeof opts.power === 'number' ? opts.power : 1;
    var scalar = typeof opts.scalar === 'number' ? opts.scalar : 1;
    var g = typeof opts.gravity === 'number' ? opts.gravity : 900;

    for (var i = 0; i < count; i++) {
      if (parts.length >= maxParts) { trim(); }
      var a = dir + rand(-spread * 0.5, spread * 0.5);
      var sp = rand(230, 620) * power * (reduced ? 0.55 : 1);
      var hex = pick(colors);
      add({
        k: 'conf', trail: false, age: 0,
        life: rand(2.4, 4.2),
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: g,
        drag: 0.985,
        w: rand(6, 12) * scalar,
        h: rand(8, 15) * scalar,
        ang: rand(0, TAU),
        spin: rand(-11, 11) * (reduced ? 0.35 : 1),    /* tốc độ lật 3D */
        tilt: rand(0, TAU),
        tiltS: rand(-3.4, 3.4) * (reduced ? 0.3 : 1),
        swayA: rand(20, 90) * (reduced ? 0.25 : 1),    /* biên độ lắc ngang */
        swayF: rand(1.4, 3.4),
        swayP: rand(0, TAU),
        col: hex,
        colBack: shade(hex, 0.5)                        /* mặt sau tối hơn */
      });
    }
    trim();
    wake();
    return api;
  }

  /* --- Pháo hoa --------------------------------------------------------- */
  function fireworks(x, y) {
    if (!ensure()) { return api; }
    if (typeof x !== 'number' || isNaN(x)) { x = cx(); }
    if (typeof y !== 'number' || isNaN(y)) { y = cy(); }

    var hex = pick(PALETTE);
    var sx = clamp(x + rand(-60, 60), 20, Math.max(20, W - 20));
    var sy = H + 12;
    var T = rand(0.85, 1.15);
    var g = 620;
    /* Tính vận tốc đầu để quả đạn tới đúng (x, y) sau T giây dưới trọng lực g */
    add({
      k: 'shell', trail: true, age: 0, acc: 0, T: T,
      x: sx, y: sy, px: sx, py: sy, ty: y,
      vx: (x - sx) / T,
      vy: (y - sy) / T - 0.5 * g * T,
      g: g,
      col: hex,
      hex: hex,
      dbl: Math.random() < 0.3 && !reduced      /* thi thoảng nổ kép */
    });
    trim();
    wake();
    return api;
  }

  /* --- Mưa emoji -------------------------------------------------------- */
  function emojiRain(list, durationMs) {
    if (!ensure()) { return api; }
    if (!list || !list.length) { list = ['🎉', '✨', '💜', '🔥', '⭐', '🎊']; }
    if (typeof list === 'string') { list = [list]; }
    var dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : 4000;
    var rate = (reduced ? 3 : 14) * (W < 700 ? 0.6 : 1);   /* emoji mỗi giây */
    emitters.push({ t: 0, dur: dur / 1000, list: list.slice(0), rate: rate, acc: 0 });
    wake();
    return api;
  }

  /* --- Rung màn hình ---------------------------------------------------- */
  function shake(intensity, durationMs) {
    if (reduced) { return api; }                 /* reduced: no-op */
    if (!ensure()) { return api; }
    var el = shakeTarget || document.body;
    if (!el || !el.style) { return api; }

    var amp = (typeof intensity === 'number' && intensity >= 0) ? intensity : 10;
    var dur = ((typeof durationMs === 'number' && durationMs > 0) ? durationMs : 500) / 1000;

    if (shakeState && shakeState.el === el) {
      /* đang rung: chỉ nâng biên độ / kéo dài, KHÔNG ghi đè transform gốc */
      shakeState.amp = Math.max(shakeState.amp, amp);
      shakeState.dur = Math.max(shakeState.dur - shakeState.t, dur);
      shakeState.t = 0;
    } else {
      endShake();
      shakeState = {
        el: el,
        t: 0,
        dur: dur,
        amp: amp,
        prevTransform: el.style.transform || '',
        prevWill: el.style.willChange || ''
      };
      el.style.willChange = 'transform';
    }
    wake();
    return api;
  }

  /* --- Chữ neon bay lên ------------------------------------------------- */
  function floatText(text, x, y, opts) {
    if (!ensure()) { return api; }
    opts = opts || {};
    if (typeof x !== 'number' || isNaN(x)) { x = cx(); }
    if (typeof y !== 'number' || isNaN(y)) { y = cy(); }
    add({
      k: 'text', trail: false, age: 0,
      life: (typeof opts.life === 'number' ? opts.life : 1200) / 1000,
      txt: String(text == null ? '' : text),
      x: x, y: y,
      vx: (typeof opts.drift === 'number' ? opts.drift : rand(-24, 24)),
      vy: -(typeof opts.rise === 'number' ? opts.rise : 190) * (reduced ? 0.5 : 1),
      size: typeof opts.size === 'number' ? opts.size : 34,
      col: opts.color || pick(PALETTE)
    });
    trim();
    wake();
    return api;
  }

  /* --- Vòng xung kích --------------------------------------------------- */
  function ring(x, y, opts) {
    if (!ensure()) { return api; }
    opts = opts || {};
    if (typeof x !== 'number' || isNaN(x)) { x = cx(); }
    if (typeof y !== 'number' || isNaN(y)) { y = cy(); }
    var hex = opts.color || pick(PALETTE);
    add({
      k: 'ring', trail: false, age: 0,
      life: (typeof opts.life === 'number' ? opts.life : 700) / 1000,
      x: x, y: y,
      r: typeof opts.r0 === 'number' ? opts.r0 : 6,
      spd: (typeof opts.speed === 'number' ? opts.speed : 620) * (reduced ? 0.6 : 1),
      lw: typeof opts.width === 'number' ? opts.width : 16,     /* viền dày */
      col: rgba(hex, 0.95)
    });
    /* vòng phụ mảnh hơn, chạy sau một nhịp cho có chiều sâu */
    if (!reduced) {
      add({
        k: 'ring', trail: false, age: -0.06,
        life: 0.85, x: x, y: y, r: 2, spd: 420, lw: 6,
        col: rgba(hex, 0.6)
      });
    }
    trim();
    wake();
    return api;
  }

  /* --- Chớp trắng toàn màn hình ----------------------------------------- */
  function flash(durationMs, alpha) {
    if (!ensure()) { return api; }
    var a0 = (typeof alpha === 'number') ? alpha : 0.55;
    if (reduced) { a0 = Math.min(a0, 0.12); }     /* reduced: chỉ mờ nhẹ */
    add({
      k: 'flash', trail: false, age: 0,
      life: ((typeof durationMs === 'number' && durationMs > 0) ? durationMs : 300) / 1000,
      a0: a0
    });
    wake();
    return api;
  }

  /* --- Combo "đỉnh nóc kịch trần" --------------------------------------- */
  function megaBoom(x, y) {
    if (!ensure()) { return api; }
    if (typeof x !== 'number' || isNaN(x)) { x = cx(); }
    if (typeof y !== 'number' || isNaN(y)) { y = cy(); }

    flash(300, 0.6);                                   /* chớp trắng 300ms */
    ring(x, y, { width: 22, speed: 780, life: 780 });
    fireworks(x, y);
    fireworks(x + rand(-160, 160), y + rand(-90, 60));
    confetti(x, y, { count: 200, spread: 360, power: 1.25 });
    confetti(x, y, { count: 120, spread: 70, angle: -90, power: 1.6 });
    shake(18, 600);                                    /* rung mạnh (bỏ qua nếu reduced) */
    trim();
    wake();
    return api;
  }

  /* ==========================================================
   * 9. ĐĂNG KÝ
   * ========================================================== */

  var api = {
    init: init,
    destroy: destroy,
    confetti: confetti,
    fireworks: fireworks,
    emojiRain: emojiRain,
    shake: shake,
    floatText: floatText,
    ring: ring,
    flash: flash,
    megaBoom: megaBoom
  };

  window.FX = window.FX || {};
  window.FX.burst = api;
})();
