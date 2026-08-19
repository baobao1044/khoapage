/* ============================================================================
   fx/matrix.js — Mưa Matrix + hệ thống easter egg "đỉnh nóc kịch trần"
   Đăng ký: window.FX.matrix   |   z-index: 1 (trên nền cosmos, dưới nội dung)

   Phần A: mưa ký tự katakana nửa chiều rộng rơi xuống, đầu cột sáng trắng,
           thi thoảng có cột rơi nguyên chữ KHOA màu hồng.
   Phần B: Konami code -> RAVE, gõ "khoa" -> mưa chữ KHOA bay lên,
           lắc chuột điên cuồng -> chữ neon, giữ chuột 1.5s -> lỗ đen hút chữ.

   MỘT canvas, MỘT vòng requestAnimationFrame cho cả hai phần.
   Vanilla JS thuần — không import, không CDN, chạy được bằng file://
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- hằng số */
  var Z_INDEX = 1;                 // dải z-index đã phân cho matrix
  var CELL = 16;                   // kích thước ô chữ ~16px
  var KATA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
  var WORD = 'KHOA';
  var CHARS = KATA + '0123456789' + WORD;
  var GLYPH_FONT = '"MS Gothic","Osaka-Mono","DejaVu Sans Mono","Courier New",monospace';
  var UI_FONT = '"Segoe UI",system-ui,-apple-system,"Noto Sans",Arial,sans-serif';

  /* bảng màu theo CONTRACT */
  var CYAN = { r: 34, g: 211, b: 238 };    /* --neon-cyan   #22d3ee */
  var PINK = { r: 244, g: 114, b: 182 };   /* --neon-pink   #f472b6 */
  var VIOLET = { r: 167, g: 139, b: 250 }; /* --neon-violet #a78bfa */

  var KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown',
                'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var SHAKE_MSG = 'BÌNH TĨNH ĐI KHOA ƠI 😭';
  var HOLD_MS = 1500;              // giữ chuột > 1.5s thì mở lỗ đen
  var SHAKE_WINDOW = 1200;         // cửa sổ 1.2s đếm số lần đảo hướng chuột
  var SHAKE_FLIPS = 12;            // > 12 lần đảo hướng thì kích hoạt
  var SHAKE_COOLDOWN = 10000;      // 10s cooldown, tránh spam
  var RAVE_MS = 8000;              // rave mặc định 8 giây
  var KHOA_COL_CHANCE = 0.03;      // xác suất thấp: cột rơi nguyên chữ KHOA

  /* --------------------------------------------------------- biến nội bộ */
  var state = null;                // toàn bộ trạng thái runtime
  var pending = false;             // đã hoãn init tới DOMContentLoaded chưa
  var api;                         // object export
  var prefOp = 0.35;               // opacity mong muốn (~0.35 theo đặc tả)
  var prefColor = null;            // màu mưa do trang chính đặt trước init
  var prefRain = true;             // trạng thái bật/tắt mưa đặt trước init
  var TMP = [0, 0, 1, 1];          // buffer dùng lại cho phép biến dạng lỗ đen

  /* ---------------------------------------------------------- tiện ích */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(s) { return s.charAt((Math.random() * s.length) | 0); }

  function rgba(c, a) {
    if (a < 0) a = 0; else if (a > 1) a = 1;
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a.toFixed(3) + ')';
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  /* Đổi HSL -> RGB, dùng cho hue chạy vòng lúc rave */
  function hsl2rgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  /* Chuyển màu CSS bất kỳ về {r,g,b} nhờ chính engine của trình duyệt */
  function parseColor(css) {
    if (!css) return CYAN;
    try {
      var p = document.createElement('canvas').getContext('2d');
      p.fillStyle = '#22d3ee';
      p.fillStyle = css;
      var s = String(p.fillStyle);
      if (s.charAt(0) === '#') {
        if (s.length === 4) {
          return {
            r: parseInt(s.charAt(1) + s.charAt(1), 16),
            g: parseInt(s.charAt(2) + s.charAt(2), 16),
            b: parseInt(s.charAt(3) + s.charAt(3), 16)
          };
        }
        if (s.length === 7) {
          return {
            r: parseInt(s.substring(1, 3), 16),
            g: parseInt(s.substring(3, 5), 16),
            b: parseInt(s.substring(5, 7), 16)
          };
        }
      }
      var m = s.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var q = m[1].split(',');
        return {
          r: clamp(parseInt(q[0], 10) || 0, 0, 255),
          g: clamp(parseInt(q[1], 10) || 0, 0, 255),
          b: clamp(parseInt(q[2], 10) || 0, 0, 255)
        };
      }
    } catch (e) { /* bỏ qua, dùng màu mặc định */ }
    return CYAN;
  }

  /* Bắn CustomEvent an toàn */
  function fire(name) {
    try { document.dispatchEvent(new CustomEvent(name)); }
    catch (e) {
      try {
        var ev = document.createEvent('Event');
        ev.initEvent(name, true, true);
        document.dispatchEvent(ev);
      } catch (e2) { /* thôi kệ */ }
    }
  }

  /* Đang gõ trong ô nhập liệu thì không cướp phím */
  function isEditable(el) {
    if (!el || el === document || el === window) return false;
    if (el.isContentEditable) return true;
    var t = (el.tagName || '').toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }

  /* =========================================================== PHẦN A: MƯA */

  /* Tạo mới một cột mưa */
  function newCol(s, i) {
    var c = {
      x: i * CELL + CELL * 0.5,
      y: 0,          // vị trí đầu cột, đơn vị "hàng" (số thực)
      spd: 10,       // tốc độ rơi, hàng/giây
      len: 14,       // độ dài đuôi
      khoa: false,   // cột đặc biệt rơi nguyên chữ KHOA
      hr: -9999,     // hàng của đầu cột ở khung hình trước
      on: Math.random() < s.dens,   // cột có hoạt động không (giảm mật độ)
      cells: []      // ký tự của từng hàng, giữ nguyên khi đuôi quét qua
    };
    resetCol(s, c);
    c.y = -rnd(0, s.rows + 10);
    return c;
  }

  /* Thả lại cột từ phía trên khi rơi hết màn hình */
  function resetCol(s, c) {
    c.y = -rnd(1, Math.max(4, s.rows * 0.8));
    c.spd = rnd(5, 15);
    c.len = Math.round(rnd(8, 22) * (s.w < 700 ? 0.7 : 1));
    c.khoa = Math.random() < KHOA_COL_CHANCE;
    if (c.khoa) {
      c.len = Math.random() < 0.5 ? 4 : 8;   // đọc xuống là KHOA (x1 hoặc x2)
      c.spd *= 0.55;                          // chậm lại cho dễ đọc
    }
    c.hr = -9999;
  }

  /* Dựng lại mảng cột theo bề rộng hiện tại (giữ lại cột cũ nếu còn dùng được) */
  function buildCols() {
    var s = state;
    var n = Math.min(240, Math.max(1, Math.ceil(s.w / CELL)));
    var old = s.cols || [];
    var arr = new Array(n);
    var need = s.rows + 3;
    for (var i = 0; i < n; i++) {
      var c = old[i] || newCol(s, i);
      c.x = i * CELL + CELL * 0.5;
      for (var r = c.cells.length; r < need; r++) c.cells[r] = pick(CHARS);
      arr[i] = c;
    }
    /* luôn giữ ít nhất một cột hoạt động để không bị trắng trơn */
    var any = false;
    for (var k = 0; k < n; k++) { if (arr[k].on) { any = true; break; } }
    if (!any && n > 0) arr[(n / 2) | 0].on = true;
    s.cols = arr;
  }

  /* Đặt lại kích thước canvas theo devicePixelRatio (cap 2) */
  function resize() {
    var s = state;
    if (!s) return;
    s.dpr = Math.min(2, window.devicePixelRatio || 1);
    s.w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    s.h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    s.cv.width = Math.round(s.w * s.dpr);
    s.cv.height = Math.round(s.h * s.dpr);
    s.cv.style.width = s.w + 'px';
    s.cv.style.height = s.h + 'px';
    var ctx = s.ctx;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = CELL + 'px ' + GLYPH_FONT;
    s.rows = Math.ceil(s.h / CELL) + 1;
    s.bh.R = Math.max(160, Math.min(s.w, s.h) * 0.42);
    buildCols();
  }

  /* ================================================ PHẦN B: HẠT & LỖ ĐEN */

  function addPart(s, p) {
    if (s.parts.length >= s.maxParts) return;
    p.max = p.life;
    s.parts.push(p);
  }

  /* Mưa chữ KHOA phủ màn hình rồi bay lên tan dần (gõ "khoa") */
  function khoaBurst(s) {
    var n = Math.max(12, Math.round(90 * s.dens));
    var slow = s.reduced ? 0.45 : 1;
    for (var i = 0; i < n; i++) {
      var full = Math.random() < 0.3;
      addPart(s, {
        x: Math.random() * s.w,
        y: s.h * rnd(0.35, 1.15),
        vx: rnd(-45, 45) * slow,
        vy: rnd(-260, -80) * slow,
        g: -16 * slow,
        ch: full ? WORD : WORD.charAt(i % WORD.length),
        size: full ? rnd(16, 30) : rnd(16, 42),
        c: (i % 3 === 0) ? PINK : ((i % 3 === 1) ? CYAN : VIOLET),
        a: 0.95,
        rot: 0,
        vr: s.reduced ? 0 : rnd(-1.1, 1.1),
        life: rnd(1.4, 2.8),
        max: 1
      });
    }
  }

  /* Mảnh vỡ văng ra khi lỗ đen nổ */
  function holeDebris(s) {
    var n = Math.max(10, Math.round(46 * s.dens));
    var slow = s.reduced ? 0.45 : 1;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = rnd(150, 430) * slow;
      addPart(s, {
        x: s.bh.x, y: s.bh.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: 90,
        ch: pick(CHARS),
        size: rnd(13, 26),
        c: (i % 3 === 0) ? VIOLET : ((i % 3 === 1) ? PINK : CYAN),
        a: 1,
        rot: 0,
        vr: s.reduced ? 0 : rnd(-4, 4),
        life: rnd(0.7, 1.5),
        max: 1
      });
    }
  }

  /* Mở lỗ đen tại con trỏ */
  function openHole(s, x, y) {
    s.bh.on = true;
    s.bh.x = x;
    s.bh.y = y;
  }

  /* Thả chuột: lỗ đen nổ tung */
  function closeHole(s) {
    if (!s.bh.on) return;
    var power = s.bh.pw;
    s.bh.on = false;
    if (power > 0.15) {
      s.bh.boom = 1;
      holeDebris(s);
    }
  }

  /* Biến dạng toạ độ một ký tự theo lực hấp dẫn của lỗ đen.
     Kết quả ghi vào TMP = [x, y, hệ số sáng, còn hiển thị không] */
  function warp(s, px, py) {
    var bh = s.bh;
    TMP[0] = px; TMP[1] = py; TMP[2] = 1; TMP[3] = 1;
    var rx = px - bh.x, ry = py - bh.y;
    var d = Math.sqrt(rx * rx + ry * ry);
    if (d > bh.R) return;
    if (d < 0.0001) d = 0.0001;
    var t = 1 - d / bh.R;              // 0 ở rìa, 1 ở tâm
    var ang = Math.atan2(ry, rx);
    var nd = d;
    if (bh.pw > 0) {                    // hút vào + xoáy
      nd = d * (1 - 0.9 * t * t * bh.pw);
      ang += t * 2.4 * bh.pw;
    }
    if (bh.boom > 0) {                  // vụ nổ đẩy văng ra
      nd += bh.R * 0.85 * t * bh.boom;
    }
    if (nd < 7) { TMP[3] = 0; return; } // đã bị nuốt vào tâm
    TMP[0] = bh.x + Math.cos(ang) * nd;
    TMP[1] = bh.y + Math.sin(ang) * nd;
    TMP[2] = 1 + t * 1.6 * Math.max(bh.pw, bh.boom);
  }

  /* ====================================================== RAVE & EASTER EGG */

  function startRave(s, ms) {
    var dur = (typeof ms === 'number' && ms > 0) ? ms : RAVE_MS;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    s.raveEnd = Math.max(s.raveEnd, now + dur);
    try { document.documentElement.style.setProperty('--fx-rave', '1'); } catch (e) {}
  }

  function endRave(s) {
    s.raveEnd = 0;
    try { document.documentElement.style.setProperty('--fx-rave', '0'); } catch (e) {}
  }

  /* Konami code: rave + gọi hàng xóm (nếu có) + bắn sự kiện */
  function triggerKonami(s) {
    startRave(s, RAVE_MS);
    fire('fx:konami');
    /* phòng thủ: các module khác có thể chưa load */
    var FX = window.FX;
    if (FX && FX.burst && typeof FX.burst.megaBoom === 'function') {
      try { FX.burst.megaBoom(); } catch (e) {}
    }
    if (FX && FX.cosmos && typeof FX.cosmos.warp === 'function') {
      try { FX.cosmos.warp(3); } catch (e) {}
    }
  }

  /* Gõ "khoa": bùng mưa chữ KHOA + bắn sự kiện */
  function triggerKhoa(s) {
    khoaBurst(s);
    fire('fx:khoa');
  }

  /* Lắc chuột điên cuồng: hiện dòng chữ neon giữa màn hình */
  function triggerShake(s) {
    s.msgMax = 2;      // tự tan sau 2 giây
    s.msg = 2;
  }

  /* ----------------------------------------------------------- listeners */

  function onKey(e) {
    var s = state;
    if (!s || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target)) return;      // đang gõ trong input/textarea thì thôi
    var k = String(e.key || '').toLowerCase();
    if (!k) return;

    /* Konami code */
    if (k === KONAMI[s.kIdx]) {
      s.kIdx++;
      if (s.kIdx >= KONAMI.length) { s.kIdx = 0; triggerKonami(s); }
    } else {
      s.kIdx = (k === KONAMI[0]) ? 1 : 0;
    }

    /* gõ chữ "khoa" ở bất kỳ đâu */
    if (k.length === 1) {
      s.buf = (s.buf + k).slice(-8);
      if (s.buf.indexOf('khoa') >= 0) { s.buf = ''; triggerKhoa(s); }
    }
  }

  function onMove(e) {
    var s = state;
    if (!s) return;
    var x = e.clientX, y = e.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (s.bh.on) { s.bh.x = x; s.bh.y = y; }   // lỗ đen bám theo con trỏ

    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var dx = x - s.mx, dy = y - s.my;
    s.mx = x; s.my = y;
    var flip = false;
    if (Math.abs(dx) > 4) {
      var dirx = dx > 0 ? 1 : -1;
      if (s.dirx && dirx !== s.dirx) flip = true;
      s.dirx = dirx;
    }
    if (Math.abs(dy) > 4) {
      var diry = dy > 0 ? 1 : -1;
      if (s.diry && diry !== s.diry) flip = true;
      s.diry = diry;
    }
    if (!flip) return;

    s.flips.push(now);
    while (s.flips.length && now - s.flips[0] > SHAKE_WINDOW) s.flips.shift();
    if (s.flips.length > SHAKE_FLIPS && (now - s.lastShake) > SHAKE_COOLDOWN) {
      s.lastShake = now;
      s.flips.length = 0;
      triggerShake(s);
    }
  }

  function onDown(e) {
    var s = state;
    if (!s) return;
    if (typeof e.button === 'number' && e.button !== 0) return;  // chỉ nút trái
    if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
    var x = e.clientX, y = e.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    s.bh.x = x; s.bh.y = y;
    if (s.holdT) clearTimeout(s.holdT);
    s.holdT = setTimeout(function () {
      s.holdT = 0;
      openHole(s, s.bh.x, s.bh.y);
    }, HOLD_MS);
  }

  function onUp() {
    var s = state;
    if (!s) return;
    if (s.holdT) { clearTimeout(s.holdT); s.holdT = 0; }
    closeHole(s);
  }

  function onVis() {
    if (document.hidden) stop(); else start();
  }

  /* =================================================== VÒNG LẶP (một rAF) */

  function update(s, dt, now) {
    /* fade in/out mượt cho mưa, không tắt phựt */
    s.fade += (s.fadeT - s.fade) * Math.min(1, dt * 3);

    /* chế độ rave */
    if (s.raveEnd) {
      if (now >= s.raveEnd) endRave(s);
      /* reduced: hue chạy chậm, KHÔNG nhấp nháy nhanh (tránh gây động kinh) */
      else s.hue += (s.reduced ? 22 : 260) * dt;
    }

    var mul = s.reduced ? 0.35 : 1;                       // reduced: mưa chậm
    if (s.raveEnd) mul *= s.reduced ? 1.5 : 3.2;          // rave: tăng tốc mạnh

    /* lỗ đen: lực hút ramp lên khi giữ, tắt dần khi thả */
    var bh = s.bh;
    if (bh.on) bh.pw = Math.min(1, bh.pw + dt * 1.8);
    else if (bh.pw > 0) bh.pw = Math.max(0, bh.pw - dt * 2.4);
    if (bh.boom > 0) bh.boom = Math.max(0, bh.boom - dt * 1.6);

    /* các cột rơi */
    var cols = s.cols, i, c;
    for (i = 0; i < cols.length; i++) {
      c = cols[i];
      if (!c.on) continue;
      c.y += c.spd * mul * dt;
      var hr = Math.floor(c.y);
      if (hr !== c.hr) {
        c.hr = hr;
        if (hr >= 0 && hr < c.cells.length) c.cells[hr] = pick(CHARS);
      }
      /* nhấp nháy ký tự cho sống động (bỏ qua khi reduced) */
      if (!s.reduced && Math.random() < 0.25) {
        c.cells[(Math.random() * c.cells.length) | 0] = pick(CHARS);
      }
      if (c.y - c.len > s.rows) resetCol(s, c);
    }

    /* hạt chữ bay */
    var ps = s.parts;
    for (i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.vx *= (1 - 0.6 * dt);
      p.rot += p.vr * dt;
    }

    if (s.msg > 0) s.msg -= dt;
  }

  /* --- vẽ mưa --- */
  function drawRain(s, ctx) {
    var base = s.baseOp * s.fade * (s.reduced ? 0.55 : 1);   // reduced: mờ hơn nhiều
    if (s.raveEnd) base = Math.min(1, base * 1.7);
    if (base <= 0.003) return;

    var col = s.raveEnd ? hsl2rgb(s.hue, 1, 0.62) : s.rgb;
    var bh = s.bh;
    var warped = (bh.pw > 0 || bh.boom > 0);
    var cols = s.cols;

    ctx.font = CELL + 'px ' + GLYPH_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!c.on) continue;
      var head = Math.floor(c.y);
      if (head < 0) continue;
      var len = c.len;
      if (c.khoa) { ctx.shadowColor = rgba(PINK, 0.9); ctx.shadowBlur = 10; }
      for (var k = 0; k < len; k++) {
        var r = head - k;
        if (r < 0) break;
        if (r > s.rows) continue;
        var a = 1 - k / len;
        a = a * a * base;
        if (a < 0.012) continue;
        var px = c.x, py = r * CELL + CELL * 0.5;
        if (warped) {
          warp(s, px, py);
          if (!TMP[3]) continue;
          px = TMP[0]; py = TMP[1];
          a = Math.min(1, a * TMP[2]);
        }
        /* cột KHOA: đọc từ trên xuống đúng thứ tự K-H-O-A */
        var ch = c.khoa
          ? WORD.charAt(WORD.length - 1 - (k % WORD.length))
          : (c.cells[r] || pick(CHARS));
        if (k === 0) {
          /* ký tự đầu cột sáng trắng */
          ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, a * 2).toFixed(3) + ')';
        } else if (c.khoa) {
          ctx.fillStyle = rgba(PINK, a * 1.3);
        } else {
          ctx.fillStyle = rgba(col, a);
        }
        ctx.fillText(ch, px, py);
      }
      if (c.khoa) { ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)'; }
    }
    ctx.shadowBlur = 0;
  }

  /* --- vẽ hạt chữ --- */
  function drawParts(s, ctx) {
    var ps = s.parts;
    if (!ps.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var a = Math.min(1, p.life / p.max) * p.a;
      if (a <= 0.01) continue;
      ctx.font = '700 ' + p.size.toFixed(1) + 'px ' + GLYPH_FONT;
      ctx.fillStyle = rgba(p.c, a);
      ctx.shadowColor = rgba(p.c, a * 0.85);
      ctx.shadowBlur = 9;
      if (p.rot) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillText(p.ch, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(p.ch, p.x, p.y);
      }
    }
    ctx.restore();
  }

  /* --- vẽ lỗ đen --- */
  function drawHole(s, ctx) {
    var bh = s.bh;
    var k = Math.max(bh.pw, bh.boom);
    if (k <= 0.003) return;
    var r = 10 + 28 * bh.pw + 90 * bh.boom;
    ctx.save();
    var g = ctx.createRadialGradient(bh.x, bh.y, 0, bh.x, bh.y, r);
    g.addColorStop(0, 'rgba(5,3,15,' + (0.96 * k).toFixed(3) + ')');
    g.addColorStop(0.6, 'rgba(5,3,15,' + (0.62 * k).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(5,3,15,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bh.x, bh.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = rgba(VIOLET, 0.9);
    ctx.shadowBlur = 20 * k;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(PINK, 0.85 * k);
    ctx.beginPath();
    ctx.arc(bh.x, bh.y, Math.max(2, r * 0.7), 0, Math.PI * 2);
    ctx.stroke();

    if (bh.boom > 0) {          // sóng xung kích lan ra khi nổ
      ctx.lineWidth = 3 * bh.boom;
      ctx.strokeStyle = rgba(CYAN, bh.boom * 0.8);
      ctx.beginPath();
      ctx.arc(bh.x, bh.y, bh.R * (1 - bh.boom) + 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* --- vẽ dòng chữ neon khi lắc chuột --- */
  function drawMsg(s, ctx) {
    if (s.msg <= 0) return;
    var t = s.msgMax - s.msg;
    var fade = Math.min(1, s.msg / 0.35) * Math.min(1, t / 0.12);
    /* reduced: chỉ thở nhẹ, không chớp nhanh */
    var blink = s.reduced
      ? (0.82 + 0.18 * Math.sin(s.time * 2.2))
      : (0.45 + 0.55 * Math.abs(Math.sin(s.time * 9)));
    var a = fade * blink;
    var size = Math.max(18, Math.min(52, s.w / 15));
    var x = s.w / 2, y = s.h / 2;
    ctx.save();
    ctx.font = '700 ' + size.toFixed(0) + 'px ' + UI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = rgba(PINK, 0.95);
    ctx.shadowBlur = 28;
    ctx.fillStyle = rgba(PINK, a);
    ctx.fillText(SHAKE_MSG, x, y);
    ctx.shadowColor = rgba(CYAN, 0.9);
    ctx.shadowBlur = 14;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.6).toFixed(3) + ')';
    ctx.strokeText(SHAKE_MSG, x, y);
    ctx.restore();
  }

  function draw(s) {
    var ctx = s.ctx;
    ctx.clearRect(0, 0, s.w, s.h);
    drawRain(s, ctx);
    drawParts(s, ctx);
    drawHole(s, ctx);
    drawMsg(s, ctx);
  }

  function step(ts) {
    var s = state;
    if (!s) return;
    s.raf = window.requestAnimationFrame(step);
    if (!s.last) s.last = ts;
    var dt = (ts - s.last) / 1000;
    s.last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.06) dt = 0.06;      // chống nhảy cóc khi tab quay lại
    s.time += dt;
    update(s, dt, ts);
    draw(s);
  }

  function start() {
    var s = state;
    if (!s || s.raf || document.hidden) return;
    s.last = 0;
    s.raf = window.requestAnimationFrame(step);
  }

  function stop() {
    var s = state;
    if (!s || !s.raf) return;
    window.cancelAnimationFrame(s.raf);
    s.raf = 0;
  }

  /* ============================================================ INIT / API */

  function init(opts) {
    opts = opts || {};

    /* gọi trước DOMContentLoaded thì tự hoãn lại */
    if (!document.body) {
      if (!pending) {
        pending = true;
        document.addEventListener('DOMContentLoaded', function onReady() {
          document.removeEventListener('DOMContentLoaded', onReady);
          pending = false;
          init(opts);
        });
      }
      return api;
    }

    /* idempotent: gọi lại không tạo thêm canvas */
    if (state) {
      if (typeof opts.zIndex === 'number') state.cv.style.zIndex = String(opts.zIndex);
      return api;
    }

    var reduced = opts.reduced === true ||
      (window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false);

    /* mật độ: mobile ~40%, reduced ~15% */
    var dens = 1;
    if ((window.innerWidth || 1024) < 700) dens = 0.4;
    if (reduced) dens = Math.min(dens, 0.15);

    var cv = document.createElement('canvas');
    cv.className = 'fx-matrix-canvas';
    cv.style.position = 'fixed';
    cv.style.inset = '0';
    cv.style.top = '0';
    cv.style.left = '0';
    cv.style.pointerEvents = 'none';
    cv.style.zIndex = String(typeof opts.zIndex === 'number' ? opts.zIndex : Z_INDEX);
    cv.setAttribute('aria-hidden', 'true');

    var ctx = cv.getContext('2d');
    if (!ctx) return api;                 // trình duyệt không hỗ trợ canvas 2D
    document.body.appendChild(cv);

    state = {
      cv: cv, ctx: ctx,
      dpr: 1, w: 1, h: 1, rows: 1,
      cols: null,
      dens: dens,
      reduced: reduced,
      baseOp: clamp(prefOp, 0, 1),
      rgb: parseColor(prefColor || '#22d3ee'),
      fade: prefRain ? 0 : 0,
      fadeT: prefRain ? 1 : 0,
      raf: 0, last: 0, time: 0,
      raveEnd: 0, hue: 190,
      parts: [],
      maxParts: Math.max(40, Math.round(260 * dens)),
      msg: 0, msgMax: 2,
      bh: { on: false, pw: 0, boom: 0, x: -9999, y: -9999, R: 240 },
      kIdx: 0, buf: '',
      mx: 0, my: 0, dirx: 0, diry: 0, flips: [], lastShake: -99999,
      holdT: 0,
      hResize: null, hVis: null, hKey: null, hMove: null, hDown: null, hUp: null,
      evMove: 'mousemove', evDown: 'mousedown', evUp: 'mouseup', hasPtr: false
    };

    resize();

    /* ---- gắn listener ---- */
    var s = state;
    s.hasPtr = !!window.PointerEvent;
    s.evMove = s.hasPtr ? 'pointermove' : 'mousemove';
    s.evDown = s.hasPtr ? 'pointerdown' : 'mousedown';
    s.evUp = s.hasPtr ? 'pointerup' : 'mouseup';

    s.hResize = function () { resize(); };
    s.hVis = onVis;
    s.hKey = onKey;
    s.hMove = onMove;
    s.hDown = onDown;
    s.hUp = onUp;

    window.addEventListener('resize', s.hResize, false);
    window.addEventListener('orientationchange', s.hResize, false);
    document.addEventListener('visibilitychange', s.hVis, false);
    window.addEventListener('keydown', s.hKey, false);
    window.addEventListener(s.evMove, s.hMove, { passive: true });
    window.addEventListener(s.evDown, s.hDown, { passive: true });
    window.addEventListener(s.evUp, s.hUp, { passive: true });
    if (s.hasPtr) window.addEventListener('pointercancel', s.hUp, { passive: true });
    window.addEventListener('blur', s.hUp, false);

    start();
    return api;
  }

  function destroy() {
    var s = state;
    if (!s) return;
    stop();
    if (s.holdT) { clearTimeout(s.holdT); s.holdT = 0; }

    window.removeEventListener('resize', s.hResize, false);
    window.removeEventListener('orientationchange', s.hResize, false);
    document.removeEventListener('visibilitychange', s.hVis, false);
    window.removeEventListener('keydown', s.hKey, false);
    window.removeEventListener(s.evMove, s.hMove, { passive: true });
    window.removeEventListener(s.evDown, s.hDown, { passive: true });
    window.removeEventListener(s.evUp, s.hUp, { passive: true });
    if (s.hasPtr) window.removeEventListener('pointercancel', s.hUp, { passive: true });
    window.removeEventListener('blur', s.hUp, false);

    try { document.documentElement.style.setProperty('--fx-rave', '0'); } catch (e) {}
    if (s.cv && s.cv.parentNode) s.cv.parentNode.removeChild(s.cv);
    s.cols = null;
    s.parts = null;
    state = null;
  }

  /* ------------------------------------------------------------- API công khai */
  api = {
    init: init,
    destroy: destroy,

    /* Chỉnh độ mờ tổng thể của mưa (0..1), mặc định ~0.35 */
    setOpacity: function (v) {
      var n = clamp(typeof v === 'number' ? v : parseFloat(v), 0, 1);
      if (isNaN(n)) return;
      prefOp = n;
      if (state) state.baseOp = n;
    },

    /* Đổi màu chủ đạo của mưa, nhận mọi màu CSS hợp lệ */
    setColor: function (css) {
      prefColor = css;
      if (state) state.rgb = parseColor(css);
    },

    /* Bật/tắt mưa mượt (fade in/out, không tắt phựt) */
    rain: function (on) {
      var v = (on === undefined) ? true : !!on;
      prefRain = v;
      if (state) state.fadeT = v ? 1 : 0;
    },

    /* Bật chế độ rave thủ công, ms mặc định 8000 */
    rave: function (ms) {
      if (!state) return;
      startRave(state, ms);
    }
  };

  window.FX = window.FX || {};
  window.FX.matrix = api;
})();
