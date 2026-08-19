/* =============================================================================
   FX / TEXT — Hiệu ứng chữ theo thuộc tính  data-fx-text
   -----------------------------------------------------------------------------
   Module KHÔNG tạo overlay canvas. Nó quét DOM, tìm mọi phần tử có thuộc tính
   `data-fx-text` và biến đổi trực tiếp phần tử đó.

   Các giá trị hỗ trợ:
     scramble  — quay số ký tự rác rồi khoá dần từ trái sang phải
     type      — máy đánh chữ, con trỏ ▌ nhấp nháy (nháy cả sau khi gõ xong)
     glitch    — tách kênh RGB (2 lớp giả đỏ/cyan) + cắt lát ngang chớp nhoáng
     wave      — từng ký tự nhấp nhô theo sóng sin lệch pha + đổi màu theo hue
     gradient  — gradient neon chạy ngang vô tận (background-clip: text)
     explode   — ký tự bị đẩy xa con trỏ theo lực nghịch đảo, đàn hồi về (spring)
     neon      — chữ phát sáng neon, thi thoảng chớp tắt như đèn ống hỏng
     shuffle3d — từng ký tự lật 3D (rotateX) kiểu domino khi lọt khung nhìn

   Thuộc tính phụ:
     data-fx-once  — chỉ chạy một lần, không phát lại khi cuộn ra rồi vào lại

   API:  window.FX.text = { init(opts), destroy(), scan(root) }
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Hằng số & bảng màu (theo CONTRACT §6)
   * ------------------------------------------------------------------ */

  var STYLE_ID = 'fx-text-style';

  /* Bộ ký tự rác dùng cho hiệu ứng scramble */
  var SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#01アイウエオカキクケコ';

  /* Khoảng trắng không ngắt dòng — giữ nguyên bề rộng khi tách ký tự */
  var NBSP = '\u00A0';

  var C = {
    cyan:   '#22d3ee',
    pink:   '#f472b6',
    violet: '#a78bfa',
    lime:   '#a3e635',
    amber:  '#fbbf24',
    ink:    '#05030f'
  };

  /* Danh sách các giá trị hợp lệ */
  var KINDS = {
    scramble: 1, type: 1, glitch: 1, wave: 1,
    gradient: 1, explode: 1, neon: 1, shuffle3d: 1
  };

  /* CSS mà module tự chèn (không được sửa file css/) */
  var CSS = [
    '[data-fx-text]{-webkit-font-smoothing:antialiased;}',
    '[data-fx-text] .fx-t-inner{display:inline-block;white-space:pre-wrap;}',
    '[data-fx-text] .fx-t-char{display:inline-block;white-space:pre;',
    'will-change:transform,opacity;backface-visibility:hidden;',
    '-webkit-backface-visibility:hidden;transform-origin:50% 60%;}',
    '[data-fx-text] .fx-t-cursor{display:inline-block;color:' + C.cyan + ';',
    'text-shadow:0 0 10px rgba(34,211,238,.90),0 0 22px rgba(34,211,238,.45);}',

    /* --- glitch: 3 lớp chồng nhau, 2 lớp giả lệch màu --- */
    '.fx-t-glitch{position:relative;isolation:isolate;}',
    '.fx-t-glitch .fx-t-base{position:relative;display:inline-block;',
    'white-space:pre-wrap;z-index:2;}',
    '.fx-t-glitch .fx-t-layer{position:absolute;left:0;top:0;width:100%;',
    'height:100%;white-space:pre-wrap;pointer-events:none;z-index:1;',
    '-webkit-user-select:none;user-select:none;will-change:transform,clip-path;',
    /* Hai lớp giả blend 'screen'; khi chồng gần khít, hồng + cyan cộng lại
       thành trắng và nuốt mất gradient của phần tử gốc. Hạ độ đục để
       chỉ còn viền lệch màu, giữ nguyên màu chữ bên dưới. */
    'opacity:.38;',
    '-webkit-text-fill-color:currentColor;}',
    '.fx-t-glitch .fx-t-layer-r{color:' + C.pink + ';mix-blend-mode:screen;',
    'text-shadow:0 0 8px rgba(244,114,182,.55);}',
    '.fx-t-glitch .fx-t-layer-c{color:' + C.cyan + ';mix-blend-mode:screen;',
    'text-shadow:0 0 8px rgba(34,211,238,.55);}',

    /* --- gradient neon chạy ngang, cắt theo chữ --- */
    '.fx-t-gradient{background-image:linear-gradient(100deg,',
    C.cyan + ',' + C.violet + ',' + C.pink + ',' + C.amber + ',' + C.lime + ',' + C.cyan,
    ');background-size:200% 100%;background-repeat:repeat;',
    '-webkit-background-clip:text;background-clip:text;color:transparent;',
    '-webkit-text-fill-color:transparent;}',

    /* --- neon: quầng sáng + trạng thái "tắt bóng" --- */
    '.fx-t-neon{color:#f7fbff;text-shadow:0 0 4px #ffffff,0 0 12px ' + C.cyan + ',',
    '0 0 26px ' + C.cyan + ',0 0 48px ' + C.pink + ';}',
    '.fx-t-neon.fx-t-neon-off{color:#3b3352;text-shadow:0 0 2px rgba(34,211,238,.18);}',

    /* --- không gian 3D cho shuffle3d --- */
    '.fx-t-persp{perspective:700px;}',
    '.fx-t-persp .fx-t-char{transform-style:preserve-3d;}',

    /* --- explode: class chỉ để đánh dấu, không ép layout --- */
    '.fx-t-explode{position:relative;}'
  ].join('');

  /* ------------------------------------------------------------------ *
   * 2. Trạng thái nội bộ
   * ------------------------------------------------------------------ */

  var state = {
    inited:  false,
    reduced: false,
    items:   [],      /* danh sách phần tử đã đăng ký */
    io:      null,    /* IntersectionObserver */
    raf:     0,
    last:    0,
    clock:   0,       /* đồng hồ chỉ chạy khi tab đang hiện */
    styleEl: null,
    pointerOn: false,
    deferred: null    /* handler DOMContentLoaded đang chờ */
  };

  /* Vị trí con trỏ dùng chung cho hiệu ứng explode */
  var P = { x: -99999, y: -99999, active: false };

  /* ------------------------------------------------------------------ *
   * 3. Tiện ích chung
   * ------------------------------------------------------------------ */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function rnd(n) { return Math.random() * n; }

  function randChar() {
    return SCRAMBLE_CHARS.charAt((Math.random() * SCRAMBLE_CHARS.length) | 0);
  }

  /* Tách chuỗi thành mảng ký tự (an toàn với ký tự ngoài BMP) */
  function toChars(s) {
    if (typeof Array.from === 'function') { return Array.from(s); }
    return s.split('');
  }

  function easeOutCubic(p) { var q = 1 - p; return 1 - q * q * q; }

  /* Đọc display thực tế (an toàn khi không có getComputedStyle) */
  function computedDisplay(el) {
    try {
      if (window.getComputedStyle) {
        return window.getComputedStyle(el).display;
      }
    } catch (e) { /* bỏ qua */ }
    return '';
  }

  function emptyEl(el) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }

  function mkSpan(cls, txt) {
    var s = document.createElement('span');
    if (cls) { s.className = cls; }
    if (txt !== null && txt !== undefined) { s.textContent = txt; }
    s.setAttribute('aria-hidden', 'true');   /* screen reader không đọc rời rạc */
    return s;
  }

  /* Lấy (và ghi nhớ) nội dung gốc để destroy() phục hồi được */
  function originalText(el) {
    var orig = el.getAttribute('data-fx-original');
    if (orig === null) {
      orig = el.textContent;
      el.setAttribute('data-fx-original', orig);
    }
    return orig;
  }

  /* Tách từng ký tự thành <span>, giữ nguyên khoảng trắng bằng &nbsp; */
  function splitChars(item) {
    var el = item.el, arr = item.arr, i, ch, s;
    var chars = [];
    emptyEl(el);
    for (i = 0; i < arr.length; i++) {
      ch = arr[i];
      s = mkSpan('fx-t-char', (ch === ' ' || ch === '\t') ? NBSP : ch);
      el.appendChild(s);
      chars.push({
        el: s, i: i, blank: (ch === ' ' || ch === '\t'),
        x: 0, y: 0, vx: 0, vy: 0, bx: 0, by: 0
      });
    }
    item.chars = chars;
    return chars;
  }

  /* Gắn nhãn trợ năng: phần tử mang aria-label bằng chữ gốc,
     các span con đều aria-hidden (đã set trong mkSpan). */
  function labelize(item) {
    if (!item.hadLabel) { item.el.setAttribute('aria-label', item.text); }
  }

  /* ------------------------------------------------------------------ *
   * 4. Các hiệu ứng — mỗi hiệu ứng có: prepare / reset / frame
   *    prepare: dựng DOM một lần
   *    reset  : đưa về trạng thái đầu (để phát lại khi vào khung nhìn)
   *    frame  : cập nhật mỗi khung hình (t = ms của đồng hồ nội bộ)
   * ------------------------------------------------------------------ */

  var EFFECTS = {};

  /* ---------- 4.1 scramble ---------- */
  EFFECTS.scramble = {
    prepare: function (item) {
      labelize(item);
      emptyEl(item.el);
      item.inner = mkSpan('fx-t-inner', '');
      item.el.appendChild(item.inner);
      item.stagger = 52;
      item.dur = 430;
      item.buf = [];
      var i;
      for (i = 0; i < item.arr.length; i++) { item.buf.push(randChar()); }
    },
    reset: function (item) {
      /* Trạng thái đầu: toàn ký tự rác — giữ nguyên bề rộng, không giật layout */
      var i, out = '';
      for (i = 0; i < item.arr.length; i++) {
        out += item.arr[i] === ' ' ? ' ' : (item.buf[i] = randChar());
      }
      item.inner.textContent = out;
    },
    frame: function (item, t) {
      var el = item.arr, n = el.length, i, out = '', done = true;
      var e = t - item.t0;
      for (i = 0; i < n; i++) {
        var st = i * item.stagger;
        if (el[i] === ' ') { out += ' '; continue; }
        if (e >= st + item.dur) {
          out += el[i];                       /* đã khoá */
        } else {
          done = false;
          if (Math.random() < 0.3) { item.buf[i] = randChar(); }
          out += item.buf[i];
        }
      }
      item.inner.textContent = done ? item.text : out;
      if (done) { item.done = true; }
    }
  };

  /* ---------- 4.2 type ---------- */
  EFFECTS.type = {
    prepare: function (item) {
      labelize(item);
      emptyEl(item.el);
      item.inner = mkSpan('fx-t-inner', '');
      item.cursor = mkSpan('fx-t-cursor', '▌');
      item.el.appendChild(item.inner);
      item.el.appendChild(item.cursor);
      item.speed = 46;                         /* ms mỗi ký tự */
    },
    reset: function (item) {
      item.inner.textContent = '';
      item.cursor.style.opacity = '1';
    },
    frame: function (item, t) {
      var e = t - item.t0;
      var n = Math.min(item.arr.length, Math.floor(e / item.speed));
      if (n !== item.shown) {
        item.shown = n;
        item.inner.textContent = item.arr.slice(0, n).join('');
      }
      /* Con trỏ vẫn nháy cả sau khi gõ xong */
      item.cursor.style.opacity = (Math.floor(t / 530) % 2) ? '0.05' : '1';
    }
  };

  /* ---------- 4.3 glitch ---------- */
  EFFECTS.glitch = {
    prepare: function (item) {
      labelize(item);
      emptyEl(item.el);
      item.el.classList.add('fx-t-glitch');
      /* Lớp giả dùng position:absolute — phần tử inline cần thành inline-block
         thì mới làm khối chứa tử tế. Phần tử khối thì giữ nguyên layout. */
      if (computedDisplay(item.el) === 'inline') {
        item.el.style.display = 'inline-block';
        item.displaySet = true;
      }
      item.base  = mkSpan('fx-t-base', item.text);
      item.layR  = mkSpan('fx-t-layer fx-t-layer-r', item.text);
      item.layC  = mkSpan('fx-t-layer fx-t-layer-c', item.text);
      item.el.appendChild(item.base);
      item.el.appendChild(item.layR);
      item.el.appendChild(item.layC);
      item.next = 0;
      item.until = 0;
    },
    reset: function (item) {
      item.next = 0;
      item.until = 0;
      item.layR.style.transform = 'translate3d(-1px,0,0)';
      item.layC.style.transform = 'translate3d(1px,0,0)';
      item.layR.style.clipPath = '';
      item.layC.style.clipPath = '';
      item.base.style.transform = '';
    },
    frame: function (item, t) {
      if (t >= item.next) {
        /* Mở một đợt giật ngắn rồi hẹn đợt kế tiếp */
        item.until = t + 90 + rnd(160);
        item.next  = item.until + 700 + rnd(2400);
      }
      if (t < item.until) {
        var dx = (rnd(9) - 4.5), dy = (rnd(5) - 2.5);
        item.layR.style.transform = 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0)';
        item.layC.style.transform = 'translate3d(' + (-dx).toFixed(2) + 'px,' + (-dy).toFixed(2) + 'px,0)';
        item.base.style.transform = 'translate3d(' + (rnd(3) - 1.5).toFixed(2) + 'px,0,0)';
        /* Cắt lát ngang chớp nhoáng */
        var a = rnd(70), b = rnd(70);
        item.layR.style.clipPath = 'inset(' + a.toFixed(1) + '% 0 ' + (98 - a - rnd(22)).toFixed(1) + '% 0)';
        item.layC.style.clipPath = 'inset(' + b.toFixed(1) + '% 0 ' + (98 - b - rnd(22)).toFixed(1) + '% 0)';
      } else if (item.until !== -1) {
        /* Trạng thái nghỉ: chỉ lệch nhẹ 1px cho có chiều sâu */
        item.layR.style.transform = 'translate3d(-1px,0,0)';
        item.layC.style.transform = 'translate3d(1px,0,0)';
        item.layR.style.clipPath = '';
        item.layC.style.clipPath = '';
        item.base.style.transform = '';
        item.until = -1;
      }
    }
  };

  /* ---------- 4.4 wave ---------- */
  EFFECTS.wave = {
    prepare: function (item) {
      labelize(item);
      splitChars(item);
    },
    reset: function (item) {
      var i;
      for (i = 0; i < item.chars.length; i++) {
        item.chars[i].el.style.transform = '';
        item.chars[i].el.style.color = '';
      }
    },
    frame: function (item, t) {
      var cs = item.chars, i, c, y, h;
      for (i = 0; i < cs.length; i++) {
        c = cs[i];
        y = Math.sin(t / 340 + i * 0.42) * 7;
        c.el.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
        if (!c.blank) {
          /* Hue chạy dọc chuỗi, giới hạn trong dải cyan → tím → hồng */
          h = 185 + (((t / 26) + i * 17) % 150);
          c.el.style.color = 'hsl(' + h.toFixed(0) + ',92%,68%)';
        }
      }
    }
  };

  /* ---------- 4.5 gradient ---------- */
  EFFECTS.gradient = {
    prepare: function (item) {
      item.el.classList.add('fx-t-gradient');
      item.gw = 0;
    },
    reset: function (item) {
      item.gw = 0;                       /* đo lại khi thật sự vào khung nhìn */
      item.el.style.backgroundPosition = '0 0';
    },
    frame: function (item, t) {
      if (!item.gw) { item.gw = item.el.offsetWidth * 2 || 400; }
      /* Ảnh gradient rộng 200% và lặp lại, dịch đúng 1 chu kỳ → chạy liền mạch */
      var sh = (t * 0.075) % item.gw;
      item.el.style.backgroundPosition = (-sh).toFixed(1) + 'px 0';
    }
  };

  /* ---------- 4.6 explode ---------- */
  EFFECTS.explode = {
    prepare: function (item) {
      labelize(item);
      item.el.classList.add('fx-t-explode');
      splitChars(item);
      item.measured = false;
      ensurePointer();
    },
    reset: function (item) {
      var i, c;
      for (i = 0; i < item.chars.length; i++) {
        c = item.chars[i];
        c.x = c.y = c.vx = c.vy = 0;
        c.el.style.transform = '';
      }
      item.measured = false;
    },
    frame: function (item, t, dt) {
      var cs = item.chars, i, c;
      if (!item.measured) { measureChars(item); }
      var er = item.el.getBoundingClientRect();
      var R = 140, K = 0.17, D = 0.78;
      var step = clamp(dt / 16.67, 0.4, 2);
      for (i = 0; i < cs.length; i++) {
        c = cs[i];
        var tx = 0, ty = 0;
        if (P.active) {
          var dx = (er.left + c.bx) - P.x;
          var dy = (er.top + c.by) - P.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < R) {
            if (d < 0.001) { dx = rnd(2) - 1; dy = rnd(2) - 1; d = 1; }
            /* Lực nghịch đảo khoảng cách: càng gần đẩy càng mạnh */
            var f = (1 - d / R);
            var push = f * f * 95;
            tx = (dx / d) * push;
            ty = (dy / d) * push;
          }
        }
        /* Lò xo kéo ký tự về chỗ cũ */
        c.vx = (c.vx + (tx - c.x) * K * step) * D;
        c.vy = (c.vy + (ty - c.y) * K * step) * D;
        c.x += c.vx * step;
        c.y += c.vy * step;
        if (Math.abs(c.x) < 0.02 && Math.abs(c.y) < 0.02 &&
            Math.abs(c.vx) < 0.02 && Math.abs(c.vy) < 0.02) {
          c.x = c.y = c.vx = c.vy = 0;
          if (c.el.style.transform) { c.el.style.transform = ''; }
          continue;
        }
        c.el.style.transform = 'translate3d(' + c.x.toFixed(2) + 'px,' +
          c.y.toFixed(2) + 'px,0) rotate(' + (c.x * 0.22).toFixed(2) + 'deg)';
      }
    }
  };

  /* ---------- 4.7 neon ---------- */
  EFFECTS.neon = {
    prepare: function (item) {
      item.el.classList.add('fx-t-neon');
      item.next = 0;
      item.until = 0;
    },
    reset: function (item) {
      item.next = 0;
      item.until = 0;
      item.el.classList.remove('fx-t-neon-off');
    },
    frame: function (item, t) {
      if (t >= item.next) {
        item.until = t + 60;                    /* tắt 60ms như đèn ống hỏng */
        item.next  = item.until + 1100 + rnd(3600);
      }
      var off = t < item.until;
      if (off !== item.offState) {
        item.offState = off;
        if (off) { item.el.classList.add('fx-t-neon-off'); }
        else { item.el.classList.remove('fx-t-neon-off'); }
      }
    }
  };

  /* ---------- 4.8 shuffle3d ---------- */
  EFFECTS.shuffle3d = {
    prepare: function (item) {
      labelize(item);
      item.el.classList.add('fx-t-persp');
      splitChars(item);
      item.stagger = 62;
      item.dur = 520;
    },
    reset: function (item) {
      var i, c;
      for (i = 0; i < item.chars.length; i++) {
        c = item.chars[i];
        c.el.style.opacity = '0';
        c.el.style.transform = 'rotateX(-92deg) translate3d(0,6px,0)';
      }
    },
    frame: function (item, t) {
      var cs = item.chars, i, c, p, e, all = true;
      var el = t - item.t0;
      for (i = 0; i < cs.length; i++) {
        c = cs[i];
        p = clamp((el - i * item.stagger) / item.dur, 0, 1);
        if (p < 1) { all = false; }
        e = easeOutCubic(p);
        c.el.style.opacity = String(e);
        c.el.style.transform = 'rotateX(' + ((1 - e) * -92).toFixed(2) + 'deg) ' +
          'translate3d(0,' + ((1 - e) * 6).toFixed(2) + 'px,0)';
      }
      if (all) {
        for (i = 0; i < cs.length; i++) {
          cs[i].el.style.opacity = '';
          cs[i].el.style.transform = '';
        }
        item.done = true;
      }
    }
  };

  /* ---------- 4.9 fade — bản thay thế cho chế độ reduced ---------- */
  EFFECTS.fade = {
    prepare: function (item) { item.dur = 480; },
    reset: function (item) {
      item.el.style.opacity = '0';
      item.el.style.transform = 'translate3d(0,6px,0)';
    },
    frame: function (item, t) {
      var p = clamp((t - item.t0) / item.dur, 0, 1);
      item.el.style.opacity = String(p);
      item.el.style.transform = 'translate3d(0,' + ((1 - p) * 6).toFixed(2) + 'px,0)';
      if (p >= 1) {
        item.el.style.opacity = '';
        item.el.style.transform = '';
        item.done = true;
      }
    }
  };

  /* ---------- 4.10 typeInstant — `type` khi reduced: hiện ngay toàn bộ ---------- */
  EFFECTS.typeInstant = {
    prepare: function (item) {
      labelize(item);
      emptyEl(item.el);
      item.inner = mkSpan('fx-t-inner', item.text);
      item.cursor = mkSpan('fx-t-cursor', '▌');
      item.el.appendChild(item.inner);
      item.el.appendChild(item.cursor);
    },
    reset: function (item) { item.inner.textContent = item.text; },
    frame: function (item) { item.done = true; }
  };

  /* ---------- 4.11 static — gradient/neon khi reduced: đứng yên ---------- */
  EFFECTS.gradientStatic = {
    prepare: function (item) {
      item.el.classList.add('fx-t-gradient');
      item.el.style.backgroundPosition = '25% 0';
    },
    reset: function () {},
    frame: function (item) { item.done = true; }
  };

  EFFECTS.neonStatic = {
    prepare: function (item) { item.el.classList.add('fx-t-neon'); },
    reset: function () {},
    frame: function (item) { item.done = true; }
  };

  /* Ánh xạ khi bật chế độ giảm chuyển động */
  var REDUCED_MAP = {
    scramble:  'fade',
    glitch:    'fade',
    wave:      'fade',
    explode:   'fade',
    shuffle3d: 'fade',
    type:      'typeInstant',
    gradient:  'gradientStatic',
    neon:      'neonStatic'
  };

  /* ------------------------------------------------------------------ *
   * 5. Đo vị trí gốc của từng ký tự (cho explode)
   * ------------------------------------------------------------------ */

  function measureChars(item) {
    var cs = item.chars, i, r;
    for (i = 0; i < cs.length; i++) { cs[i].el.style.transform = 'none'; }
    var er = item.el.getBoundingClientRect();
    for (i = 0; i < cs.length; i++) {
      r = cs[i].el.getBoundingClientRect();
      cs[i].bx = r.left - er.left + r.width / 2;
      cs[i].by = r.top - er.top + r.height / 2;
      cs[i].el.style.transform = '';
    }
    item.measured = true;
  }

  /* ------------------------------------------------------------------ *
   * 6. Vòng lặp requestAnimationFrame DUY NHẤT
   * ------------------------------------------------------------------ */

  function tick(ts) {
    state.raf = 0;
    if (!state.inited) { return; }

    var dt = state.last ? (ts - state.last) : 16.67;
    state.last = ts;
    if (!(dt > 0)) { dt = 16.67; }
    if (dt > 50) { dt = 50; }          /* chống nhảy vọt sau khi tab ẩn */
    state.clock += dt;

    var t = state.clock, live = 0, i, it, fx;
    for (i = 0; i < state.items.length; i++) {
      it = state.items[i];
      if (!it.active || it.done) { continue; }
      fx = EFFECTS[it.kind];
      if (!fx) { it.done = true; continue; }
      live++;
      try { fx.frame(it, t, dt); }
      catch (err) { it.done = true; }
    }

    if (live > 0 && !document.hidden) {
      state.raf = requestAnimationFrame(tick);
    } else {
      state.last = 0;
    }
  }

  function ensureLoop() {
    if (state.raf || !state.inited || document.hidden) { return; }
    state.last = 0;
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.raf) { cancelAnimationFrame(state.raf); }
    state.raf = 0;
    state.last = 0;
  }

  /* ------------------------------------------------------------------ *
   * 7. Vòng đời của từng phần tử
   * ------------------------------------------------------------------ */

  function findItem(el) {
    var i;
    for (i = 0; i < state.items.length; i++) {
      if (state.items[i].el === el) { return state.items[i]; }
    }
    return null;
  }

  function resetItem(item) {
    var fx = EFFECTS[item.kind];
    item.done = false;
    item.shown = -1;
    item.offState = false;
    if (fx && fx.reset) {
      try { fx.reset(item); } catch (e) { /* bỏ qua */ }
    }
  }

  function startItem(item) {
    item.t0 = state.clock;
    item.done = false;
    item.active = true;
    item.hasRun = true;
    ensureLoop();
  }

  function stopItem(item) {
    item.active = false;
    if (!item.once) { resetItem(item); }
  }

  /* Đăng ký một phần tử mới */
  function register(el) {
    if (findItem(el)) { return null; }

    var raw = (el.getAttribute('data-fx-text') || '').trim().toLowerCase();
    if (!KINDS[raw]) { return null; }

    var text = originalText(el);
    var item = {
      el: el,
      raw: raw,
      kind: state.reduced ? (REDUCED_MAP[raw] || 'fade') : raw,
      text: text,
      arr: toChars(text),
      once: el.hasAttribute('data-fx-once'),
      hadLabel: el.hasAttribute('aria-label'),
      active: false,
      done: false,
      hasRun: false,
      shown: -1,
      offState: false,
      t0: 0,
      chars: []
    };

    var fx = EFFECTS[item.kind];
    if (!fx) { return null; }
    try {
      fx.prepare(item);
      resetItem(item);
    } catch (e) {
      return null;
    }

    state.items.push(item);
    if (state.io) { state.io.observe(el); }
    return item;
  }

  /* Trả phần tử về nguyên trạng */
  function restore(item) {
    var el = item.el;
    var orig = el.getAttribute('data-fx-original');
    el.classList.remove('fx-t-glitch', 'fx-t-gradient', 'fx-t-neon',
                        'fx-t-neon-off', 'fx-t-persp', 'fx-t-explode');
    el.style.opacity = '';
    el.style.transform = '';
    el.style.backgroundPosition = '';
    el.style.color = '';
    if (item.displaySet) { el.style.display = ''; }
    if (!item.hadLabel) { el.removeAttribute('aria-label'); }
    if (orig !== null) {
      emptyEl(el);
      el.textContent = orig;
      el.removeAttribute('data-fx-original');
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. IntersectionObserver + listener
   * ------------------------------------------------------------------ */

  function onIntersect(entries) {
    var i, item;
    for (i = 0; i < entries.length; i++) {
      item = findItem(entries[i].target);
      if (!item) { continue; }
      if (entries[i].isIntersecting) {
        if (item.once && item.hasRun) {
          item.active = true;             /* tiếp tục, không phát lại từ đầu */
          ensureLoop();
        } else {
          resetItem(item);
          startItem(item);
        }
      } else {
        stopItem(item);
      }
    }
  }

  function onVisibility() {
    if (document.hidden) { stopLoop(); }
    else { ensureLoop(); }
  }

  function onResize() {
    var i;
    for (i = 0; i < state.items.length; i++) {
      state.items[i].measured = false;    /* explode đo lại */
      state.items[i].gw = 0;              /* gradient tính lại bề rộng */
    }
    ensureLoop();
  }

  function onPointerMove(e) {
    P.x = e.clientX;
    P.y = e.clientY;
    P.active = true;
    ensureLoop();
  }

  function onPointerOut(e) {
    if (e && e.relatedTarget) { return; }
    P.active = false;
    P.x = P.y = -99999;
    ensureLoop();
  }

  function ensurePointer() {
    if (state.pointerOn) { return; }
    state.pointerOn = true;
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    window.addEventListener('mouseout', onPointerOut, { passive: true });
    window.addEventListener('blur', onPointerOut, { passive: true });
  }

  function removePointer() {
    if (!state.pointerOn) { return; }
    state.pointerOn = false;
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseout', onPointerOut);
    window.removeEventListener('blur', onPointerOut);
  }

  /* ------------------------------------------------------------------ *
   * 9. Chèn / gỡ thẻ style
   * ------------------------------------------------------------------ */

  function injectStyle() {
    var found = document.getElementById(STYLE_ID);
    if (found) { state.styleEl = found; return; }
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
    state.styleEl = s;
  }

  function removeStyle() {
    var s = state.styleEl || document.getElementById(STYLE_ID);
    if (s && s.parentNode) { s.parentNode.removeChild(s); }
    state.styleEl = null;
  }

  /* ------------------------------------------------------------------ *
   * 10. Quét DOM
   * ------------------------------------------------------------------ */

  function scan(root) {
    if (!state.inited) { return 0; }
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) { return 0; }

    var n = 0;
    if (scope.nodeType === 1 && scope.hasAttribute &&
        scope.hasAttribute('data-fx-text')) {
      if (register(scope)) { n++; }
    }
    var list = scope.querySelectorAll('[data-fx-text]');
    var i;
    for (i = 0; i < list.length; i++) {
      if (register(list[i])) { n++; }
    }
    if (n) { ensureLoop(); }
    return n;
  }

  /* ------------------------------------------------------------------ *
   * 11. API
   * ------------------------------------------------------------------ */

  function realInit(opts) {
    if (state.inited) { scan(document); return; }

    var mq = null;
    try {
      mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch (e) { mq = null; }

    state.reduced = !!opts.reduced || !!(mq && mq.matches);
    state.inited = true;
    state.clock = 0;
    state.last = 0;

    injectStyle();

    if (typeof IntersectionObserver === 'function') {
      state.io = new IntersectionObserver(onIntersect, {
        root: null,
        rootMargin: '0px 0px -6% 0px',
        threshold: 0.1
      });
    } else {
      state.io = null;
    }

    document.addEventListener('visibilitychange', onVisibility, false);
    window.addEventListener('resize', onResize, { passive: true });

    scan(document);

    /* Không có IntersectionObserver (trình duyệt rất cũ) → chạy hết ngay */
    if (!state.io) {
      var i;
      for (i = 0; i < state.items.length; i++) { startItem(state.items[i]); }
    }
    ensureLoop();
  }

  var api = {
    /* Gọi 1 lần; an toàn khi gọi lại. Chạy được cả trước DOMContentLoaded. */
    init: function (opts) {
      opts = opts || {};
      if (document.readyState === 'loading') {
        if (state.deferred) { return; }
        state.deferred = function () {
          state.deferred = null;
          realInit(opts);
        };
        document.addEventListener('DOMContentLoaded', state.deferred, false);
        return;
      }
      realInit(opts);
    },

    /* Quét lại một nhánh DOM mới thêm vào (mặc định: cả document) */
    scan: function (root) {
      return scan(root);
    },

    /* Dọn dẹp: huỷ rAF, gỡ observer + listener, phục hồi DOM, gỡ thẻ style */
    destroy: function () {
      if (state.deferred) {
        document.removeEventListener('DOMContentLoaded', state.deferred, false);
        state.deferred = null;
      }
      stopLoop();

      if (state.io) { state.io.disconnect(); state.io = null; }

      document.removeEventListener('visibilitychange', onVisibility, false);
      window.removeEventListener('resize', onResize);
      removePointer();

      var i;
      for (i = 0; i < state.items.length; i++) {
        try { restore(state.items[i]); } catch (e) { /* bỏ qua */ }
      }
      state.items.length = 0;

      removeStyle();

      state.inited = false;
      state.reduced = false;
      state.clock = 0;
      state.last = 0;
      P.active = false;
      P.x = P.y = -99999;
    }
  };

  window.FX = window.FX || {};
  window.FX.text = api;
})();
