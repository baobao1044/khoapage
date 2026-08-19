/*!
 * fx/audio.js — Module âm thanh + visualizer cho trang "KHOA"
 * Đăng ký: window.FX.audio   |   z-index: 9400
 *
 * TOÀN BỘ âm thanh được tổng hợp bằng Web Audio API ngay trong trình duyệt:
 * không có file mp3, không tải bất cứ thứ gì từ bên ngoài, chạy được với file://
 *
 * QUY TẮC VÀNG: mặc định TẮT TIẾNG. AudioContext chỉ được khởi tạo sau cử chỉ
 * đầu tiên của người dùng (đúng chính sách autoplay của trình duyệt).
 */
(function () {
  'use strict';

  /* ==========================================================================
   * 0. Hằng số & bảng màu (theo CONTRACT §6)
   * ====================================================================== */

  var Z_DEFAULT = 9400;
  var STORE_KEY = 'fx-audio-on';

  var C_CYAN = '#22d3ee';
  var C_PINK = '#f472b6';
  var C_VIOLET = '#a78bfa';
  var C_AMBER = '#fbbf24';

  var BAND_H = 90;          // chiều cao dải visualizer (px CSS)
  var BPM = 92;             // nhịp synthwave
  var LOOKAHEAD_MS = 25;    // chu kỳ gọi scheduler
  var SCHEDULE_AHEAD = 0.1; // nhìn trước 100ms
  var MASTER_DEFAULT = 0.18;

  /* Vòng hợp âm Am – F – C – G.
   * root: nốt bass (số MIDI), chord: hợp âm cho pad, arp: nốt cho arpeggio. */
  var PROG = [
    { root: 45, chord: [57, 60, 64], arp: [69, 72, 76, 81] }, // Am
    { root: 41, chord: [53, 57, 60], arp: [65, 69, 72, 77] }, // F
    { root: 48, chord: [60, 64, 67], arp: [72, 76, 79, 84] }, // C
    { root: 43, chord: [55, 59, 62], arp: [67, 71, 74, 79] }  // G
  ];

  /* ==========================================================================
   * 1. Trạng thái module
   * ====================================================================== */

  var inited = false;
  var reduced = false;
  var zIndex = Z_DEFAULT;

  var on = false;           // tiếng đã thực sự bật hay chưa
  var volume = MASTER_DEFAULT;

  var ctx = null;           // AudioContext (tạo lười)
  var master = null, comp = null, analyser = null;
  var busMusic = null, busSfx = null, convolver = null, wetGain = null;
  var padFilter = null, padGain = null, bassGain = null, arpGain = null, drumBus = null;
  var lfoSlow = null, lfoFast = null;
  var noiseBuf = null;
  var freqData = null;

  var schedTimer = 0;
  var nextStepTime = 0;
  var stepIndex = 0;
  var stepDur = 0;
  var barDur = 0;

  var canvas = null, cv = null, btn = null, styleEl = null;
  var rafId = 0;
  var dpr = 1, cw = 0, ch = 0;
  var bars = [], peaks = [];
  var bassSmooth = 0, bassWritten = -1;
  var idlePhase = 0;
  var lastBlip = 0;
  var suspendTimer = 0;
  var autoEnabledAt = 0;   // mốc thời gian tự bật theo cử chỉ đầu tiên

  var armEvents = ['pointerdown', 'keydown', 'touchstart'];

  /* ==========================================================================
   * 2. Tiện ích nhỏ
   * ====================================================================== */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function readPref() {
    try { return window.localStorage.getItem(STORE_KEY) === '1'; }
    catch (e) { return false; }
  }

  function writePref(v) {
    try { window.localStorage.setItem(STORE_KEY, v ? '1' : '0'); }
    catch (e) { /* file:// hoặc chế độ riêng tư có thể chặn — bỏ qua */ }
  }

  function isRunning() {
    return !!(on && ctx && ctx.state === 'running');
  }

  /* ==========================================================================
   * 3. Đồ hoạ: style, nút bật/tắt, canvas visualizer
   * ====================================================================== */

  var CSS_TEXT = [
    '.fx-audio-btn{',
    'position:fixed;left:18px;bottom:18px;width:52px;height:52px;',
    'display:flex;align-items:center;justify-content:center;',
    'margin:0;padding:0;border:1px solid rgba(34,211,238,.45);border-radius:50%;',
    'background:radial-gradient(circle at 35% 30%,rgba(34,211,238,.20),rgba(5,3,15,.86) 70%);',
    'color:' + C_CYAN + ';cursor:pointer;pointer-events:auto;',
    '-webkit-tap-highlight-color:transparent;',
    'box-shadow:0 0 14px rgba(34,211,238,.35),inset 0 0 12px rgba(34,211,238,.12);',
    'transition:color .25s,border-color .25s,box-shadow .25s,transform .18s;}',
    '.fx-audio-btn:hover{transform:translateY(-2px);',
    'box-shadow:0 0 22px rgba(34,211,238,.55),inset 0 0 16px rgba(244,114,182,.18);}',
    '.fx-audio-btn:focus-visible{outline:2px solid ' + C_AMBER + ';outline-offset:3px;}',
    '.fx-audio-btn svg{width:24px;height:24px;display:block;pointer-events:none;',
    'filter:drop-shadow(0 0 5px currentColor);}',
    '.fx-audio-btn.is-on{color:' + C_PINK + ';border-color:rgba(244,114,182,.65);',
    'box-shadow:0 0 20px rgba(244,114,182,.5),inset 0 0 16px rgba(167,139,250,.22);}',
    '.fx-audio-btn.is-armed{border-color:rgba(167,139,250,.55);}',
    '.fx-audio-ring{position:absolute;inset:-4px;border-radius:50%;',
    'border:1px solid rgba(244,114,182,.6);opacity:0;pointer-events:none;}',
    '.fx-audio-btn.is-on .fx-audio-ring{animation:fx-audio-pulse 1.6s ease-out infinite;}',
    '.fx-audio-btn.is-reduced .fx-audio-ring{animation:none;opacity:.35;}',
    '@keyframes fx-audio-pulse{',
    '0%{opacity:.75;transform:scale(.92);}',
    '70%{opacity:0;transform:scale(1.45);}',
    '100%{opacity:0;transform:scale(1.45);}}',
    '@media (prefers-reduced-motion: reduce){',
    '.fx-audio-btn{transition:none;}',
    '.fx-audio-btn.is-on .fx-audio-ring{animation:none;opacity:.35;}}'
  ].join('');

  var ICON_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.2v5.6h3.4L12.6 19V5L7.4 9.2H4z" fill="currentColor"/>' +
    '<path d="M15.9 8.7a4.7 4.7 0 0 1 0 6.6" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M18.6 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round"/></svg>';

  var ICON_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M4 9.2v5.6h3.4L12.6 19V5L7.4 9.2H4z" fill="currentColor"/>' +
    '<path d="M16.4 9.4l5.2 5.2M21.6 9.4l-5.2 5.2" fill="none" stroke="currentColor"' +
    ' stroke-width="1.7" stroke-linecap="round"/></svg>';

  function buildStyle() {
    styleEl = document.createElement('style');
    styleEl.id = 'fx-audio-style';
    styleEl.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function buildCanvas() {
    canvas = document.createElement('canvas');
    canvas.id = 'fx-audio-canvas';
    /* Dải ngang ở đáy màn hình — KHÔNG chặn click/scroll (CONTRACT §4) */
    canvas.style.position = 'fixed';
    canvas.style.left = '0';
    canvas.style.right = '0';
    canvas.style.bottom = '0';
    canvas.style.top = 'auto';
    canvas.style.width = '100%';
    canvas.style.height = BAND_H + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(zIndex);
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    cv = canvas.getContext('2d');
  }

  function buildButton() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fx-audio-btn' + (reduced ? ' is-reduced' : '');
    btn.style.zIndex = String(zIndex);
    btn.innerHTML = '<span class="fx-audio-ring"></span>' + ICON_OFF;
    btn.addEventListener('click', onBtnClick, false);
    btn.addEventListener('mouseenter', onBtnHover, false);
    document.body.appendChild(btn);
    syncButton();
  }

  function syncButton() {
    if (!btn) return;
    var ring = btn.querySelector('.fx-audio-ring');
    btn.innerHTML = '';
    if (!ring) {
      ring = document.createElement('span');
      ring.className = 'fx-audio-ring';
    }
    btn.appendChild(ring);
    btn.insertAdjacentHTML('beforeend', on ? ICON_ON : ICON_OFF);

    var armed = !on && readPref();
    btn.className = 'fx-audio-btn' + (on ? ' is-on' : '') +
      (armed ? ' is-armed' : '') + (reduced ? ' is-reduced' : '');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on
      ? 'Tắt âm thanh nền'
      : (armed ? 'Bật lại âm thanh nền (chạm để phát)' : 'Bật âm thanh nền');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }

  function onBtnClick(e) {
    if (e && e.preventDefault) e.preventDefault();
    disarm();
    api.toggle();
    if (on) api.click();
  }

  function onBtnHover() { api.blip(); }

  /* ==========================================================================
   * 4. Khởi tạo AudioContext (LƯỜI — chỉ sau cử chỉ người dùng)
   * ====================================================================== */

  function makeNoiseBuffer() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* Impulse response TỰ SINH: nhiễu trắng suy giảm theo hàm mũ → reverb */
  function makeImpulse(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * seconds));
    var imp = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = imp.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.15);
      }
    }
    return imp;
  }

  function ensureCtx() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }

    /* --- Bus chính --- */
    master = ctx.createGain();
    master.gain.value = volume;

    comp = ctx.createDynamicsCompressor();
    try {
      comp.threshold.value = -16;
      comp.knee.value = 24;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
    } catch (e) { /* một số trình duyệt cũ không cho set — bỏ qua */ }

    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = reduced ? 0.88 : 0.76;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    /* --- Reverb tự sinh --- */
    convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.4, 2.8);
    wetGain = ctx.createGain();
    wetGain.gain.value = 0.9;
    convolver.connect(wetGain);
    wetGain.connect(master);

    /* --- Bus nhạc nền / hiệu ứng --- */
    busMusic = ctx.createGain();
    busMusic.gain.value = 0.0001;   // sẽ dâng lên khi startMusic()
    busMusic.connect(master);

    busSfx = ctx.createGain();
    busSfx.gain.value = 0.9;
    busSfx.connect(master);
    send(busSfx, 0.22);

    /* --- Pad hợp âm: saw → lowpass có LFO quét (wobble synthwave) --- */
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 760;
    padFilter.Q.value = 7;

    padGain = ctx.createGain();
    padGain.gain.value = 0.5;
    padFilter.connect(padGain);
    padGain.connect(busMusic);
    send(padGain, 0.4);

    lfoSlow = ctx.createOscillator();
    lfoSlow.type = 'sine';
    lfoSlow.frequency.value = 0.085;
    var lfoSlowAmt = ctx.createGain();
    lfoSlowAmt.gain.value = 620;
    lfoSlow.connect(lfoSlowAmt);
    lfoSlowAmt.connect(padFilter.frequency);
    lfoSlow.start();

    lfoFast = ctx.createOscillator();
    lfoFast.type = 'triangle';
    lfoFast.frequency.value = 2.9;
    var lfoFastAmt = ctx.createGain();
    lfoFastAmt.gain.value = 130;
    lfoFast.connect(lfoFastAmt);
    lfoFastAmt.connect(padFilter.frequency);
    lfoFast.start();

    /* --- Bass / arp / trống --- */
    bassGain = ctx.createGain();
    bassGain.gain.value = 0.55;
    bassGain.connect(busMusic);

    arpGain = ctx.createGain();
    arpGain.gain.value = 0.34;
    arpGain.connect(busMusic);
    send(arpGain, 0.3);

    drumBus = ctx.createGain();
    drumBus.gain.value = 0.5;
    drumBus.connect(busMusic);
    send(drumBus, 0.12);

    noiseBuf = makeNoiseBuffer();

    stepDur = 60 / BPM / 4;   // nốt móc kép
    barDur = stepDur * 16;

    return true;
  }

  /* Nhánh gửi tới reverb */
  function send(node, amount) {
    var g = ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(convolver);
    return g;
  }

  /* ==========================================================================
   * 5. Nhạc cụ tổng hợp
   * ====================================================================== */

  function autoClean(node) {
    node.onended = function () { try { node.disconnect(); } catch (e) {} };
  }

  function noiseAt(t, dur) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    var off = Math.random() * Math.max(0.01, noiseBuf.duration - 0.5);
    s.start(t, off);
    s.stop(t + dur + 0.02);
    autoClean(s);
    return s;
  }

  /* Pad hợp âm: 2 saw lệch nhau vài cent cho mỗi nốt */
  function playPad(t, notes, dur) {
    for (var i = 0; i < notes.length; i++) {
      var f = midiToFreq(notes[i]);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.35);
      g.gain.setValueAtTime(0.10, t + dur * 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(padFilter);
      for (var d = -1; d <= 1; d += 2) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        o.detune.setValueAtTime(d * 9, t);
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.06);
        autoClean(o);
      }
    }
  }

  /* Bass: triangle + sine phụ, qua lowpass */
  function playBass(t, midi, dur) {
    var f = midiToFreq(midi);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    lp.Q.value = 3;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    lp.connect(g);
    g.connect(bassGain);

    var o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(f, t);
    o1.connect(lp);
    o1.start(t); o1.stop(t + dur + 0.03);
    autoClean(o1);

    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 0.5, t);
    var g2 = ctx.createGain();
    g2.gain.value = 0.55;
    o2.connect(g2); g2.connect(lp);
    o2.start(t); o2.stop(t + dur + 0.03);
    autoClean(o2);
  }

  /* Arpeggio square nhẹ ở quãng trên */
  function playArp(t, midi) {
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(midiToFreq(midi), t);
    o.detune.setValueAtTime(-4, t);

    var bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 420;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    o.connect(bp); bp.connect(g); g.connect(arpGain);
    o.start(t); o.stop(t + 0.24);
    autoClean(o);
  }

  /* Kick: sine tụt tần số rất nhanh + envelope */
  function playKick(t) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.10);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    o.connect(g); g.connect(drumBus);
    o.start(t); o.stop(t + 0.36);
    autoClean(o);
  }

  /* Snare: noise qua bandpass + một chút thân trống */
  function playSnare(t) {
    var n = noiseAt(t, 0.2);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 0.8;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp); bp.connect(ng); ng.connect(drumBus);

    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(198, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.25, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(og); og.connect(drumBus);
    o.start(t); o.stop(t + 0.13);
    autoClean(o);
  }

  /* Hi-hat: noise qua highpass, envelope cực ngắn */
  function playHat(t, level, dur) {
    var n = noiseAt(t, dur);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7600;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(drumBus);
  }

  /* ==========================================================================
   * 6. Look-ahead scheduler (KHÔNG dùng setTimeout để chốt thời điểm nốt)
   * ====================================================================== */

  function scheduleStep(i, t) {
    var stepInBar = i % 16;
    var bar = Math.floor(i / 16);
    var ch = PROG[bar % PROG.length];

    /* Pad: một lần mỗi ô nhịp */
    if (stepInBar === 0) playPad(t, ch.chord, barDur * 0.95);

    /* Bass + arp: nốt móc đơn (8th) */
    if (stepInBar % 2 === 0) {
      var eighth = stepInBar / 2;
      var oct = (stepInBar === 6 || stepInBar === 14) ? 12 : 0;
      playBass(t, ch.root + oct, stepDur * 1.75);

      var seq = ch.arp;
      var k = eighth % seq.length;
      var idx = (bar % 2 === 0) ? k : (seq.length - 1 - k);
      playArp(t, seq[idx]);
    }

    /* Trống 4/4 */
    if (stepInBar === 0 || stepInBar === 8 || (stepInBar === 14 && bar % 2 === 1)) playKick(t);
    if (stepInBar === 4 || stepInBar === 12) playSnare(t);
    if (stepInBar % 2 === 0) playHat(t, stepInBar % 8 === 0 ? 0.11 : 0.06, 0.035);
    if (stepInBar === 7 || stepInBar === 15) playHat(t, 0.05, 0.028);
  }

  function scheduler() {
    if (!ctx || !on) return;
    var horizon = ctx.currentTime + SCHEDULE_AHEAD;
    var guard = 0;
    while (nextStepTime < horizon && guard++ < 64) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepDur;
      stepIndex++;
    }
  }

  function startMusic() {
    if (!ctx || schedTimer) return;
    var now = ctx.currentTime;
    nextStepTime = now + 0.08;
    busMusic.gain.cancelScheduledValues(now);
    busMusic.gain.setValueAtTime(Math.max(0.0001, busMusic.gain.value), now);
    busMusic.gain.exponentialRampToValueAtTime(1, now + 1.2);
    scheduler();
    schedTimer = window.setInterval(scheduler, LOOKAHEAD_MS);
  }

  function stopMusic(fade) {
    if (schedTimer) { window.clearInterval(schedTimer); schedTimer = 0; }
    if (ctx && busMusic) {
      var now = ctx.currentTime;
      busMusic.gain.cancelScheduledValues(now);
      busMusic.gain.setValueAtTime(Math.max(0.0001, busMusic.gain.value), now);
      busMusic.gain.exponentialRampToValueAtTime(0.0001, now + (fade || 0.3));
    }
  }

  /* ==========================================================================
   * 7. Hiệu ứng âm thanh UI (im lặng hoàn toàn nếu chưa bật tiếng)
   * ====================================================================== */

  function sfxBlip() {
    if (!isRunning()) return;
    var now = Date.now();
    if (now - lastBlip < 45) return;   // chống spam khi rê chuột
    lastBlip = now;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1180, t);
    o.frequency.exponentialRampToValueAtTime(1880, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(busSfx);
    o.start(t); o.stop(t + 0.11);
    autoClean(o);
  }

  function sfxClick() {
    if (!isRunning()) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(860, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.045);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(busSfx);
    o.start(t); o.stop(t + 0.09);
    autoClean(o);

    var n = noiseAt(t, 0.03);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2600;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(hp); hp.connect(ng); ng.connect(busSfx);
  }

  function sfxWhoosh() {
    if (!isRunning()) return;
    var t = ctx.currentTime;
    var dur = 0.55;
    var n = noiseAt(t, dur);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + dur * 0.7);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(busSfx);
  }

  function sfxBoom() {
    if (!isRunning()) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.85);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(busSfx);
    o.start(t); o.stop(t + 1.15);
    autoClean(o);

    /* Lớp nhiễu trầm cho "thân" tiếng nổ */
    var n = noiseAt(t, 0.7);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(lp); lp.connect(ng); ng.connect(busSfx);
  }

  function sfxZap() {
    if (!isRunning()) return;
    var t = ctx.currentTime;
    var dur = 0.2;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(90, t + dur);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(busSfx);
    o.start(t); o.stop(t + dur + 0.02);
    autoClean(o);

    var n = noiseAt(t, 0.12);
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3400;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(hp); hp.connect(ng); ng.connect(busSfx);
  }

  /* ==========================================================================
   * 8. Visualizer
   * ====================================================================== */

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, window.innerWidth);
    cw = w;
    ch = BAND_H;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(BAND_H * dpr);
    canvas.style.height = BAND_H + 'px';
    if (cv) cv.setTransform(dpr, 0, 0, dpr, 0, 0);

    var maxBars = reduced ? 30 : 64;
    if (w < 700) maxBars = Math.round(maxBars * 0.55);   // mobile: nhẹ hơn
    var n = clamp(Math.floor(w / 15), 12, maxBars);
    if (n !== bars.length) {
      bars = new Array(n);
      peaks = new Array(n);
      for (var i = 0; i < n; i++) { bars[i] = 0; peaks[i] = 0; }
    }
  }

  function setBassVar(v) {
    var r = Math.round(v * 100) / 100;
    if (r === bassWritten) return;
    bassWritten = r;
    try { document.documentElement.style.setProperty('--fx-bass', String(r)); }
    catch (e) {}
  }

  function drawIdle() {
    /* Khi tắt tiếng: đường sóng phẳng dao động rất nhẹ, không biến mất */
    idlePhase += reduced ? 0.006 : 0.016;
    var y0 = ch * 0.62;
    var amp = reduced ? 2 : 5;
    var steps = 64;

    cv.lineWidth = 1.4;
    cv.strokeStyle = 'rgba(34,211,238,' + (reduced ? 0.28 : 0.4) + ')';
    if (!reduced) { cv.shadowBlur = 8; cv.shadowColor = C_CYAN; }
    cv.beginPath();
    for (var i = 0; i <= steps; i++) {
      var x = (i / steps) * cw;
      var y = y0 + Math.sin(i * 0.42 + idlePhase * 2.1) * amp *
        (0.55 + 0.45 * Math.sin(i * 0.11 + idlePhase));
      if (i === 0) cv.moveTo(x, y); else cv.lineTo(x, y);
    }
    cv.stroke();
    cv.shadowBlur = 0;

    /* Bóng phản chiếu mờ ở nửa dưới */
    cv.globalAlpha = 0.18;
    cv.strokeStyle = C_PINK;
    cv.beginPath();
    for (var j = 0; j <= steps; j++) {
      var x2 = (j / steps) * cw;
      var y2 = y0 + 10 - Math.sin(j * 0.42 + idlePhase * 2.1) * amp * 0.5;
      if (j === 0) cv.moveTo(x2, y2); else cv.lineTo(x2, y2);
    }
    cv.stroke();
    cv.globalAlpha = 1;

    /* Không có tín hiệu thật → đưa --fx-bass về 0 một cách mượt */
    bassSmooth *= 0.9;
    setBassVar(bassSmooth);
  }

  function drawSpectrum() {
    analyser.getByteFrequencyData(freqData);

    var n = bars.length;
    var binMax = Math.min(freqData.length, 150);
    var y0 = ch * 0.62;
    var topH = y0 - 4;
    var gap = 2;
    var bw = Math.max(2, (cw - gap * (n - 1)) / n);

    /* Năng lượng bass → biến CSS --fx-bass */
    var b = 0;
    for (var k = 1; k <= 6; k++) b += freqData[k];
    b = (b / 6) / 255;
    bassSmooth += (b - bassSmooth) * 0.22;
    setBassVar(clamp(bassSmooth, 0, 1));

    var grad = cv.createLinearGradient(0, y0, 0, y0 - topH);
    grad.addColorStop(0, C_CYAN);
    grad.addColorStop(0.55, C_VIOLET);
    grad.addColorStop(1, C_PINK);

    var mirror = cv.createLinearGradient(0, y0, 0, ch);
    mirror.addColorStop(0, 'rgba(244,114,182,.34)');
    mirror.addColorStop(1, 'rgba(34,211,238,0)');

    if (!reduced) { cv.shadowBlur = 10; cv.shadowColor = 'rgba(34,211,238,.55)'; }

    for (var i = 0; i < n; i++) {
      /* Ánh xạ log: dải thấp chi tiết hơn dải cao */
      var f0 = Math.floor(Math.pow(i / n, 1.7) * binMax);
      var f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * binMax));
      var sum = 0, cnt = 0;
      for (var f = f0; f < f1 && f < freqData.length; f++) { sum += freqData[f]; cnt++; }
      var v = cnt ? (sum / cnt) / 255 : 0;
      v = Math.pow(v, 0.82);

      bars[i] += (v - bars[i]) * (reduced ? 0.18 : 0.42);
      if (bars[i] > peaks[i]) peaks[i] = bars[i];
      else peaks[i] -= reduced ? 0.004 : 0.009;   // đỉnh cột rơi chậm
      if (peaks[i] < 0) peaks[i] = 0;

      var x = i * (bw + gap);
      var h = Math.max(1.5, bars[i] * topH);

      cv.fillStyle = grad;
      cv.fillRect(x, y0 - h, bw, h);

      /* Phản chiếu gương xuống dưới */
      cv.save();
      cv.shadowBlur = 0;
      cv.fillStyle = mirror;
      cv.globalAlpha = reduced ? 0.3 : 0.5;
      cv.fillRect(x, y0 + 1, bw, Math.min(ch - y0 - 1, h * 0.45));
      cv.restore();

      /* Đỉnh cột */
      var py = y0 - Math.max(2, peaks[i] * topH);
      cv.save();
      cv.shadowBlur = 0;
      cv.fillStyle = peaks[i] > 0.72 && !reduced ? C_AMBER : 'rgba(255,255,255,.85)';
      cv.fillRect(x, py - 2, bw, 2);
      cv.restore();
    }
    cv.shadowBlur = 0;

    /* Đường chân dải */
    cv.fillStyle = 'rgba(167,139,250,.35)';
    cv.fillRect(0, y0, cw, 1);
  }

  function frame() {
    rafId = window.requestAnimationFrame(frame);
    if (!cv) return;
    cv.clearRect(0, 0, cw, ch);
    if (isRunning() && analyser) drawSpectrum();
    else drawIdle();
  }

  function startLoop() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
  }

  /* ==========================================================================
   * 9. Bật / tắt tiếng
   * ====================================================================== */

  function enable() {
    if (on) return true;
    if (!ensureCtx()) return false;
    if (suspendTimer) { window.clearTimeout(suspendTimer); suspendTimer = 0; }
    try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}

    on = true;
    writePref(true);

    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.linearRampToValueAtTime(volume, now + 0.35);

    if (!document.hidden) startMusic();
    syncButton();
    return true;
  }

  function disable() {
    if (!on) return;
    on = false;
    writePref(false);
    stopMusic(0.25);
    if (ctx && master) {
      var now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.linearRampToValueAtTime(0.0001, now + 0.25);
    }
    if (suspendTimer) window.clearTimeout(suspendTimer);
    suspendTimer = window.setTimeout(function () {
      suspendTimer = 0;
      if (!on && ctx) { try { ctx.suspend(); } catch (e) {} }
    }, 450);
    setBassVar(0);
    bassSmooth = 0;
    syncButton();
  }

  /* --- Chờ cử chỉ đầu tiên: kể cả khi localStorage nói "on" --- */
  function onFirstGesture(e) {
    /* Nếu người dùng bấm chính nút của module thì để nút tự xử lý */
    if (btn && e && e.target && btn.contains(e.target)) { disarm(); return; }
    disarm();
    if (!on && readPref() && enable()) autoEnabledAt = Date.now();
  }

  function arm() {
    if (!readPref()) return;
    for (var i = 0; i < armEvents.length; i++) {
      document.addEventListener(armEvents[i], onFirstGesture, true);
    }
  }

  function disarm() {
    for (var i = 0; i < armEvents.length; i++) {
      document.removeEventListener(armEvents[i], onFirstGesture, true);
    }
  }

  /* ==========================================================================
   * 10. Listener toàn cục
   * ====================================================================== */

  function onVisibility() {
    if (document.hidden) {
      stopLoop();
      stopMusic(0.2);       // dừng scheduler khi tab ẩn
    } else {
      startLoop();
      if (on && ctx) {
        try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
        startMusic();
      }
    }
  }

  function onResize() { resize(); }

  /* ==========================================================================
   * 11. API
   * ====================================================================== */

  var api = {
    init: function (opts) {
      opts = opts || {};
      if (inited) {
        /* Idempotent: chỉ cập nhật lại tuỳ chọn */
        if (typeof opts.volume === 'number') api.setVolume(opts.volume);
        return;
      }

      var mq = null;
      try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) {}
      reduced = opts.reduced === true || !!(mq && mq.matches);
      zIndex = typeof opts.zIndex === 'number' ? opts.zIndex : Z_DEFAULT;
      if (typeof opts.volume === 'number') volume = clamp(opts.volume, 0, 1);

      /* Cho phép gọi init trước DOMContentLoaded */
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () { api.init(opts); }, { once: true });
        return;
      }

      inited = true;

      buildStyle();
      buildCanvas();
      buildButton();
      resize();
      setBassVar(0);

      window.addEventListener('resize', onResize, false);
      document.addEventListener('visibilitychange', onVisibility, false);

      arm();                    // khôi phục trạng thái nhưng vẫn chờ cử chỉ
      if (!document.hidden) startLoop();
    },

    destroy: function () {
      if (!inited) return;
      inited = false;

      disarm();
      stopLoop();
      stopMusic(0.05);
      if (suspendTimer) { window.clearTimeout(suspendTimer); suspendTimer = 0; }

      window.removeEventListener('resize', onResize, false);
      document.removeEventListener('visibilitychange', onVisibility, false);

      if (btn) {
        btn.removeEventListener('click', onBtnClick, false);
        btn.removeEventListener('mouseenter', onBtnHover, false);
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        btn = null;
      }
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null; cv = null;
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      styleEl = null;

      try { document.documentElement.style.removeProperty('--fx-bass'); } catch (e) {}

      if (ctx) {
        try { ctx.close(); } catch (e) {}
        ctx = null;
      }
      master = comp = analyser = null;
      busMusic = busSfx = convolver = wetGain = null;
      padFilter = padGain = bassGain = arpGain = drumBus = null;
      lfoSlow = lfoFast = null;
      noiseBuf = null; freqData = null;
      bars = []; peaks = [];
      on = false; bassSmooth = 0; bassWritten = -1;
      stepIndex = 0; nextStepTime = 0; autoEnabledAt = 0;
    },

    toggle: function () {
      /* Chống "bật rồi tắt ngay": trang chính có thể gắn phím tắt M cho toggle.
       * Nếu chính cử chỉ đó vừa tự bật tiếng (khôi phục từ localStorage) thì
       * bỏ qua lần toggle đi kèm, tránh việc bật lên rồi tắt luôn. */
      if (autoEnabledAt && Date.now() - autoEnabledAt < 200) {
        autoEnabledAt = 0;
        return on;
      }
      autoEnabledAt = 0;
      if (on) disable(); else enable();
      return on;
    },

    enable: function () { return enable(); },

    disable: function () { disable(); },

    isOn: function () { return !!on; },

    setVolume: function (v) {
      v = clamp(typeof v === 'number' && isFinite(v) ? v : MASTER_DEFAULT, 0, 1);
      volume = v;
      if (ctx && master && on) {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
        master.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + 0.12);
      }
      return volume;
    },

    getVolume: function () { return volume; },

    blip: sfxBlip,
    click: sfxClick,
    whoosh: sfxWhoosh,
    boom: sfxBoom,
    zap: sfxZap
  };

  window.FX = window.FX || {};
  window.FX.audio = api;
})();
