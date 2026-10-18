/*!
 * fx/petal.js — Module "petal" cho trang "KHOA"
 * Hiệu ứng: cánh hoa anh đào rơi nhẹ nhàng
 * Đăng ký: window.FX.petal
 * Vanilla JS thuần, chạy được bằng file://
 */
(function () {
  'use strict';

  var Z_INDEX = 5; /* giữa matrix (1) và scroll (40), không chặn nội dung */
  var MAX_PETALS = 80;
  var PETAL_SIZE = 14;

  var canvas = null;
  var ctx = null;
  var rafId = 0;
  var running = false;
  var lastT = 0;
  var petals = [];
  var dpr = 1;
  var W = 0;
  var H = 0;
  var reduced = false;
  var inited = false;
  var mounted = false;
  var styleInjected = false;

  var boundResize = null;
  var boundVis = null;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function createPetal() {
    return {
      x: rand(0, W),
      y: rand(-H * 0.5, 0),
      r: rand(2, PETAL_SIZE),
      vx: rand(-0.4, 0.8),
      vy: rand(0.4, 1.2),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.02, 0.02),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.5, 1.2)
    };
  }

  function recalcDensity() {
    var mobile = (window.innerWidth || 0) < 700;
    var count = reduced ? Math.round(MAX_PETALS * 0.15) : (mobile ? Math.round(MAX_PETALS * 0.4) : MAX_PETALS);
    petals.length = 0;
    for (var i = 0; i < count; i++) {
      petals.push(createPetal());
    }
  }

  function resize() {
    if (!canvas) return;
    W = window.innerWidth || document.documentElement.clientWidth || 1;
    H = window.innerHeight || document.documentElement.clientHeight || 1;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    recalcDensity();
  }

  function mount() {
    if (mounted || !canvas) return;
    var host = document.body || document.documentElement;
    if (!host) return;
    host.appendChild(canvas);
    mounted = true;
  }

  function drawPetal(p) {
    var x = p.x;
    var y = p.y;
    var r = p.r;
    var rot = p.rot;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.3, r, 0);
    ctx.quadraticCurveTo(r * 0.5, r * 0.3, 0, 0);
    var grad = ctx.createRadialGradient(0, 0, 0, r * 0.3, -r * 0.2, r);
    grad.addColorStop(0, 'rgba(244, 114, 182, 0.9)');
    grad.addColorStop(1, 'rgba(167, 139, 250, 0.4)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.restore();
  }

  function update(dt) {
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.phase += dt * 0.002;
      p.x += p.vx * dt * 0.03 + Math.sin(p.phase) * 0.3;
      p.y += p.vy * dt * 0.06 * p.speed;
      p.rot += p.vr * dt * 0.01;
      if (p.y > H + p.r * 2) {
        p.y = rand(-p.r * 2, -p.r);
        p.x = rand(0, W);
      }
      if (p.x < -p.r * 2) {
        p.x = W + p.r;
      }
      if (p.x > W + p.r * 2) {
        p.x = -p.r;
      }
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < petals.length; i++) {
      drawPetal(petals[i]);
    }
  }

  function loop(ts) {
    if (!running) return;
    if (document.hidden) {
      rafId = window.requestAnimationFrame(loop);
      lastT = ts;
      return;
    }
    if (lastT === 0) lastT = ts;
    var dt = ts - lastT;
    lastT = ts;
    dt = clamp(dt, 0, 1000 / 15);
    update(dt);
    render();
    rafId = window.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = window.requestAnimationFrame(loop);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function init(opts) {
    opts = opts || {};
    if (inited) return;
    reduced = opts.reduced === true || false;
    try {
      reduced = reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function once() {
        document.removeEventListener('DOMContentLoaded', once, false);
        init(opts);
      }, false);
      return;
    }

    inited = true;

    canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(Z_INDEX);
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d');

    boundResize = function () { resize(); };
    boundVis = function () {
      if (document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    mount();
    resize();
    recalcDensity();
    window.addEventListener('resize', boundResize, false);
    document.addEventListener('visibilitychange', boundVis, false);
    startLoop();
  }

  function destroy() {
    if (!inited) return;
    stopLoop();
    window.removeEventListener('resize', boundResize, false);
    document.removeEventListener('visibilitychange', boundVis, false);
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    canvas = null;
    ctx = null;
    petals.length = 0;
    inited = false;
    mounted = false;
  }

  var api = {
    init: init,
    destroy: destroy
  };

  window.FX = window.FX || {};
  window.FX.petal = api;
})();
