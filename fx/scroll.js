(function () {
  'use strict';

  /* =========================================================================
     FX.scroll — Toàn bộ hiệu ứng liên quan tới CUỘN TRANG cho trang "KHOA"
     -------------------------------------------------------------------------
     1. Thanh tiến trình đọc: dải neon cyan → hồng → tím, dày 4px, có quầng
        sáng, kèm chấm tròn phát sáng ở đầu mút.
     2. Reveal khi cuộn: up / left / right / zoom / flip / blur,
        hỗ trợ domino (data-fx-stagger) và lặp lại (data-fx-repeat).
     3. Parallax cuộn: [data-fx-scroll-parallax="<hệ số>"].
     4. Đếm số: [data-fx-count] — format nghìn kiểu Việt (1.234.567).
     5. Marquee: [data-fx-marquee] chạy ngang vô tận, liền mạch.
     6. Section snap-glow: [data-fx-section] nhận class is-active + phát
        sự kiện 'fx:section'.
     7. Nút "lên đầu trang" neon ở góc dưới phải.
     8. Đà cuộn: biến CSS --fx-scroll-vel (-1..1) + skewY cho [data-fx-skew].
     -------------------------------------------------------------------------
     • Vanilla JS thuần, không import / CDN / fetch — chạy được với file://
     • Chỉ MỘT vòng requestAnimationFrame, tự dừng khi tab bị ẩn.
     • Mọi listener scroll/resize đều {passive:true} và CHỈ set cờ.
     • z-index 40 theo CONTRACT.
     ========================================================================= */

  var STYLE_ID = 'fx-scroll-style';
  var BAR_ID = 'fx-scroll-bar';
  var TOP_ID = 'fx-scroll-top';

  var DEFAULT_Z = 40;
  var STAGGER_STEP = 90;      /* ms — độ lệch domino mặc định */
  var COUNT_DURATION = 1600;  /* ms — thời gian chạy số */
  var MARQUEE_SPEED = 60;     /* px/giây */
  var MARQUEE_HOVER = 0.25;   /* hover thì còn 25% tốc độ */
  var SKEW_MAX = 6;           /* độ nghiêng tối đa (deg) */
  var VEL_REF = 2000;         /* px/giây tương ứng đà cuộn = 1 */
  var SECTION_MIN = 0.5;      /* chiếm >= 50% chiều cao khung nhìn thì "active" */

  /* ---------------------------------------------------------------- state */

  var S = {
    inited: false,
    booted: false,
    reduced: false,
    zIndex: DEFAULT_Z,

    raf: 0,
    lastTime: 0,
    frame: 0,

    styleEl: null,
    bar: null,
    barFill: null,
    barDot: null,
    topBtn: null,

    ioReveal: null,
    ioCount: null,
    ioSection: null,

    parallax: [],
    skews: [],
    marquees: [],
    counters: [],
    sections: [],
    sectionVis: null,
    activeSection: null,

    seenReveal: null,
    seenParallax: null,
    seenSkew: null,
    seenCount: null,
    seenMarquee: null,
    seenSection: null,

    scrollDirty: true,
    resizeDirty: true,

    scrollY: 0,
    prevY: 0,
    vw: 0,
    vh: 0,
    docH: 1,

    progress: -1,
    vel: 0,
    velWritten: 99,
    topOn: false,

    onScroll: null,
    onResize: null,
    onVisibility: null,
    onTopClick: null,
    onDomReady: null
  };

  /* -------------------------------------------------------------- tiện ích */

  function prefersReduced() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function num(v) { v = parseFloat(v); return isFinite(v) ? v : 0; }

  function toArray(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  function qsa(root, sel) {
    if (!root || !root.querySelectorAll) return [];
    var out = toArray(root.querySelectorAll(sel));
    /* nếu chính root cũng khớp thì tính luôn */
    if (root.nodeType === 1 && root.matches && root.matches(sel)) out.unshift(root);
    return out;
  }

  function thresholds(n) {
    var a = [], i;
    for (i = 0; i <= n; i++) a.push(i / n);
    return a;
  }

  /* Định dạng số kiểu Việt Nam: 1.234.567 và phần thập phân dùng dấu phẩy */
  function formatVi(num, decimals) {
    var neg = num < 0;
    var n = Math.abs(num);
    var fixed = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
    var parts = fixed.split('.');
    var head = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + head + (parts[1] ? ',' + parts[1] : '');
  }

  /* Đọc số đích: chấp nhận "9999", "1.234.567", "12,5" */
  function parseTarget(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s/g, '');
    var cleaned, dec = 0, tail;
    if (s.indexOf(',') >= 0) {
      cleaned = s.replace(/\./g, '').replace(',', '.');
      tail = cleaned.split('.')[1];
      dec = tail ? tail.length : 0;
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      cleaned = s.replace(/\./g, '');
    } else {
      cleaned = s;
      tail = cleaned.split('.')[1];
      dec = tail ? tail.length : 0;
    }
    var v = parseFloat(cleaned);
    return { value: isFinite(v) ? v : 0, decimals: dec };
  }

  /* ------------------------------------------------------------------ CSS */

  function css() {
    var L = [];

    /* --- thanh tiến trình đọc --- */
    L.push('#' + BAR_ID + '{position:fixed;top:0;left:0;right:0;height:4px;' +
      'pointer-events:none;background:rgba(255,255,255,.045);overflow:visible;' +
      'contain:layout style}');
    L.push('#' + BAR_ID + ' .fx-sb-fill{position:absolute;top:0;left:0;height:100%;width:0;' +
      'background-image:linear-gradient(90deg,#22d3ee 0%,#22d3ee 12%,#f472b6 58%,#a78bfa 100%);' +
      'background-size:100vw 100%;background-repeat:no-repeat;border-radius:0 3px 3px 0;' +
      'box-shadow:0 0 10px rgba(34,211,238,.75),0 0 22px rgba(244,114,182,.5),' +
      '0 0 36px rgba(167,139,250,.35);will-change:width}');
    L.push('#' + BAR_ID + ' .fx-sb-dot{position:absolute;top:2px;left:0;width:12px;height:12px;' +
      'margin-left:-6px;border-radius:50%;opacity:0;' +
      'background:radial-gradient(circle at 50% 50%,#ffffff 0%,#f472b6 42%,rgba(167,139,250,0) 72%);' +
      'box-shadow:0 0 12px #f472b6,0 0 26px rgba(34,211,238,.7),0 0 44px rgba(167,139,250,.45);' +
      'transform:translate3d(0,-50%,0);will-change:transform;transition:opacity .35s ease}');
    L.push('#' + BAR_ID + '.is-on .fx-sb-dot{opacity:1}');

    /* --- nút lên đầu trang (ngoại lệ hợp lệ: pointer-events auto) --- */
    L.push('#' + TOP_ID + '{position:fixed;right:22px;bottom:22px;width:46px;height:46px;' +
      'margin:0;padding:0;display:flex;align-items:center;justify-content:center;' +
      'border:1px solid rgba(34,211,238,.55);border-radius:50%;cursor:pointer;' +
      'background:radial-gradient(circle at 50% 28%,rgba(34,211,238,.22),rgba(5,3,15,.88) 72%);' +
      'color:#22d3ee;opacity:0;pointer-events:none;' +
      'transform:translate3d(0,18px,0) scale(.9);' +
      'transition:opacity .35s ease,transform .35s cubic-bezier(.2,.85,.25,1),' +
      'box-shadow .35s ease,border-color .3s ease,color .3s ease;' +
      '-webkit-tap-highlight-color:transparent}');
    L.push('#' + TOP_ID + '.is-on{opacity:1;pointer-events:auto;transform:translate3d(0,0,0) scale(1);' +
      'box-shadow:0 0 14px rgba(34,211,238,.55),0 0 34px rgba(244,114,182,.28)}');
    L.push('#' + TOP_ID + ':hover{border-color:#f472b6;color:#f472b6;' +
      'box-shadow:0 0 18px rgba(244,114,182,.65),0 0 44px rgba(167,139,250,.38)}');
    L.push('#' + TOP_ID + ':focus-visible{outline:2px solid #a78bfa;outline-offset:3px}');
    L.push('#' + TOP_ID + ' .fx-arrow{display:block;width:13px;height:13px;' +
      'border-left:2px solid currentColor;border-top:2px solid currentColor;' +
      'transform:rotate(45deg) translate(2px,2px);' +
      'animation:fx-scroll-bob 1.6s ease-in-out infinite}');
    L.push('@keyframes fx-scroll-bob{0%,100%{transform:rotate(45deg) translate(2px,2px)}' +
      '50%{transform:rotate(45deg) translate(5px,5px)}}');

    /* --- reveal khi cuộn --- */
    L.push('[data-fx-reveal]{opacity:0;transform:translate3d(0,44px,0);' +
      'will-change:opacity,transform;' +
      'transition:opacity .85s cubic-bezier(.16,.84,.34,1),' +
      'transform .85s cubic-bezier(.16,.84,.34,1),filter .85s ease}');
    L.push('[data-fx-reveal="left"]{transform:translate3d(-60px,0,0)}');
    L.push('[data-fx-reveal="right"]{transform:translate3d(60px,0,0)}');
    L.push('[data-fx-reveal="zoom"]{transform:scale(.85)}');
    L.push('[data-fx-reveal="flip"]{transform:perspective(900px) rotateX(-70deg);' +
      'transform-origin:50% 100%;backface-visibility:hidden}');
    L.push('[data-fx-reveal="blur"]{transform:translate3d(0,18px,0);filter:blur(14px)}');
    L.push('[data-fx-reveal].fx-in{opacity:1;transform:none;filter:none}');

    /* --- marquee --- */
    L.push('[data-fx-marquee]{display:block;position:relative;overflow:hidden}');
    L.push('[data-fx-marquee] .fx-mq-track{display:flex;flex-wrap:nowrap;' +
      'width:max-content;will-change:transform}');
    L.push('[data-fx-marquee] .fx-mq-group{display:flex;flex-wrap:nowrap;' +
      'align-items:center;flex:0 0 auto}');

    /* --- skew theo đà cuộn --- */
    L.push('[data-fx-skew]{will-change:transform}');

    /* --- chế độ giảm chuyển động --- */
    if (S.reduced) {
      L.push('[data-fx-reveal]{transform:none !important;filter:none !important;' +
        'transition:opacity .45s linear !important}');
      L.push('[data-fx-skew]{transform:none !important;will-change:auto}');
      L.push('#' + TOP_ID + ' .fx-arrow{animation:none}');
      L.push('#' + BAR_ID + ' .fx-sb-dot{transition:none}');
    }

    return L.join('\n');
  }

  function injectStyle() {
    if (S.styleEl && S.styleEl.parentNode) return;
    var old = document.getElementById(STYLE_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.type = 'text/css';
    st.appendChild(document.createTextNode(css()));
    (document.head || document.documentElement).appendChild(st);
    S.styleEl = st;
  }

  /* ------------------------------------------------- phần tử module tự tạo */

  function buildBar() {
    var bar = document.getElementById(BAR_ID);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
    }
    bar.style.position = 'fixed';
    bar.style.pointerEvents = 'none';
    bar.style.zIndex = String(S.zIndex);
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '';

    var fill = document.createElement('div');
    fill.className = 'fx-sb-fill';
    var dot = document.createElement('div');
    dot.className = 'fx-sb-dot';
    bar.appendChild(fill);
    bar.appendChild(dot);

    document.body.appendChild(bar);
    S.bar = bar;
    S.barFill = fill;
    S.barDot = dot;
  }

  function buildTopButton() {
    var btn = document.getElementById(TOP_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = TOP_ID;
    }
    btn.setAttribute('type', 'button');
    btn.setAttribute('title', 'Lên đầu trang');
    btn.setAttribute('aria-label', 'Lên đầu trang');
    btn.style.position = 'fixed';
    btn.style.zIndex = String(S.zIndex);
    /* ngoại lệ hợp lệ theo đặc tả: đây là nút bấm thật */
    btn.style.pointerEvents = 'auto';
    btn.innerHTML = '<span class="fx-arrow" aria-hidden="true"></span>';

    S.onTopClick = function () {
      try {
        window.scrollTo({ top: 0, behavior: S.reduced ? 'auto' : 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    };
    btn.addEventListener('click', S.onTopClick, false);

    document.body.appendChild(btn);
    S.topBtn = btn;
  }

  /* ------------------------------------------------------------ 2. REVEAL */

  function revealDelay(el) {
    var parent = el.closest ? el.closest('[data-fx-stagger]') : null;
    if (!parent) return 0;
    var step = parseFloat(parent.getAttribute('data-fx-stagger'));
    if (!isFinite(step) || step <= 0) step = STAGGER_STEP;
    var kids = parent.querySelectorAll('[data-fx-reveal]');
    var i;
    for (i = 0; i < kids.length; i++) {
      if (kids[i] === el) return i * step;
    }
    return 0;
  }

  function showReveal(el) {
    var d = S.reduced ? 0 : revealDelay(el);
    el.style.transitionDelay = d > 0 ? (d + 'ms') : '';
    el.classList.add('fx-in');
  }

  function hideReveal(el) {
    el.style.transitionDelay = '';
    el.classList.remove('fx-in');
  }

  function onReveal(entries) {
    var i, e, el;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      el = e.target;
      if (e.isIntersecting) {
        showReveal(el);
        if (!el.hasAttribute('data-fx-repeat') && S.ioReveal) S.ioReveal.unobserve(el);
      } else if (el.hasAttribute('data-fx-repeat')) {
        hideReveal(el);
      }
    }
  }

  /* ------------------------------------------------------------- 4. ĐẾM SỐ */

  function paintCount(c, value) {
    c.el.textContent = c.prefix + formatVi(value, c.decimals) + c.suffix;
  }

  function startCount(c) {
    c.start = 0;      /* sẽ gán mốc thời gian ở frame kế tiếp */
    c.running = true;
    c.done = false;
  }

  function onCount(entries) {
    var i, e, c;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      c = e.target.__fxCount;
      if (!c) continue;
      if (e.isIntersecting) {
        if (S.reduced) {
          paintCount(c, c.target);
          c.done = true;
          c.running = false;
          if (S.ioCount) S.ioCount.unobserve(c.el);
        } else if (!c.running && (!c.done || c.el.hasAttribute('data-fx-repeat'))) {
          startCount(c);
          if (!c.el.hasAttribute('data-fx-repeat') && S.ioCount) S.ioCount.unobserve(c.el);
        }
      } else if (c.el.hasAttribute('data-fx-repeat')) {
        c.running = false;
        c.done = false;
        paintCount(c, 0);
      }
    }
  }

  /* ------------------------------------------------------------ 5. MARQUEE */

  function fitMarquee(m) {
    /* nhân bản nội dung cho đủ rộng rồi nhân đôi để vòng lặp không hở */
    if (m.cloneEl && m.cloneEl.parentNode) {
      m.cloneEl.parentNode.removeChild(m.cloneEl);
      m.cloneEl = null;
    }
    var boxW = m.el.clientWidth || S.vw || 1;
    var guard = 0;
    var seed = m.seed;
    var w = m.group.scrollWidth;
    while (w > 0 && w < boxW + 8 && guard < 24) {
      var k;
      for (k = 0; k < seed.length; k++) m.group.appendChild(seed[k].cloneNode(true));
      w = m.group.scrollWidth;
      guard++;
    }
    var clone = m.group.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    m.track.appendChild(clone);
    m.cloneEl = clone;
    m.width = w;
  }

  function buildMarquee(el) {
    var mode = (el.getAttribute('data-fx-marquee') || '').toLowerCase();
    var speed = parseFloat(el.getAttribute('data-fx-marquee-speed'));
    if (!isFinite(speed) || speed <= 0) speed = MARQUEE_SPEED;

    var original = [];
    var track = document.createElement('div');
    track.className = 'fx-mq-track';
    var group = document.createElement('div');
    group.className = 'fx-mq-group';

    while (el.firstChild) {
      original.push(el.firstChild);
      group.appendChild(el.firstChild);
    }
    track.appendChild(group);
    el.appendChild(track);

    var m = {
      el: el,
      track: track,
      group: group,
      cloneEl: null,
      original: original,
      seed: toArray(group.childNodes),
      reverse: mode === 'reverse',
      speed: speed,
      hover: false,
      offset: 0,
      width: 0,
      onEnter: null,
      onLeave: null
    };

    m.onEnter = function () { m.hover = true; };
    m.onLeave = function () { m.hover = false; };
    el.addEventListener('mouseenter', m.onEnter, { passive: true });
    el.addEventListener('mouseleave', m.onLeave, { passive: true });

    fitMarquee(m);
    if (m.reverse) m.offset = -m.width;
    return m;
  }

  function restoreMarquee(m) {
    if (m.onEnter) m.el.removeEventListener('mouseenter', m.onEnter, { passive: true });
    if (m.onLeave) m.el.removeEventListener('mouseleave', m.onLeave, { passive: true });
    if (m.track && m.track.parentNode) m.track.parentNode.removeChild(m.track);
    var i;
    for (i = 0; i < m.original.length; i++) m.el.appendChild(m.original[i]);
  }

  /* ------------------------------------------------------------ 6. SECTION */

  function setActiveSection(el) {
    if (S.activeSection === el) return;
    if (S.activeSection) S.activeSection.classList.remove('is-active');
    S.activeSection = el;
    if (!el) return;
    el.classList.add('is-active');
    var id = (el.getAttribute('data-fx-section') || '').trim() || el.id || '';
    try {
      document.dispatchEvent(new CustomEvent('fx:section', {
        detail: { el: el, id: id }
      }));
    } catch (e) { /* bỏ qua nếu trình duyệt quá cũ */ }
  }

  function onSection(entries) {
    var i, e, vh = window.innerHeight || 1;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var r = e.intersectionRect;
      var frac = e.isIntersecting && r ? (r.height / vh) : 0;
      S.sectionVis.set(e.target, frac);
    }
    var best = null, bestV = 0;
    for (i = 0; i < S.sections.length; i++) {
      var v = S.sectionVis.get(S.sections[i]) || 0;
      if (v > bestV) { bestV = v; best = S.sections[i]; }
    }
    if (best && bestV >= SECTION_MIN) setActiveSection(best);
  }

  /* --------------------------------------------------------------- QUÉT DOM */

  function scan(root) {
    if (!S.booted) return;
    root = root || document;
    var i, el;

    /* --- reveal --- */
    var rev = qsa(root, '[data-fx-reveal]');
    for (i = 0; i < rev.length; i++) {
      el = rev[i];
      if (S.seenReveal.has(el)) continue;
      S.seenReveal.add(el);
      if (S.ioReveal) S.ioReveal.observe(el);
      else showReveal(el);
    }

    /* --- parallax --- */
    var par = qsa(root, '[data-fx-scroll-parallax]');
    for (i = 0; i < par.length; i++) {
      el = par[i];
      if (S.seenParallax.has(el)) continue;
      S.seenParallax.add(el);
      var f = parseFloat(el.getAttribute('data-fx-scroll-parallax'));
      if (!isFinite(f)) f = 0.15;
      if (S.reduced) continue;              /* reduced: tắt parallax */
      el.style.willChange = 'transform';
      S.parallax.push({ el: el, factor: f, last: null });
    }

    /* --- skew theo đà cuộn --- */
    var sk = qsa(root, '[data-fx-skew]');
    for (i = 0; i < sk.length; i++) {
      el = sk[i];
      if (S.seenSkew.has(el)) continue;
      S.seenSkew.add(el);
      if (S.reduced) continue;              /* reduced: tắt skew */
      var mx = parseFloat(el.getAttribute('data-fx-skew'));
      if (!isFinite(mx) || mx <= 0) mx = SKEW_MAX;
      S.skews.push({ el: el, max: mx, last: 999 });
    }

    /* --- đếm số --- */
    var cnt = qsa(root, '[data-fx-count]');
    for (i = 0; i < cnt.length; i++) {
      el = cnt[i];
      if (S.seenCount.has(el)) continue;
      S.seenCount.add(el);
      var t = parseTarget(el.getAttribute('data-fx-count'));
      var c = {
        el: el,
        target: t.value,
        decimals: t.decimals,
        prefix: el.getAttribute('data-fx-count-prefix') || '',
        suffix: el.getAttribute('data-fx-count-suffix') || '',
        start: 0,
        running: false,
        done: false
      };
      el.__fxCount = c;
      S.counters.push(c);
      if (S.reduced || !S.ioCount) {
        paintCount(c, c.target);
        c.done = true;
      } else {
        paintCount(c, 0);
        S.ioCount.observe(el);
      }
    }

    /* --- marquee --- */
    var mq = qsa(root, '[data-fx-marquee]');
    for (i = 0; i < mq.length; i++) {
      el = mq[i];
      if (S.seenMarquee.has(el)) continue;
      S.seenMarquee.add(el);
      S.marquees.push(buildMarquee(el));
    }

    /* --- section --- */
    var sec = qsa(root, '[data-fx-section]');
    for (i = 0; i < sec.length; i++) {
      el = sec[i];
      if (S.seenSection.has(el)) continue;
      S.seenSection.add(el);
      S.sections.push(el);
      if (S.ioSection) S.ioSection.observe(el);
    }

    S.resizeDirty = true;
    return S.sections.length + S.parallax.length + S.counters.length;
  }

  /* ----------------------------------------------------------- ĐO ĐẠC / rAF */

  function measure() {
    S.vw = window.innerWidth || document.documentElement.clientWidth || 1;
    S.vh = window.innerHeight || document.documentElement.clientHeight || 1;
    measureDoc();
    var i;
    for (i = 0; i < S.marquees.length; i++) fitMarquee(S.marquees[i]);
    S.progress = -1;   /* buộc vẽ lại thanh tiến trình */
  }

  function measureDoc() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(
      num(d && d.scrollHeight),
      num(b && b.scrollHeight),
      num(d && d.offsetHeight),
      num(b && b.offsetHeight)
    );
    S.docH = Math.max(1, h - S.vh);
  }

  function tick(now) {
    S.raf = window.requestAnimationFrame(tick);

    var dt = S.lastTime ? (now - S.lastTime) / 1000 : 0.016;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 0.0001;
    S.lastTime = now;
    S.frame++;

    if (S.resizeDirty) { S.resizeDirty = false; measure(); }
    if (S.frame % 30 === 0) measureDoc();

    /* --- đọc scrollY ĐÚNG MỘT LẦN mỗi frame --- */
    if (S.scrollDirty) {
      S.scrollDirty = false;
      S.scrollY = window.pageYOffset ||
        (document.documentElement ? document.documentElement.scrollTop : 0) || 0;
    }
    var y = S.scrollY;

    /* --- 8. đà cuộn --- */
    var delta = y - S.prevY;
    S.prevY = y;
    var target = S.reduced ? 0 : clamp((delta / dt) / VEL_REF, -1, 1);
    var k = clamp(dt * 10, 0, 1);
    S.vel += (target - S.vel) * k;
    if (Math.abs(S.vel) < 0.001) S.vel = 0;

    var velR = Math.round(S.vel * 1000) / 1000;
    if (velR !== S.velWritten) {
      S.velWritten = velR;
      document.documentElement.style.setProperty('--fx-scroll-vel', String(velR));
    }

    /* --- 1. thanh tiến trình --- */
    var p = clamp(y / S.docH, 0, 1);
    var pr = Math.round(p * 2000) / 2000;
    if (pr !== S.progress) {
      S.progress = pr;
      if (S.barFill) S.barFill.style.width = (pr * 100).toFixed(3) + '%';
      if (S.barDot) S.barDot.style.transform =
        'translate3d(' + (pr * S.vw).toFixed(2) + 'px,-50%,0)';
      if (S.bar) {
        if (pr > 0.002) S.bar.classList.add('is-on');
        else S.bar.classList.remove('is-on');
      }
    }

    /* --- 7. nút lên đầu trang --- */
    var wantTop = y > S.vh;
    if (wantTop !== S.topOn && S.topBtn) {
      S.topOn = wantTop;
      if (wantTop) S.topBtn.classList.add('is-on');
      else S.topBtn.classList.remove('is-on');
    }

    /* --- 3. parallax --- */
    var i, it, v;
    for (i = 0; i < S.parallax.length; i++) {
      it = S.parallax[i];
      v = Math.round(y * it.factor * 100) / 100;
      if (v !== it.last) {
        it.last = v;
        it.el.style.transform = 'translate3d(0,' + v + 'px,0)';
      }
    }

    /* --- 8b. skewY theo đà cuộn --- */
    for (i = 0; i < S.skews.length; i++) {
      it = S.skews[i];
      v = Math.round(S.vel * it.max * 100) / 100;
      if (v !== it.last) {
        it.last = v;
        it.el.style.transform = v === 0 ? '' : 'skewY(' + v + 'deg)';
      }
    }

    /* --- 4. đếm số --- */
    for (i = 0; i < S.counters.length; i++) {
      var c = S.counters[i];
      if (!c.running) continue;
      if (!c.start) c.start = now;
      var t = clamp((now - c.start) / COUNT_DURATION, 0, 1);
      var eased = 1 - Math.pow(1 - t, 3);   /* ease-out cubic */
      paintCount(c, c.target * eased);
      if (t >= 1) { c.running = false; c.done = true; paintCount(c, c.target); }
    }

    /* --- 5. marquee --- */
    if (!S.reduced) {
      for (i = 0; i < S.marquees.length; i++) {
        var m = S.marquees[i];
        if (!m.width) {
          /* chưa đo được (font/ảnh về muộn, container đang ẩn) — thử lại định kỳ */
          if (S.frame % 30 === 0) fitMarquee(m);
          if (!m.width) continue;
          if (m.reverse) m.offset = -m.width;
        }
        var sp = m.speed * (m.hover ? MARQUEE_HOVER : 1);
        m.offset += (m.reverse ? sp : -sp) * dt;
        m.offset = m.offset % m.width;
        if (m.offset > 0) m.offset -= m.width;
        m.track.style.transform = 'translate3d(' + m.offset.toFixed(2) + 'px,0,0)';
      }
    }
  }

  function startLoop() {
    if (S.raf) return;
    S.lastTime = 0;
    S.scrollDirty = true;
    S.raf = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (!S.raf) return;
    window.cancelAnimationFrame(S.raf);
    S.raf = 0;
  }

  /* ------------------------------------------------------------- BOOT / API */

  function boot() {
    if (S.booted) return;
    if (!document.body) {   /* phòng hờ: body chưa có thì đợi thêm */
      window.setTimeout(boot, 16);
      return;
    }
    S.booted = true;

    S.sectionVis = new Map();
    S.seenReveal = new WeakSet();
    S.seenParallax = new WeakSet();
    S.seenSkew = new WeakSet();
    S.seenCount = new WeakSet();
    S.seenMarquee = new WeakSet();
    S.seenSection = new WeakSet();

    injectStyle();
    buildBar();
    buildTopButton();

    if (typeof window.IntersectionObserver === 'function') {
      S.ioReveal = new window.IntersectionObserver(onReveal, {
        threshold: 0.15,
        rootMargin: '0px 0px -6% 0px'
      });
      S.ioCount = new window.IntersectionObserver(onCount, { threshold: 0.3 });
      S.ioSection = new window.IntersectionObserver(onSection, {
        threshold: thresholds(20)
      });
    }

    S.onScroll = function () { S.scrollDirty = true; };
    S.onResize = function () { S.resizeDirty = true; S.scrollDirty = true; };
    S.onVisibility = function () {
      if (document.hidden) stopLoop();
      else { S.prevY = window.pageYOffset || 0; S.vel = 0; startLoop(); }
    };

    window.addEventListener('scroll', S.onScroll, { passive: true });
    window.addEventListener('resize', S.onResize, { passive: true });
    window.addEventListener('orientationchange', S.onResize, { passive: true });
    document.addEventListener('visibilitychange', S.onVisibility, false);

    S.prevY = window.pageYOffset || 0;
    S.scrollY = S.prevY;

    measure();
    scan(document);

    if (!document.hidden) startLoop();
  }

  function init(opts) {
    opts = opts || {};
    if (S.inited) { scan(document); return api; }
    S.inited = true;

    S.reduced = !!opts.reduced || prefersReduced();
    S.zIndex = (typeof opts.zIndex === 'number' && isFinite(opts.zIndex))
      ? opts.zIndex : DEFAULT_Z;

    if (document.readyState === 'loading') {
      S.onDomReady = function () {
        document.removeEventListener('DOMContentLoaded', S.onDomReady, false);
        S.onDomReady = null;
        boot();
      };
      document.addEventListener('DOMContentLoaded', S.onDomReady, false);
    } else {
      boot();
    }
    return api;
  }

  function destroy() {
    if (S.onDomReady) {
      document.removeEventListener('DOMContentLoaded', S.onDomReady, false);
      S.onDomReady = null;
    }

    stopLoop();

    if (S.onScroll) window.removeEventListener('scroll', S.onScroll, { passive: true });
    if (S.onResize) {
      window.removeEventListener('resize', S.onResize, { passive: true });
      window.removeEventListener('orientationchange', S.onResize, { passive: true });
    }
    if (S.onVisibility) document.removeEventListener('visibilitychange', S.onVisibility, false);
    S.onScroll = S.onResize = S.onVisibility = null;

    if (S.ioReveal) { S.ioReveal.disconnect(); S.ioReveal = null; }
    if (S.ioCount) { S.ioCount.disconnect(); S.ioCount = null; }
    if (S.ioSection) { S.ioSection.disconnect(); S.ioSection = null; }

    var i;
    for (i = 0; i < S.marquees.length; i++) restoreMarquee(S.marquees[i]);
    S.marquees.length = 0;

    for (i = 0; i < S.parallax.length; i++) {
      S.parallax[i].el.style.transform = '';
      S.parallax[i].el.style.willChange = '';
    }
    S.parallax.length = 0;

    for (i = 0; i < S.skews.length; i++) S.skews[i].el.style.transform = '';
    S.skews.length = 0;

    for (i = 0; i < S.counters.length; i++) {
      try { delete S.counters[i].el.__fxCount; } catch (e) { S.counters[i].el.__fxCount = null; }
    }
    S.counters.length = 0;

    for (i = 0; i < S.sections.length; i++) S.sections[i].classList.remove('is-active');
    S.sections.length = 0;
    S.activeSection = null;
    S.sectionVis = null;

    var revs = document.querySelectorAll('[data-fx-reveal]');
    for (i = 0; i < revs.length; i++) {
      revs[i].classList.remove('fx-in');
      revs[i].style.transitionDelay = '';
    }

    if (S.topBtn) {
      if (S.onTopClick) S.topBtn.removeEventListener('click', S.onTopClick, false);
      if (S.topBtn.parentNode) S.topBtn.parentNode.removeChild(S.topBtn);
    }
    S.topBtn = null;
    S.onTopClick = null;

    if (S.bar && S.bar.parentNode) S.bar.parentNode.removeChild(S.bar);
    S.bar = S.barFill = S.barDot = null;

    if (S.styleEl && S.styleEl.parentNode) S.styleEl.parentNode.removeChild(S.styleEl);
    S.styleEl = null;

    document.documentElement.style.removeProperty('--fx-scroll-vel');

    S.seenReveal = S.seenParallax = S.seenSkew = null;
    S.seenCount = S.seenMarquee = S.seenSection = null;

    S.progress = -1;
    S.velWritten = 99;
    S.vel = 0;
    S.topOn = false;
    S.frame = 0;
    S.booted = false;
    S.inited = false;
  }

  var api = {
    init: init,
    destroy: destroy,
    scan: function (root) { return scan(root || document); }
  };

  window.FX = window.FX || {};
  window.FX.scroll = api;
})();
