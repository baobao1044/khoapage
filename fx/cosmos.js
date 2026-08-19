/*!
 * fx/cosmos.js — Lớp NỀN vũ trụ của trang "KHOA"
 * ------------------------------------------------------------------
 * Một canvas fullscreen duy nhất (z-index 0) vẽ chồng 6 tầng:
 *   1. Nebula chảy      — blob gradient cyan/hồng/tím, composite 'lighter'
 *   2. Starfield 3D     — ~400 sao bay từ tâm ra, warp/hyperspace theo scroll
 *   3. Lưới synthwave   — perspective grid nửa dưới, neon chạy về phía người xem
 *   4. Aurora           — 2-3 dải sáng sin nhiều tần số, blend 'screen'
 *   5. Vignette         — tối 4 góc cho chữ ở giữa dễ đọc
 *   6. Parallax chuột   — toàn cảnh lệch tối đa ~25px, easing lerp
 *
 * API: init(opts) / destroy() / warp(strength) / setHue(deg)
 * Không import, không CDN, không fetch, chạy được bằng file://
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ============================================================
   * 0) BẢNG MÀU — lưu dạng HSL để xoay tông màu bằng hueOffset
   *    (KHÔNG dùng CSS filter: hue-rotate vì rất tốn hiệu năng)
   *    #22d3ee cyan · #f472b6 pink · #a78bfa violet
   *    #a3e635 lime · #fbbf24 amber · #05030f ink
   * ============================================================ */
  var PALETTE = {
    cyan:   [187, 85, 53],
    pink:   [330, 81, 70],
    violet: [255, 92, 76],
    lime:   [ 82, 78, 55],
    amber:  [ 43, 96, 56],
    white:  [195, 60, 95]
  };
  var INK = '#05030f';

  var hueOffset = 0; // độ, cộng vào hue của mọi màu

  /* Sinh chuỗi hsla() đã xoay tông. l/a có thể bỏ trống. */
  function tone(name, l, a) {
    var c = PALETTE[name] || PALETTE.cyan;
    var h = (c[0] + hueOffset) % 360;
    if (h < 0) { h += 360; }
    var li = (l === undefined || l === null) ? c[2] : l;
    var al = (a === undefined || a === null) ? 1 : a;
    return 'hsla(' + h.toFixed(1) + ',' + c[1] + '%,' + li + '%,' + al + ')';
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ============================================================
   * 1) TRẠNG THÁI MODULE
   * ============================================================ */
  var S = {
    inited: false,
    reduced: false,
    zIndex: 0,

    canvas: null, ctx: null,
    neb: null, nebCtx: null,          // canvas phụ độ phân giải 1/4 cho nebula
    sprites: null,                    // glow sprite cho sao "hero"

    dpr: 1, W: 0, H: 0, cx: 0, cy: 0, minDim: 0,

    stars: [], stripes: [], blobs: [],
    buckets: [], bucketStroke: [], bucketFill: [],

    vignette: null, horizonGrad: null,

    // chuyển động
    t: 0, gridT: 0, boost: 0, warpSpeed: 0,
    lastTS: 0, frame: 0,

    // parallax
    mx: 0, my: 0, px: 0, py: 0,
    lastScrollY: 0,

    raf: 0, running: false,
    resizePending: false,

    // listeners (giữ tham chiếu để destroy gỡ sạch)
    onResize: null, onMouse: null, onScroll: null, onVis: null, onReady: null
  };

  var STAR_COLORS = ['white', 'cyan', 'pink', 'violet'];
  var TIER_ALPHA  = [0.30, 0.62, 1.00];
  var TIER_WIDTH  = [0.6, 1.1, 1.9];

  /* ============================================================
   * 2) TẠO / DỰNG LẠI TÀI NGUYÊN
   * ============================================================ */

  /* Glow sprite: gradient tròn vẽ sẵn, dùng drawImage thay vì
     tạo radial gradient mỗi frame. */
  function makeSprite(name) {
    var s = 64;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0.00, tone(name, 98, 1));
    gr.addColorStop(0.18, tone(name, 82, 0.75));
    gr.addColorStop(0.45, tone(name, 62, 0.22));
    gr.addColorStop(1.00, tone(name, 55, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    return c;
  }

  function buildSprites() {
    S.sprites = {};
    for (var i = 0; i < STAR_COLORS.length; i++) {
      S.sprites[STAR_COLORS[i]] = makeSprite(STAR_COLORS[i]);
    }
  }

  /* Màu cho 12 bucket (4 màu × 3 tier) — đổi khi setHue. */
  function buildBucketColors() {
    S.bucketStroke.length = 0;
    S.bucketFill.length = 0;
    for (var c = 0; c < STAR_COLORS.length; c++) {
      for (var t = 0; t < 3; t++) {
        S.bucketStroke.push(tone(STAR_COLORS[c], 72, TIER_ALPHA[t] * 0.55));
        S.bucketFill.push(tone(STAR_COLORS[c], 92, TIER_ALPHA[t]));
      }
    }
  }

  /* Gradient của từng blob nebula: tạo ở bán kính 1 rồi scale khi vẽ
     => chỉ dựng lại khi đổi hue, không dựng lại mỗi frame. */
  function buildBlobGradients() {
    if (!S.nebCtx) { return; }
    for (var i = 0; i < S.blobs.length; i++) {
      var b = S.blobs[i];
      var g = S.nebCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0.00, tone(b.color, 62, 0.55));
      g.addColorStop(0.35, tone(b.color, 50, 0.26));
      g.addColorStop(0.70, tone(b.color, 40, 0.08));
      g.addColorStop(1.00, tone(b.color, 34, 0));
      b.grad = g;
    }
  }

  /* Gradient dọc cho từng dải aurora — phụ thuộc kích thước + hue. */
  function buildStripeGradients() {
    if (!S.ctx) { return; }
    for (var i = 0; i < S.stripes.length; i++) {
      var s = S.stripes[i];
      var top = S.H * s.base - S.H * s.amp - 30;
      var bot = S.H * s.base + S.H * s.amp + s.thick + 30;
      var g = S.ctx.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0.00, tone(s.c1, 60, 0));
      g.addColorStop(0.35, tone(s.c1, 66, 0.30));
      g.addColorStop(0.60, tone(s.c2, 70, 0.24));
      g.addColorStop(1.00, tone(s.c2, 60, 0));
      s.grad = g;
    }
  }

  /* Vignette + quầng sáng đường chân trời — dựng lại khi resize/hue. */
  function buildStaticGradients() {
    if (!S.ctx) { return; }
    var r = Math.max(S.W, S.H) * 0.78;
    var vg = S.ctx.createRadialGradient(S.cx, S.cy * 0.92, S.minDim * 0.18, S.cx, S.cy, r);
    vg.addColorStop(0.00, 'rgba(5,3,15,0)');
    vg.addColorStop(0.55, 'rgba(5,3,15,0.22)');
    vg.addColorStop(0.80, 'rgba(5,3,15,0.62)');
    vg.addColorStop(1.00, 'rgba(5,3,15,0.94)');
    S.vignette = vg;

    var hy = S.H * 0.58;
    var hg = S.ctx.createLinearGradient(0, hy - S.H * 0.10, 0, hy + S.H * 0.05);
    hg.addColorStop(0.00, tone('violet', 55, 0));
    hg.addColorStop(0.70, tone('pink', 62, 0.10));
    hg.addColorStop(0.92, tone('cyan', 66, 0.22));
    hg.addColorStop(1.00, tone('cyan', 66, 0));
    S.horizonGrad = hg;
  }

  function rebuildColors() {
    buildSprites();
    buildBucketColors();
    buildBlobGradients();
    buildStripeGradients();
    buildStaticGradients();
  }

  /* ============================================================
   * 3) KHỞI TẠO DỮ LIỆU HẠT
   * ============================================================ */
  function starCount() {
    var base = 400;
    if (S.reduced) { base = Math.round(base * 0.15); }        // ~60
    else if (window.innerWidth < 700) { base = Math.round(base * 0.40); } // ~160
    // giới hạn thêm theo diện tích màn hình
    var byArea = Math.round((S.W * S.H) / 3400);
    return Math.max(28, Math.min(base, byArea));
  }

  function makeStar(st) {
    st = st || {};
    var a = Math.random() * TAU;
    var r = Math.sqrt(Math.random());       // phân bố đều trong đĩa
    st.x = Math.cos(a) * r;
    st.y = Math.sin(a) * r;
    st.z = rand(0.06, 1);
    st.pz = st.z;
    st.ci = Math.random() < 0.62 ? 0 : (1 + (Math.random() * 3 | 0));
    st.sp = rand(0.72, 1.35);               // hệ số tốc độ riêng
    st.tw = Math.random() * TAU;            // pha nhấp nháy
    st.hero = Math.random() < 0.055;        // sao sáng có quầng
    return st;
  }

  function buildStars() {
    var n = starCount();
    var arr = S.stars;
    if (arr.length > n) { arr.length = n; }
    for (var i = 0; i < n; i++) {
      arr[i] = makeStar(arr[i]);
    }
  }

  function buildBlobs() {
    var names = ['cyan', 'pink', 'violet', 'cyan', 'pink', 'violet', 'amber'];
    var n = S.reduced ? 4 : (window.innerWidth < 700 ? 5 : 7);
    S.blobs.length = 0;
    for (var i = 0; i < n; i++) {
      S.blobs.push({
        color: names[i % names.length],
        nx: Math.random(), ny: rand(-0.05, 0.85),
        vx: rand(-0.016, 0.016), vy: rand(-0.010, 0.010),
        r: rand(0.34, 0.72),
        squash: rand(0.55, 1.05),
        rot: Math.random() * TAU,
        rotV: rand(-0.05, 0.05),
        ph: Math.random() * TAU,
        fr: rand(0.18, 0.42),
        grad: null
      });
    }
  }

  function buildStripes() {
    var defs = [
      { base: 0.16, amp: 0.055, thick: 0.10, c1: 'cyan',   c2: 'violet', sp: 0.16, k: 1.0 },
      { base: 0.27, amp: 0.070, thick: 0.13, c1: 'pink',   c2: 'cyan',   sp: -0.11, k: 1.35 },
      { base: 0.09, amp: 0.040, thick: 0.07, c1: 'violet', c2: 'pink',   sp: 0.22, k: 0.72 }
    ];
    var n = S.reduced ? 2 : 3;
    var old = S.stripes.slice(0);   // giữ pha cũ để resize không làm aurora nhảy
    S.stripes.length = 0;
    for (var i = 0; i < n; i++) {
      var d = defs[i];
      S.stripes.push({
        base: d.base, amp: d.amp, thick: S.H * d.thick,
        c1: d.c1, c2: d.c2, sp: d.sp, k: d.k,
        ph: old[i] ? old[i].ph : Math.random() * TAU, grad: null
      });
    }
  }

  /* ============================================================
   * 4) RESIZE
   * ============================================================ */
  function resize() {
    S.resizePending = false;
    if (!S.canvas) { return; }

    S.dpr = Math.min(2, window.devicePixelRatio || 1);   // cap DPR ở 2
    S.W = Math.max(1, window.innerWidth);
    S.H = Math.max(1, window.innerHeight);
    S.cx = S.W * 0.5;
    S.cy = S.H * 0.45;
    S.minDim = Math.min(S.W, S.H);

    S.canvas.width = Math.round(S.W * S.dpr);
    S.canvas.height = Math.round(S.H * S.dpr);
    S.canvas.style.width = S.W + 'px';
    S.canvas.style.height = S.H + 'px';
    S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    S.ctx.lineCap = 'round';

    // nebula vẽ ở 1/4 độ phân giải rồi phóng to => mềm + rẻ
    var q = 0.25;
    S.neb.width = Math.max(2, Math.round(S.W * q));
    S.neb.height = Math.max(2, Math.round(S.H * q));

    buildStars();
    buildStripes();
    buildStaticGradients();
    buildStripeGradients();
    buildBlobGradients();
  }

  function requestResize() {
    // Không mở rAF riêng: gộp nhiều sự kiện resize vào đúng
    // vòng lặp DUY NHẤT của module (xử lý ở đầu frame kế tiếp).
    S.resizePending = true;
    if (!S.running) { resize(); }
  }

  /* ============================================================
   * 5) CÁC TẦNG VẼ
   * ============================================================ */

  /* --- Tầng 1: Nebula chảy (canvas phụ 1/4, composite 'lighter') --- */
  function drawNebula(dt) {
    var g = S.nebCtx, w = S.neb.width, h = S.neb.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';

    var slow = S.reduced ? 0.18 : 1;
    var md = Math.min(w, h);

    for (var i = 0; i < S.blobs.length; i++) {
      var b = S.blobs[i];
      b.nx += b.vx * dt * slow;
      b.ny += b.vy * dt * slow;
      b.rot += b.rotV * dt * slow;
      // trôi vòng, luôn phủ kín
      if (b.nx < -0.45) { b.nx = 1.45; } else if (b.nx > 1.45) { b.nx = -0.45; }
      if (b.ny < -0.45) { b.ny = 1.35; } else if (b.ny > 1.35) { b.ny = -0.45; }

      // "thở": bán kính dao động nhiều tần số => biến dạng mềm
      var br = Math.sin(S.t * b.fr + b.ph) * 0.16 + Math.sin(S.t * b.fr * 2.13 + b.ph * 1.7) * 0.07;
      var rr = md * b.r * (1 + br);

      g.save();
      g.translate(b.nx * w, b.ny * h);
      g.rotate(b.rot);
      g.scale(rr, rr * b.squash);
      g.fillStyle = b.grad;
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  function blitNebula(ctx) {
    var M = 46; // vẽ tràn viền để parallax không lộ mép
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = S.reduced ? 0.75 : 0.95;
    ctx.drawImage(S.neb, -M, -M, S.W + M * 2, S.H + M * 2);
    ctx.globalAlpha = 1;
  }

  /* --- Tầng 4: Aurora (sóng sin nhiều tần số, blend 'screen') --- */
  function drawAurora(ctx) {
    ctx.globalCompositeOperation = 'screen';
    var step = S.W > 1400 ? 26 : 18;
    var slow = S.reduced ? 0.2 : 1;

    for (var i = 0; i < S.stripes.length; i++) {
      var s = S.stripes[i];
      var ph = s.ph + S.t * s.sp * slow;
      var baseY = S.H * s.base;
      var amp = S.H * s.amp;

      ctx.beginPath();
      var x, y;
      for (x = -60; x <= S.W + 60; x += step) {
        var u = x / S.W;
        y = baseY
          + Math.sin(u * 2.4 * s.k + ph) * amp
          + Math.sin(u * 5.7 * s.k - ph * 1.6) * amp * 0.42
          + Math.sin(u * 11.3 * s.k + ph * 0.7) * amp * 0.18;
        if (x === -60) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      for (x = S.W + 60; x >= -60; x -= step) {
        var u2 = x / S.W;
        y = baseY + s.thick
          + Math.sin(u2 * 2.4 * s.k + ph + 0.5) * amp
          + Math.sin(u2 * 5.7 * s.k - ph * 1.6) * amp * 0.42
          + Math.sin(u2 * 9.1 * s.k - ph * 0.9) * amp * 0.22;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = S.reduced ? 0.20 : 0.34;
      ctx.fillStyle = s.grad;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* --- Tầng 3: Lưới synthwave phối cảnh nửa dưới --- */
  function drawGrid(ctx, dt) {
    var hy = S.H * 0.58;              // đường chân trời
    var bottom = S.H + 90;            // vẽ tràn xuống dưới
    var span = bottom - hy;
    if (span <= 0) { return; }

    ctx.globalCompositeOperation = 'lighter';

    // quầng sáng chân trời
    ctx.fillStyle = S.horizonGrad;
    ctx.fillRect(-60, hy - S.H * 0.12, S.W + 120, S.H * 0.18);

    S.gridT += dt * (S.reduced ? 0.05 : (0.28 + S.warpSpeed * 0.22));

    // ---- đường ngang chạy về phía người xem ----
    var LINES = 22;
    var frac = S.gridT % 1;
    for (var i = 0; i < LINES; i++) {
      var p = (i + frac) / LINES;             // 0 = chân trời, 1 = đáy
      var pp = Math.pow(p, 2.6);
      var y = hy + span * pp;
      var a = clamp(p * 1.5, 0, 1) * (S.reduced ? 0.32 : 0.55);
      if (a <= 0.01) { continue; }
      ctx.strokeStyle = (i % 2 === 0) ? tone('cyan', 62, a) : tone('pink', 68, a * 0.8);
      ctx.lineWidth = 0.7 + p * 1.6;
      ctx.beginPath();
      ctx.moveTo(-60, y);
      ctx.lineTo(S.W + 60, y);
      ctx.stroke();
    }

    // ---- đường dọc hội tụ về điểm tụ ----
    var N = S.W < 700 ? 12 : 20;
    var spread = S.W * 1.9;
    for (var k = -N; k <= N; k++) {
      var xb = S.cx + (k / N) * spread * 0.5;
      var fade = 1 - Math.abs(k) / (N + 2);
      var av = (0.10 + fade * 0.42) * (S.reduced ? 0.55 : 1);
      ctx.strokeStyle = (k % 3 === 0) ? tone('pink', 68, av) : tone('cyan', 60, av * 0.85);
      ctx.lineWidth = 0.6 + fade * 0.9;
      ctx.beginPath();
      ctx.moveTo(S.cx, hy);
      ctx.lineTo(xb, bottom);
      ctx.stroke();
    }
  }

  /* --- Tầng 2: Starfield 3D warp --- */
  function drawStars(ctx, dt) {
    var i, b;
    // reset 12 bucket (không cấp phát lại mảng)
    for (i = 0; i < 12; i++) { S.buckets[i].length = 0; }

    var fov = S.minDim * 0.62;
    var speed = S.warpSpeed;
    var margin = 80;
    var trailK = S.reduced ? 0 : clamp(speed * 2.6, 0.25, 9);
    var heroList = null;

    for (i = 0; i < S.stars.length; i++) {
      var st = S.stars[i];
      st.pz = st.z;
      st.z -= speed * st.sp * dt;
      if (st.z <= 0.035) { makeStar(st); st.z = 1; st.pz = 1; }

      var sx = S.cx + (st.x * fov) / st.z;
      var sy = S.cy + (st.y * fov) / st.z;

      if (sx < -margin || sx > S.W + margin || sy < -margin || sy > S.H + margin) {
        makeStar(st); st.z = 1; st.pz = 1;
        continue;
      }

      // điểm đầu vệt kéo (vị trí ở frame "ảo" trước đó)
      var tz = Math.min(1, st.z + speed * st.sp * dt * trailK);
      var tx = S.cx + (st.x * fov) / tz;
      var ty = S.cy + (st.y * fov) / tz;

      var d = 1 - st.z;                        // 0 = xa, 1 = gần
      var tier = d < 0.45 ? 0 : (d < 0.78 ? 1 : 2);
      var sz = clamp(0.35 + d * d * 3.0, 0.35, 3.6);

      if (st.hero && !S.reduced) {
        st.tw += dt * 2.4;
        if (!heroList) { heroList = []; }
        heroList.push(sx, sy, sz, d, st.ci, st.tw);
      }

      b = S.buckets[st.ci * 3 + tier];
      b.push(tx, ty, sx, sy, sz);
    }

    ctx.globalCompositeOperation = 'lighter';

    // vẽ theo bucket: mỗi bucket 1 lần đổi style => rất ít state change
    for (i = 0; i < 12; i++) {
      b = S.buckets[i];
      if (!b.length) { continue; }
      var tier2 = i % 3;
      var j;

      if (trailK > 0) {
        ctx.strokeStyle = S.bucketStroke[i];
        ctx.lineWidth = TIER_WIDTH[tier2];
        ctx.beginPath();
        for (j = 0; j < b.length; j += 5) {
          var dx = b[j + 2] - b[j], dy = b[j + 3] - b[j + 1];
          if (dx * dx + dy * dy < 1.2) { continue; }
          ctx.moveTo(b[j], b[j + 1]);
          ctx.lineTo(b[j + 2], b[j + 3]);
        }
        ctx.stroke();
      }

      ctx.fillStyle = S.bucketFill[i];
      for (j = 0; j < b.length; j += 5) {
        var s2 = b[j + 4];
        ctx.fillRect(b[j + 2] - s2 * 0.5, b[j + 3] - s2 * 0.5, s2, s2);
      }
    }

    // sao "hero": quầng sáng bằng sprite dựng sẵn
    if (heroList) {
      for (i = 0; i < heroList.length; i += 6) {
        var gx = heroList[i], gy = heroList[i + 1];
        var gd = heroList[i + 3];
        var spr = S.sprites[STAR_COLORS[heroList[i + 4]]];
        var tw = 0.72 + Math.sin(heroList[i + 5]) * 0.28;
        var gs = (10 + gd * gd * 58) * tw;
        ctx.globalAlpha = clamp(0.20 + gd * 0.62, 0, 0.9) * tw;
        ctx.drawImage(spr, gx - gs * 0.5, gy - gs * 0.5, gs, gs);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ============================================================
   * 6) VÒNG LẶP — DUY NHẤT MỘT requestAnimationFrame
   * ============================================================ */
  function frame(ts) {
    if (!S.running) { return; }
    S.raf = window.requestAnimationFrame(frame);

    if (S.resizePending) { resize(); }   // gộp resize vào đầu frame

    var dt = (ts - S.lastTS) / 1000;
    S.lastTS = ts;
    if (!(dt > 0)) { return; }
    if (dt > 0.05) { dt = 0.05; }   // chống nhảy cóc sau khi tab quay lại
    S.t += dt;
    S.frame++;

    // --- tốc độ warp: nền + boost, boost tự tắt dần ---
    var base = S.reduced ? 0.012 : 0.085;
    S.boost -= S.boost * Math.min(1, dt * 1.9);
    if (S.boost < 0.0005) { S.boost = 0; }
    S.warpSpeed = base + (S.reduced ? 0 : S.boost);

    // --- parallax: lerp mượt, biên độ tối đa 25px ---
    S.px = lerp(S.px, S.mx, Math.min(1, dt * 3.2));
    S.py = lerp(S.py, S.my, Math.min(1, dt * 3.2));

    var ctx = S.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, S.W, S.H);

    // nebula: cập nhật cách frame cho rẻ (mắt không nhận ra)
    var every = S.reduced ? 6 : 2;
    if (S.frame % every === 0 || S.frame === 1) {
      drawNebula(dt * every);
    }

    ctx.save();
    ctx.translate(S.px, S.py);

    blitNebula(ctx);
    drawAurora(ctx);
    drawGrid(ctx, dt);
    drawStars(ctx, dt);

    ctx.restore();

    // vignette vẽ ngoài parallax để 4 góc luôn kín
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = S.vignette;
    ctx.fillRect(0, 0, S.W, S.H);
  }

  function start() {
    if (S.running || !S.canvas) { return; }
    S.running = true;
    S.lastTS = (window.performance && performance.now) ? performance.now() : Date.now();
    S.raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    S.running = false;
    if (S.raf) { window.cancelAnimationFrame(S.raf); S.raf = 0; }
  }

  /* ============================================================
   * 7) SỰ KIỆN
   * ============================================================ */
  function handleMouse(e) {
    var t = e;
    if (e.touches && e.touches.length) { t = e.touches[0]; }
    if (typeof t.clientX !== 'number') { return; }
    var MAX = 25;                                   // dịch tối đa ~25px
    S.mx = -((t.clientX / S.W) - 0.5) * 2 * MAX;    // ngược hướng con trỏ
    S.my = -((t.clientY / S.H) - 0.5) * 2 * MAX;
  }

  function handleScroll() {
    if (S.reduced) { return; }                      // reduced: tắt warp
    var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    var d = Math.abs(y - S.lastScrollY);
    S.lastScrollY = y;
    S.boost = Math.min(2.2, S.boost + Math.min(d * 0.006, 0.55));
  }

  function handleVisibility() {
    if (document.hidden) { stop(); } else { start(); }
  }

  /* ============================================================
   * 8) SETUP / TEARDOWN
   * ============================================================ */
  function setup(opts) {
    var cv = document.createElement('canvas');
    cv.id = 'fx-cosmos';
    cv.style.position = 'fixed';
    cv.style.inset = '0';
    cv.style.top = '0';
    cv.style.left = '0';
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.display = 'block';
    cv.style.pointerEvents = 'none';                // không chặn click/scroll
    cv.style.zIndex = String(S.zIndex);
    cv.style.background = INK;
    cv.setAttribute('aria-hidden', 'true');

    var ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) { return; }

    S.canvas = cv;
    S.ctx = ctx;
    S.neb = document.createElement('canvas');
    S.nebCtx = S.neb.getContext('2d');

    S.buckets.length = 0;
    for (var i = 0; i < 12; i++) { S.buckets.push([]); }

    S.W = Math.max(1, window.innerWidth);
    S.H = Math.max(1, window.innerHeight);

    buildBlobs();
    buildStripes();
    rebuildColors();

    (document.body || document.documentElement).appendChild(cv);
    resize();
    rebuildColors();          // gradient phụ thuộc kích thước sau resize

    S.lastScrollY = window.pageYOffset || 0;

    S.onResize = requestResize;
    S.onMouse = handleMouse;
    S.onScroll = handleScroll;
    S.onVis = handleVisibility;

    window.addEventListener('resize', S.onResize, false);
    window.addEventListener('orientationchange', S.onResize, false);
    window.addEventListener('mousemove', S.onMouse, { passive: true });
    window.addEventListener('touchmove', S.onMouse, { passive: true });
    window.addEventListener('scroll', S.onScroll, { passive: true });
    document.addEventListener('visibilitychange', S.onVis, false);

    // Trình duyệt vốn không chạy rAF khi tab ẩn; visibilitychange lo bật/tắt.
    start();
  }

  /* ============================================================
   * 9) API CÔNG KHAI
   * ============================================================ */
  var api = {
    init: function (opts) {
      opts = opts || {};
      if (S.inited) { return api; }
      S.inited = true;

      var mq = null;
      try {
        mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      } catch (err) { mq = null; }
      S.reduced = (opts.reduced === true) || !!(mq && mq.matches);
      S.zIndex = (typeof opts.zIndex === 'number') ? opts.zIndex : 0;

      // chạy được cả khi gọi trước DOMContentLoaded
      if (!document.body) {
        S.onReady = function () {
          document.removeEventListener('DOMContentLoaded', S.onReady, false);
          S.onReady = null;
          if (S.inited) { setup(opts); }
        };
        document.addEventListener('DOMContentLoaded', S.onReady, false);
      } else {
        setup(opts);
      }
      return api;
    },

    /* Kích một cú tăng tốc warp tạm thời (mặc định strength = 1). */
    warp: function (strength) {
      var s = (typeof strength === 'number' && isFinite(strength)) ? strength : 1;
      if (S.reduced) { return api; }                  // reduced: tắt warp
      S.boost = Math.min(3.2, S.boost + clamp(s, 0, 4) * 1.25);
      return api;
    },

    /* Xoay tông màu toàn nền (độ). Dùng offset hue nội bộ, không CSS filter. */
    setHue: function (deg) {
      var d = (typeof deg === 'number' && isFinite(deg)) ? deg : 0;
      hueOffset = ((d % 360) + 360) % 360;
      if (S.canvas) { rebuildColors(); }
      return api;
    },

    destroy: function () {
      stop();
      if (S.onResize) {
        window.removeEventListener('resize', S.onResize, false);
        window.removeEventListener('orientationchange', S.onResize, false);
      }
      if (S.onMouse) {
        window.removeEventListener('mousemove', S.onMouse, false);
        window.removeEventListener('touchmove', S.onMouse, false);
      }
      if (S.onScroll) { window.removeEventListener('scroll', S.onScroll, false); }
      if (S.onVis) { document.removeEventListener('visibilitychange', S.onVis, false); }
      if (S.onReady) { document.removeEventListener('DOMContentLoaded', S.onReady, false); }
      S.onResize = S.onMouse = S.onScroll = S.onVis = S.onReady = null;

      if (S.canvas && S.canvas.parentNode) { S.canvas.parentNode.removeChild(S.canvas); }

      S.canvas = null; S.ctx = null; S.neb = null; S.nebCtx = null;
      S.sprites = null; S.vignette = null; S.horizonGrad = null;
      S.stars.length = 0; S.blobs.length = 0; S.stripes.length = 0;
      S.buckets.length = 0; S.bucketStroke.length = 0; S.bucketFill.length = 0;
      S.t = 0; S.gridT = 0; S.boost = 0; S.frame = 0;
      S.px = S.py = S.mx = S.my = 0;
      S.resizePending = false;
      S.inited = false;
      return api;
    }
  };

  window.FX = window.FX || {};
  window.FX.cosmos = api;
})();
