/* ════════════════════════════════════════════════════════════
   main.js — bộ điều phối
   Gắn kết 8 module hiệu ứng độc lập trong fx/ lại thành một trang.
   Nguyên tắc: mọi lời gọi sang FX.* đều phải phòng thủ — một module
   lỗi hoặc chưa load KHÔNG được làm chết cả trang.
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FX = (window.FX = window.FX || {});

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* bỏ qua */ }

  /* Gọi một hàm của module mà không sợ nổ. */
  function safe(obj, method) {
    var args = Array.prototype.slice.call(arguments, 2);
    try {
      if (obj && typeof obj[method] === 'function') return obj[method].apply(obj, args);
    } catch (err) {
      if (window.console && console.warn) console.warn('[FX] ' + method + ' lỗi:', err);
    }
    return undefined;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ══════════════ 1. KHỞI TẠO CÁC MODULE ══════════════ */

  var Z = {
    cosmos: 0, matrix: 1, scroll: 40,
    burst: 9000, audio: 9400, cursor: 9800
  };

  function bootModules() {
    var base = { reduced: REDUCED };
    function opts(z) { return { reduced: REDUCED, zIndex: z }; }

    safe(FX.cosmos, 'init', opts(Z.cosmos));
    safe(FX.matrix, 'init', opts(Z.matrix));
    safe(FX.text,   'init', base);
    safe(FX.tilt,   'init', base);
    safe(FX.scroll, 'init', opts(Z.scroll));
    // rung phần bọc nội dung, tuyệt đối không rung <body> (xem chú thích trong fx/burst.js)
    var burstOpts = opts(Z.burst);
    burstOpts.shakeTarget = document.getElementById('main');
    safe(FX.burst,  'init', burstOpts);
    safe(FX.cursor, 'init', opts(Z.cursor));
    safe(FX.audio,  'init', opts(Z.audio));

    // mưa Matrix nhẹ thôi, đừng át chữ
    safe(FX.matrix, 'setOpacity', REDUCED ? 0.14 : 0.3);

    var loaded = ['cosmos','matrix','text','tilt','scroll','burst','cursor','audio']
      .filter(function (k) { return FX[k]; });
    if (window.console && console.info) {
      console.info('%c KHOA ', 'background:#22d3ee;color:#05030f;font-weight:900;border-radius:4px',
        'đã nạp ' + loaded.length + '/8 module: ' + loaded.join(', '));
    }
  }

  /* ══════════════ 2. MÀN HÌNH KHỞI ĐỘNG ══════════════ */

  var BOOT_MSGS = [
    'Đang nạp độ đỉnh…',
    'Đang hiệu chỉnh nóc nhà…',
    'Đang nâng trần lên cho vừa…',
    'Đang thổi cho phấp phới…',
    'Đang đánh thức Khoa… (thất bại)',
    'Thôi kệ, vào luôn.'
  ];

  function runBoot(done) {
    var boot = $('#boot');
    var fill = $('#bootFill');
    var msg  = $('#bootMsg');
    if (!boot) { done(); return; }

    var pct = 0, i = 0;
    var timer = setInterval(function () {
      pct = Math.min(100, pct + 16 + Math.floor(pct * 0.06));
      if (fill) fill.style.width = pct + '%';
      i = Math.min(BOOT_MSGS.length - 1, Math.floor(pct / 100 * BOOT_MSGS.length));
      if (msg) msg.textContent = BOOT_MSGS[i];
      if (pct >= 100) {
        clearInterval(timer);
        setTimeout(function () {
          boot.classList.add('is-gone');
          setTimeout(function () { if (boot.parentNode) boot.parentNode.removeChild(boot); }, 800);
          done();
        }, 380);
      }
    }, 170);
  }

  /* ══════════════ 3. MÀU CHỦ ĐẠO THEO SECTION ══════════════ */

  var PALETTE = {
    'sec-hero':     ['#22d3ee', '#f472b6',   0],
    'sec-thong-so': ['#a78bfa', '#22d3ee',  40],
    'sec-ho-so':    ['#f472b6', '#a78bfa',  90],
    'sec-quote':    ['#fbbf24', '#f472b6', 140],
    'sec-timeline': ['#a3e635', '#22d3ee', 190],
    'sec-meter':    ['#22d3ee', '#fbbf24', 240],
    'sec-review':   ['#f472b6', '#22d3ee', 290],
    'sec-faq':      ['#a78bfa', '#f472b6', 330],
    'sec-finale':   ['#fbbf24', '#a78bfa', 360]
  };

  function applyTheme(id) {
    var p = PALETTE[id];
    if (!p) return;
    var r = document.documentElement;
    r.style.setProperty('--accent', p[0]);
    r.style.setProperty('--accent-2', p[1]);
    safe(FX.cosmos, 'setHue', p[2]);
    safe(FX.matrix, 'setColor', p[0]);
  }

  /* fx/scroll.js phát sự kiện này khi section chiếm phần lớn khung nhìn */
  document.addEventListener('fx:section', function (ev) {
    if (ev && ev.detail && ev.detail.id) applyTheme(ev.detail.id);
  });

  /* Dự phòng: nếu fx/scroll.js không load, tự theo dõi bằng IntersectionObserver */
  function themeFallback() {
    if (FX.scroll || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio > 0.4) applyTheme(en.target.id);
      });
    }, { threshold: [0.4, 0.7] });
    $$('[data-fx-section]').forEach(function (el) { io.observe(el); });
  }

  /* ══════════════ 4. ĐIỂM NỔ ══════════════ */

  function centerOf(el) {
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  var EMOJI = ['😎','🔥','💤','🧋','🏆','✨','💸','🫵','🎉','🥇','😴','🚀'];

  function celebrate(el, level) {
    var c = centerOf(el);
    if (level >= 2) {
      safe(FX.burst, 'megaBoom', c.x, c.y);
      safe(FX.audio, 'boom');
      safe(FX.cosmos, 'warp', 3);
      safe(FX.matrix, 'rave', 4000);
      safe(FX.burst, 'emojiRain', EMOJI, 5000);
    } else {
      safe(FX.burst, 'ring', c.x, c.y);
      safe(FX.burst, 'confetti', c.x, c.y, { count: 130 });
      safe(FX.burst, 'fireworks', window.innerWidth * (0.25 + Math.random() * 0.5), window.innerHeight * 0.3);
      safe(FX.burst, 'shake', 9, 420);
      safe(FX.audio, 'zap');
      safe(FX.cosmos, 'warp', 1.6);
    }
  }

  /* ══════════════ 5. GẮN SỰ KIỆN GIAO DIỆN ══════════════ */

  var BOOM_LINES = [
    'ĐỈNH NÓC!', 'KỊCH TRẦN!', 'BAY PHẤP PHỚI!', 'LEVEL MAX!',
    'KHÔNG CÓ CỬA!', 'CHÁY MÁY RỒI!', 'QUÁ ĐỈNH KHOA ƠI!'
  ];
  var boomIdx = 0;

  function wireUI() {
    /* nút hero */
    var btnBoom = $('#btnBoom');
    if (btnBoom) {
      btnBoom.addEventListener('click', function () {
        celebrate(btnBoom, 1);
        var c = centerOf(btnBoom);
        safe(FX.burst, 'floatText', BOOM_LINES[boomIdx % BOOM_LINES.length], c.x, c.y - 30);
        boomIdx++;
      });
    }

    /* nút chốt hạ */
    var btnMega = $('#btnMega');
    var counter = $('#clickCount');
    var clicks = 0;
    if (btnMega) {
      btnMega.addEventListener('click', function () {
        clicks++;
        if (counter) counter.textContent = String(clicks);
        celebrate(btnMega, 2);
        var c = centerOf(btnMega);
        var line = clicks === 1 ? 'ĐÚNG RỒI ĐÓ KHOA!' :
                   clicks < 5   ? 'VẪN LÀ KHOA!' :
                   clicks < 12  ? 'THÔI ĐỦ RỒI KHOA ƠI 😅' :
                                  'KHOA BẤM HOÀI VẬY TRỜI 💀';
        safe(FX.burst, 'floatText', line, c.x, c.y - 40);
      });
    }

    /* âm thanh khi rê chuột lên thứ bấm được */
    var soundable = 'a, button, summary, .meter__input, [data-fx-magnet], [data-cursor="grow"]';
    document.addEventListener('pointerover', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest(soundable)) safe(FX.audio, 'blip');
    }, { passive: true });

    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('a, button, summary')) safe(FX.audio, 'click');
    }, { passive: true });

    /* FAQ mở/đóng */
    $$('.faq details').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) {
          safe(FX.audio, 'whoosh');
          var c = centerOf(d);
          safe(FX.burst, 'confetti', c.x, c.y, { count: 18, spread: 1.2 });
        }
      });
    });

    /* phím tắt M — bật/tắt tiếng */
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.key === 'm' || ev.key === 'M') {
        safe(FX.audio, 'toggle');
      }
    });
  }

  /* ══════════════ 6. MÁY ĐO ĐỘ ĐỈNH ══════════════ */

  var METER_LABELS = [
    [0,   'Chưa có gì. Đang ngủ.'],
    [10,  'Bình thường như bao người'],
    [25,  'Ừ cũng được đó'],
    [40,  'Bắt đầu có mùi đỉnh'],
    [55,  'Đỉnh rồi đấy, khá lắm'],
    [70,  'ĐỈNH! Trần nhà bắt đầu rung'],
    [82,  'ĐỈNH NÓC! Ngói bay hết rồi'],
    [92,  'KỊCH TRẦN! Hàng xóm gọi công an'],
    [99,  'BAY PHẤP PHỚI TRONG VŨ TRỤ 🌌'],
    [100, '⚠️ MÁY ĐO ĐÃ NỔ. KHOA THẮNG.']
  ];

  function labelFor(v) {
    var out = METER_LABELS[0][1];
    for (var i = 0; i < METER_LABELS.length; i++) {
      if (v >= METER_LABELS[i][0]) out = METER_LABELS[i][1];
    }
    return out;
  }

  function wireMeter() {
    var input = $('#meterInput');
    var fill  = $('#meterFill');
    var value = $('#meterValue');
    var label = $('#meterLabel');
    if (!input) return;

    var maxedAt = 0;

    function render() {
      var v = clamp(parseInt(input.value, 10) || 0, 0, 100);
      if (fill)  fill.style.width = v + '%';
      if (value) value.textContent = String(v);
      if (label) label.textContent = labelFor(v);

      if (v >= 88) safe(FX.cosmos, 'warp', (v - 88) / 12 * 1.4);

      if (v === 100) {
        var now = (window.performance && performance.now) ? performance.now() : 0;
        if (now - maxedAt > 2500) {
          maxedAt = now;
          celebrate(input, 2);
          var c = centerOf(input);
          safe(FX.burst, 'floatText', 'KỊCH TRẦN THẬT RỒI!', c.x, c.y - 60);
        }
      }
    }

    input.addEventListener('input', render);
    render();
  }

  /* ══════════════ 7. PHẢN ỨNG VỚI EASTER EGG ══════════════ */

  document.addEventListener('fx:konami', function () {
    safe(FX.audio, 'boom');
    safe(FX.burst, 'emojiRain', ['🕺','💃','🪩','🔊','🎶','⚡'], 8000);
    safe(FX.burst, 'floatText', 'CHẾ ĐỘ RAVE — KHOA LÊN SÀN!',
      window.innerWidth / 2, window.innerHeight * 0.34);
  });

  document.addEventListener('fx:khoa', function () {
    safe(FX.audio, 'zap');
    safe(FX.cosmos, 'warp', 2);
    safe(FX.burst, 'confetti', window.innerWidth / 2, window.innerHeight / 2, { count: 160 });
  });

  /* ══════════════ 8. CHẠY ══════════════ */

  function start() {
    bootModules();
    themeFallback();
    wireUI();
    wireMeter();
    applyTheme('sec-hero');

    // chào một cái cho có không khí
    setTimeout(function () {
      safe(FX.cosmos, 'warp', 2.2);
      safe(FX.burst, 'confetti', window.innerWidth / 2, window.innerHeight * 0.42, { count: 70 });
    }, 420);
  }

  function onReady() {
    // ?skipboot=1 — bỏ qua màn khởi động (tiện cho dev và cho ảnh chụp tự động)
    var skip = false;
    try { skip = /(^|[?&])skipboot=1/.test(window.location.search); } catch (e) { /* bỏ qua */ }
    if (skip) {
      var b = $('#boot');
      if (b && b.parentNode) b.parentNode.removeChild(b);
      start();
      return;
    }
    runBoot(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
