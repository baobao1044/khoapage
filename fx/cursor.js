/*!
 * fx/cursor.js — Module con trỏ tuỳ biến "bay phấp phới" cho trang KHOA
 * Đăng ký: window.FX.cursor  |  z-index: 9800
 *
 * Hiệu ứng:
 *  1. Vòng tròn neon đuổi theo chuột (lerp ~0.18) + chấm đặc bám 1:1
 *  2. Vệt sao chổi 28 điểm nội suy, gradient cyan → hồng → tím, blend 'lighter'
 *  3. Hạt bụi sáng bắn ra khi di chuyển nhanh (giới hạn ~220 hạt sống)
 *  4. Ripple neon khi click: 2 vòng lệch pha, to hơn khi chuột phải / giữ lâu
 *  5. Hover: phình 2.6 lần, đổi hồng, viền dày, quay chậm, hiện nhãn chữ
 *  6. Idle > 2.5s: vòng tròn "thở" nhẹ theo hàm sin
 *
 * Vanilla JS thuần, không thư viện, chạy được bằng file://
 */
(function () {
  'use strict';

  /* ============================================================
   * 1. HẰNG SỐ & BẢNG MÀU (theo CONTRACT mục 6)
   * ============================================================ */

  var Z_DEFAULT = 9800;

  var C_CYAN   = [34, 211, 238];    /* --neon-cyan   #22d3ee */
  var C_PINK   = [244, 114, 182];   /* --neon-pink   #f472b6 */
  var C_VIOLET = [167, 139, 250];   /* --neon-violet #a78bfa */
  var C_AMBER  = [251, 191, 36];    /* --neon-amber  #fbbf24 */

  /* Các phần tử làm vòng tròn phình to */
  var GROW_SEL  = 'a,button,[data-fx-magnet],[data-cursor="grow"]';
  /* Phần tử có nhãn chữ bám theo con trỏ */
  var LABEL_SEL = '[data-cursor-label]';

  var TRAIL_LEN    = 28;     /* số điểm nội suy của vệt sao chổi */
  var IDLE_MS      = 2500;   /* đứng yên bao lâu thì bắt đầu "thở" */
  var LONGPRESS_MS = 350;    /* giữ lâu hơn mức này thì ripple to hơn */
  var RING_R       = 16;     /* bán kính vòng tròn cơ bản */
  var HOVER_SCALE  = 2.6;    /* hệ số phình khi hover */
  var PART_CAP     = 220;    /* trần tuyệt đối số hạt bụi sống */

  var FONT_STACK = '600 11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  var STYLE_ID   = 'fx-cursor-hide-style';
  var HTML_CLASS = 'fx-cursor-hidden';

  /* ============================================================
   * 2. TRẠNG THÁI MODULE
   * ============================================================ */

  var inited  = false;   /* init() đã dựng xong chưa */
  var pending = false;   /* đang chờ DOMContentLoaded */
  var active  = false;   /* thiết bị có chuột thật → module mới bật */
  var reduced = false;   /* chế độ giảm chuyển động */
  var zIndex  = Z_DEFAULT;

  var canvas = null, ctx = null, styleEl = null;
  var dpr = 1, W = 0, H = 0;

  var rafId = 0, running = false, lastT = 0;

  /* Vị trí chuột */
  var mx = -9999, my = -9999;   /* toạ độ thô — chấm nhỏ bám 1:1 */
  var px = -9999, py = -9999;   /* toạ độ khung trước — để tính tốc độ */
  var rx = -9999, ry = -9999;   /* vòng tròn có độ trễ (lerp 0.18) */
  var speed = 0;                /* tốc độ đã làm mượt, đơn vị px/khung */
  var hasPointer = false;       /* đã nhận pointermove lần nào chưa */
  var inWindow = true;
  var fade = 0;                 /* alpha tổng thể (hiện/ẩn mềm) */

  /* Vệt sao chổi — chuỗi điểm, mỗi điểm đuổi theo điểm trước */
  var trail = [];
  var energy = 0;               /* 0..1 — đi càng nhanh đuôi càng dài & rõ */

  /* Hạt bụi */
  var parts = [];
  var partMax = PART_CAP;

  /* Ripple */
  var ripples = [];
  var pressing = false, pressT = 0, pressPop = 0;

  /* Hover */
  var growOn = false, hoverAmt = 0;
  var labelText = '', labelShown = '', labelAlpha = 0;
  var rot = 0;

  /* Idle */
  var lastMoveT = 0, breatheAmt = 0, breathe = 0;

  /* Bán kính vòng tròn ở khung hiện tại (tính trong update, dùng khi vẽ) */
  var ringR = RING_R;

  /* Lưu lại con trỏ hệ thống cũ để destroy() trả lại nguyên trạng */
  var prevBodyCursor = '';
  var hadBodyCursor = false;

  var onReadyRef = null;

  /* ============================================================
   * 3. TIỆN ÍCH
   * ============================================================ */

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Hệ số nội suy độc lập với FPS: rate là tỉ lệ tại 60fps */
  function ef(rate, dt) { return 1 - Math.pow(1 - rate, dt * 60); }

  /* Trộn 2 màu RGB */
  function mix(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  /* Dải màu của đuôi sao chổi: cyan → hồng → tím */
  function ramp(t) {
    return t < 0.5 ? mix(C_CYAN, C_PINK, t * 2) : mix(C_PINK, C_VIOLET, (t - 0.5) * 2);
  }

  function matches(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }

  function closestOf(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(sel)) { return el; }
      el = el.parentElement;
    }
    return null;
  }

  /* ============================================================
   * 4. DỰNG / GỠ LỚP OVERLAY
   * ============================================================ */

  function buildCanvas() {
    canvas = document.createElement('canvas');
    canvas.className = 'fx-cursor-canvas';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';   /* không chặn click / scroll */
    canvas.style.zIndex = String(zIndex);
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');
    document.body.appendChild(canvas);
    resize();
  }

  /* Ẩn con trỏ hệ thống — chỉ làm khi chắc chắn có chuột thật */
  function hideSystemCursor() {
    prevBodyCursor = document.body.style.cursor;
    hadBodyCursor = document.body.style.getPropertyValue('cursor') !== '';
    document.body.style.cursor = 'none';

    /* Thẻ style phụ để ghi đè cursor:pointer của link/nút,
       vẫn chừa ô nhập liệu để không mất con trỏ chữ I */
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent =
      'html.' + HTML_CLASS + ',' +
      'html.' + HTML_CLASS + ' *:not(input):not(textarea):not(select){cursor:none !important;}';
    (document.head || document.documentElement).appendChild(styleEl);
    document.documentElement.classList.add(HTML_CLASS);
  }

  function restoreSystemCursor() {
    document.documentElement.classList.remove(HTML_CLASS);
    if (styleEl && styleEl.parentNode) { styleEl.parentNode.removeChild(styleEl); }
    styleEl = null;
    if (document.body) {
      if (hadBodyCursor) { document.body.style.cursor = prevBodyCursor; }
      else { document.body.style.removeProperty('cursor'); }
    }
  }

  function resize() {
    if (!canvas) { return; }
    dpr = Math.min(2, window.devicePixelRatio || 1);   /* cap ở 2 theo CONTRACT */
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    calcPartMax();
  }

  /* Giới hạn số hạt theo diện tích màn hình, mobile giảm còn ~40% */
  function calcPartMax() {
    if (reduced) { partMax = 0; return; }
    var m = PART_CAP * Math.min(1, (W * H) / (1440 * 900));
    if (window.innerWidth < 700) { m *= 0.4; }
    partMax = Math.max(30, Math.round(m));
  }

  function resetTrail() {
    trail.length = 0;
    for (var i = 0; i < TRAIL_LEN; i++) { trail.push({ x: mx, y: my }); }
  }

  /* ============================================================
   * 5. SỰ KIỆN
   * ============================================================ */

  function isTouchEvt(e) { return e && e.pointerType === 'touch'; }

  function onMove(e) {
    if (isTouchEvt(e)) { return; }
    if (!hasPointer) {
      mx = px = rx = e.clientX;
      my = py = ry = e.clientY;
      resetTrail();
      hasPointer = true;
    }
    mx = e.clientX;
    my = e.clientY;
    inWindow = true;
    lastMoveT = nowMs();
  }

  function onDown(e) {
    if (isTouchEvt(e)) { return; }
    mx = e.clientX; my = e.clientY;
    if (!hasPointer) { px = rx = mx; py = ry = my; resetTrail(); hasPointer = true; }
    pressing = true;
    pressT = nowMs();
    pressPop = 1;
    lastMoveT = pressT;
    /* Chuột phải → ripple to ngay từ đầu */
    addRipple(mx, my, e.button === 2 ? 1.6 : 1);
  }

  function onUp(e) {
    if (isTouchEvt(e)) { return; }
    if (!pressing) { return; }
    var hold = nowMs() - pressT;
    pressing = false;
    pressPop = Math.max(pressPop, 0.75);
    lastMoveT = nowMs();
    /* Giữ lâu → thêm một cặp vòng to hơn khi nhả tay */
    if (hold >= LONGPRESS_MS && e.button !== 2) {
      addRipple(mx, my, clamp(1.15 + hold / 1500, 1.15, 2));
    }
  }

  function onCancel() { pressing = false; }

  /* Hover bằng event delegation 'pointerover' — rẻ hơn elementFromPoint
     mỗi 4 khung vì chỉ chạy đúng lúc con trỏ đổi phần tử */
  function onOver(e) {
    if (isTouchEvt(e)) { return; }
    inWindow = true;
    var t = e.target;
    growOn = !!closestOf(t, GROW_SEL);
    var lab = closestOf(t, LABEL_SEL);
    var txt = lab ? (lab.getAttribute('data-cursor-label') || '') : '';
    labelText = txt ? txt.toUpperCase() : '';
    if (labelText) { labelShown = labelText; }
  }

  function onOut(e) {
    /* relatedTarget rỗng nghĩa là con trỏ rời hẳn khỏi cửa sổ */
    if (!e.relatedTarget) {
      inWindow = false;
      growOn = false;
      labelText = '';
      pressing = false;
    }
  }

  function onBlur() {
    inWindow = false;
    growOn = false;
    labelText = '';
    pressing = false;
  }

  function onVisibility() {
    if (document.hidden) { stop(); }
    else { start(); }
  }

  /* ============================================================
   * 6. HẠT BỤI & RIPPLE
   * ============================================================ */

  function spawnParts() {
    if (reduced || partMax <= 0 || !hasPointer || !inWindow) { return; }
    if (speed < 6) { return; }
    var n = Math.min(4, Math.floor(speed / 7));
    var dxm = mx - px, dym = my - py;
    for (var i = 0; i < n && parts.length < partMax; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = 0.4 + Math.random() * 1.7 + speed * 0.05;
      var pal = Math.random();
      var col = pal < 0.5 ? C_CYAN : (pal < 0.85 ? C_PINK : (pal < 0.95 ? C_VIOLET : C_AMBER));
      parts.push({
        x: mx + (Math.random() - 0.5) * 10,
        y: my + (Math.random() - 0.5) * 10,
        vx: Math.cos(ang) * sp - dxm * 0.10,
        vy: Math.sin(ang) * sp - dym * 0.10,
        life: 1,
        decay: 0.85 + Math.random() * 1.35,
        r: 0.7 + Math.random() * 1.7,
        c: col
      });
    }
  }

  function updateParts(dt) {
    var damp = Math.pow(0.962, dt * 60);
    var g = 0.014 * dt * 60;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vx *= damp;
      p.vy = p.vy * damp + g;
      p.life -= p.decay * dt;
      if (p.life <= 0) { parts.splice(i, 1); }
    }
  }

  /* Một cú click sinh 2 vòng lệch pha */
  function addRipple(x, y, scale) {
    if (reduced) { return; }              /* reduced: không có ripple bay */
    ripples.push({ x: x, y: y, t: 0, dur: 0.72, delay: 0, max: 62 * scale, w: 2.6, c: C_CYAN });
    ripples.push({ x: x, y: y, t: 0, dur: 0.95, delay: 0.12, max: 100 * scale, w: 1.5, c: C_PINK });
    if (ripples.length > 24) { ripples.splice(0, ripples.length - 24); }
  }

  function updateRipples(dt) {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var r = ripples[i];
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt / r.dur;
      if (r.t >= 1) { ripples.splice(i, 1); }
    }
  }

  /* ============================================================
   * 7. CẬP NHẬT MỖI KHUNG
   * ============================================================ */

  function update(dt, now) {
    /* Tốc độ (px mỗi khung 60fps), làm mượt để đuôi không giật */
    var vdx = mx - px, vdy = my - py;
    var inst = Math.sqrt(vdx * vdx + vdy * vdy) / Math.max(0.2, dt * 60);
    speed += (inst - speed) * ef(0.3, dt);
    px = mx; py = my;

    /* Vòng tròn đuổi theo chuột với độ trễ */
    if (hasPointer) {
      var k = ef(0.18, dt);
      rx += (mx - rx) * k;
      ry += (my - ry) * k;
    }

    /* Hiện / ẩn mềm */
    fade += (((hasPointer && inWindow) ? 1 : 0) - fade) * ef(0.14, dt);

    /* Năng lượng đuôi: lên nhanh, tắt chậm → "mờ dần theo thời gian" */
    var eTarget = clamp(speed / 13, 0, 1);
    energy += (eTarget - energy) * ef(eTarget > energy ? 0.3 : 0.05, dt);

    /* Chuỗi điểm đuôi sao chổi (nội suy nối tiếp) */
    if (hasPointer && !reduced) {
      var h = trail[0];
      var k0 = ef(0.55, dt);
      h.x += (mx - h.x) * k0;
      h.y += (my - h.y) * k0;
      var kc = ef(0.42, dt);
      for (var i = 1; i < TRAIL_LEN; i++) {
        var a = trail[i - 1], b = trail[i];
        b.x += (a.x - b.x) * kc;
        b.y += (a.y - b.y) * kc;
      }
    }

    /* Hạt bụi + ripple */
    spawnParts();
    updateParts(dt);
    updateRipples(dt);

    /* Hover */
    hoverAmt += ((growOn ? 1 : 0) - hoverAmt) * ef(0.16, dt);
    labelAlpha += ((labelText ? 1 : 0) - labelAlpha) * ef(0.18, dt);
    if (labelAlpha < 0.01 && labelText) { labelShown = labelText; }

    /* Quay chậm khi hover */
    rot += (0.45 + 0.35 * hoverAmt) * dt;

    /* Idle > 2.5s → "thở" nhẹ theo sin */
    var idle = (now - lastMoveT) > IDLE_MS && !growOn && hasPointer;
    breatheAmt += ((idle ? 1 : 0) - breatheAmt) * ef(0.05, dt);
    breathe = Math.sin(now * 0.0022) * breatheAmt;

    /* Nhịp nảy khi bấm */
    pressPop += (0 - pressPop) * ef(0.11, dt);

    /* Bán kính vòng tròn khung này */
    var scale = 1 + (HOVER_SCALE - 1) * hoverAmt;
    ringR = RING_R * scale * (1 + breathe * 0.11) * (1 + pressPop * 0.28) * (pressing ? 0.9 : 1);
  }

  /* ============================================================
   * 8. VẼ
   * ============================================================ */

  function drawTrail() {
    if (reduced || energy <= 0.02 || fade <= 0.01) { return; }
    var n = 6 + Math.round((TRAIL_LEN - 7) * energy);   /* đi nhanh → đuôi dài */
    if (n < 3) { return; }
    var maxW = 6.5 + 5.5 * energy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 1; i < n; i++) {
      var t = i / n;
      var a = trail[i - 1], b = trail[i];
      var w = maxW * (1 - t);              /* dải thon dần về đuôi */
      if (w < 0.25) { continue; }
      var col = ramp(t);
      var al = 0.5 * (1 - t) * energy * fade;
      if (i < n * 0.55) {                  /* quầng sáng mềm ở gốc đuôi */
        ctx.strokeStyle = rgba(col, al * 0.26);
        ctx.lineWidth = w * 2.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(col, al);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawParts() {
    if (!parts.length) { return; }
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = p.life * p.life * 0.85 * fade;
      if (a <= 0.01) { continue; }
      ctx.fillStyle = rgba(p.c, a * 0.3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(p.c, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRipples() {
    if (!ripples.length) { return; }
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < ripples.length; i++) {
      var r = ripples[i];
      if (r.delay > 0) { continue; }
      var t = clamp(r.t, 0, 1);
      var e = 1 - Math.pow(1 - t, 3);
      var rad = r.max * e;
      var a = (1 - t) * (1 - t) * 0.9;
      if (rad <= 0.5 || a <= 0.01) { continue; }
      ctx.strokeStyle = rgba(r.c, a);
      ctx.lineWidth = Math.max(0.4, r.w * (1 - t));
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      /* vòng phụ mảnh hơn cho cảm giác sóng kép */
      ctx.strokeStyle = rgba(r.c, a * 0.32);
      ctx.lineWidth = Math.max(0.3, r.w * 0.6 * (1 - t));
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRing() {
    if (fade <= 0.01) { return; }
    var col = mix(C_CYAN, C_PINK, hoverAmt);
    var a = fade * (0.85 + 0.15 * hoverAmt);
    ctx.globalCompositeOperation = 'lighter';

    /* Quầng neon mờ */
    ctx.fillStyle = rgba(col, 0.06 * fade);
    ctx.beginPath();
    ctx.arc(rx, ry, ringR * 1.15, 0, Math.PI * 2);
    ctx.fill();

    /* Vòng chính */
    ctx.strokeStyle = rgba(col, a);
    ctx.lineWidth = 1.6 + 1.9 * hoverAmt;
    ctx.beginPath();
    ctx.arc(rx, ry, ringR, 0, Math.PI * 2);
    ctx.stroke();

    /* Ba cung quay chậm, chỉ hiện khi hover */
    if (hoverAmt > 0.02) {
      ctx.strokeStyle = rgba(C_VIOLET, hoverAmt * 0.8 * fade);
      ctx.lineWidth = 1.2 + 0.9 * hoverAmt;
      var rr = ringR + 7;
      for (var s = 0; s < 3; s++) {
        var a0 = rot + s * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.arc(rx, ry, rr, a0, a0 + 0.55);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawDot() {
    if (fade <= 0.01) { return; }
    var r = (2.7 - 1.1 * hoverAmt) + pressPop * 1.6;
    if (r <= 0.2) { return; }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(C_CYAN, 0.25 * fade);
    ctx.beginPath();
    ctx.arc(mx, my, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(238,252,255,' + (0.95 * fade) + ')';
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* Nhãn chữ vẽ thẳng trên canvas: nhỏ, viết hoa, letter-spacing rộng */
  function drawLabel() {
    var a = labelAlpha * fade;
    if (a <= 0.02 || !labelShown) { return; }
    var txt = labelShown;
    var sp = 3.6;                       /* khoảng cách giữa các chữ cái */
    ctx.font = FONT_STACK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    var i, total = 0, ws = [];
    for (i = 0; i < txt.length; i++) {
      var w = ctx.measureText(txt.charAt(i)).width;
      ws.push(w);
      total += w + sp;
    }
    if (total > 0) { total -= sp; }

    var cx = rx - total / 2;
    var cy = ry + ringR + 16;
    if (cy > H - 12) { cy = ry - ringR - 16; }   /* tránh tràn đáy màn hình */

    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = rgba(C_PINK, 0.85 * a);
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(240,250,255,' + a + ')';
    for (i = 0; i < txt.length; i++) {
      ctx.fillText(txt.charAt(i), cx, cy);
      cx += ws[i] + sp;
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalCompositeOperation = 'source-over';
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!hasPointer && fade <= 0.01) { return; }
    drawTrail();
    drawParts();
    drawRipples();
    drawRing();
    drawDot();
    drawLabel();
  }

  /* ============================================================
   * 9. VÒNG LẶP (đúng MỘT requestAnimationFrame)
   * ============================================================ */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!(dt > 0)) { dt = 1 / 60; }
    if (dt > 0.05) { dt = 0.05; }
    update(dt, now);
    draw();
  }

  function start() {
    if (running || !active || !canvas) { return; }
    running = true;
    lastT = nowMs();
    rafId = window.requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) { window.cancelAnimationFrame(rafId); }
    rafId = 0;
    running = false;
  }

  /* ============================================================
   * 10. GẮN / GỠ LISTENER
   * ============================================================ */

  function bind() {
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointercancel', onCancel, { passive: true });
    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function unbind() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  /* ============================================================
   * 11. API
   * ============================================================ */

  function setup(opts) {
    if (inited) { return; }

    reduced = !!opts.reduced || matches('(prefers-reduced-motion: reduce)');
    zIndex = (typeof opts.zIndex === 'number' && isFinite(opts.zIndex))
      ? opts.zIndex : Z_DEFAULT;

    /* Chỉ bật khi thiết bị có chuột thật; cảm ứng → tắt hoàn toàn */
    active = matches('(hover: hover) and (pointer: fine)');
    if (!active) { inited = true; return; }

    inited = true;
    buildCanvas();
    hideSystemCursor();
    resetTrail();
    lastMoveT = nowMs();
    bind();
    if (!document.hidden) { start(); }
  }

  var api = {
    init: function (opts) {
      opts = opts || {};
      if (inited || pending) { return; }
      if (!document.body) {
        /* Gọi trước DOMContentLoaded → tự hoãn lại */
        pending = true;
        onReadyRef = function () {
          document.removeEventListener('DOMContentLoaded', onReadyRef);
          onReadyRef = null;
          pending = false;
          setup(opts);
        };
        document.addEventListener('DOMContentLoaded', onReadyRef);
        return;
      }
      setup(opts);
    },

    destroy: function () {
      if (pending && onReadyRef) {
        document.removeEventListener('DOMContentLoaded', onReadyRef);
        onReadyRef = null;
        pending = false;
      }
      if (!inited) { return; }
      stop();
      unbind();
      restoreSystemCursor();     /* trả lại document.body.style.cursor như cũ */
      if (canvas && canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
      canvas = null;
      ctx = null;
      trail.length = 0;
      parts.length = 0;
      ripples.length = 0;
      hasPointer = false;
      inWindow = true;
      growOn = false;
      pressing = false;
      hoverAmt = 0; labelAlpha = 0; labelText = ''; labelShown = '';
      energy = 0; speed = 0; fade = 0; pressPop = 0; breatheAmt = 0;
      mx = my = px = py = rx = ry = -9999;
      inited = false;
      active = false;
    }
  };

  window.FX = window.FX || {};
  window.FX.cursor = api;
})();
