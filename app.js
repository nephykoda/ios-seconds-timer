(function () {
  'use strict';

  var WHEEL_MAX = 100;    // the wheel is the only input, so this is the ceiling
  // The ring is an absolute 0-100s gauge, not a percentage of the chosen
  // duration: a 30s timer starts the ring 30% full and drains to empty, so the
  // arc always means the same number of seconds whatever you picked.
  var RING_FULL_MS = 100 * 1000;
  var ROW = 34;           // must match --row-h in styles.css
  var WHEEL_H = 170;      // must match --wheel-h in styles.css
  var PAD = (WHEEL_H - ROW) / 2;

  // Drum geometry. Each row sits STEP_DEG further around a cylinder, so rows
  // away from centre foreshorten and bunch up exactly as they do on iOS. The
  // radius is chosen so spacing at the centre matches the flat row height.
  var STEP_DEG = 20;
  var STEP_RAD = STEP_DEG * Math.PI / 180;
  var RADIUS = ROW / STEP_RAD;
  var DRUM_WINDOW = 7;    // rows either side of centre worth transforming
  var CIRC = 2 * Math.PI * 140;

  var els = {
    body: document.body,
    number: document.getElementById('number'),
    subtime: document.getElementById('subtimeText'),
    wheelScroll: document.getElementById('wheelScroll'),
    wheelItems: document.getElementById('wheelItems'),
    progress: document.querySelector('.ring-progress'),
    left: document.getElementById('leftBtn'),
    right: document.getElementById('rightBtn')
  };

  var state = 'idle';
  var value = 0;          // seconds currently selected
  var totalMs = 0;        // duration of the run in flight
  var endTimestamp = 0;   // wall-clock ms when it finishes
  var pausedMs = 0;       // remaining ms while paused
  var rafId = null;
  var wakeLock = null;
  var pendingScrollTop = null; // scrollTop we set ourselves, to be ignored once
  var selectedEl = null;       // currently highlighted wheel row
  var drumStyled = [];         // rows currently carrying a 3D transform
  var drumFrame = null;        // rAF handle, so we transform once per frame

  /* ---------- wheel ---------- */

  (function buildWheel() {
    var html = '';
    for (var i = 0; i <= WHEEL_MAX; i++) {
      html += '<div class="wheel-item">' + i + '</div>';
    }
    els.wheelItems.innerHTML = html;
  })();

  // Project the rows onto a cylinder. Rows stay in normal flow — so iOS keeps
  // supplying momentum and snap — and each is nudged from its linear position
  // to where the drum would put it, then rotated to match.
  function renderDrum() {
    var items = els.wheelItems.children;
    var centreY = els.wheelScroll.scrollTop + WHEEL_H / 2;

    for (var k = 0; k < drumStyled.length; k++) drumStyled[k].style.transform = '';
    drumStyled.length = 0;

    var mid = Math.round((centreY - PAD - ROW / 2) / ROW);
    var from = Math.max(0, mid - DRUM_WINDOW);
    var to = Math.min(items.length - 1, mid + DRUM_WINDOW);

    for (var i = from; i <= to; i++) {
      var el = items[i];
      var rows = (PAD + i * ROW + ROW / 2 - centreY) / ROW; // distance in rows
      var theta = rows * STEP_RAD;

      if (Math.abs(theta) >= Math.PI / 2) {   // past the horizon of the drum
        el.style.transform = 'scaleY(0)';
        drumStyled.push(el);
        continue;
      }

      // where the cylinder puts it, minus where flow already put it
      var dy = RADIUS * Math.sin(theta) - rows * ROW;
      el.style.transform =
        'translateY(' + dy.toFixed(2) + 'px) rotateX(' + (-theta * 180 / Math.PI).toFixed(2) + 'deg)';
      drumStyled.push(el);
    }
  }

  // only the row sitting in the highlight pill is white; the rest stay grey
  function markSelected(idx) {
    var el = els.wheelItems.children[idx];
    if (el === selectedEl) return;
    if (selectedEl) selectedEl.classList.remove('is-selected');
    if (el) el.classList.add('is-selected');
    selectedEl = el || null;
  }

  function scrollWheelTo(v) {
    var clamped = Math.min(Math.max(v, 0), WHEEL_MAX);
    markSelected(clamped);
    var target = clamped * ROW;
    if (Math.abs(els.wheelScroll.scrollTop - target) < 1) return; // no event will fire
    pendingScrollTop = target;
    els.wheelScroll.scrollTop = target;
  }

  function scheduleDrum() {
    if (drumFrame !== null) return;
    drumFrame = requestAnimationFrame(function () {
      drumFrame = null;
      renderDrum();
    });
  }

  els.wheelScroll.addEventListener('scroll', function () {
    scheduleDrum();
    if (state !== 'idle') return;
    if (pendingScrollTop !== null) {
      // swallow only the echo of our own programmatic scroll
      if (Math.abs(els.wheelScroll.scrollTop - pendingScrollTop) < 1) {
        pendingScrollTop = null;
        return;
      }
      pendingScrollTop = null;
    }
    var idx = Math.round(els.wheelScroll.scrollTop / ROW);
    idx = Math.min(Math.max(idx, 0), WHEEL_MAX);
    markSelected(idx);
    if (idx !== value) {
      value = idx;
      render();
    }
  }, { passive: true });

  /* ---------- timer engine ---------- */

  function now() { return Date.now(); }

  function tick() {
    var remaining = endTimestamp - now();
    if (remaining <= 0) {
      remaining = 0;
      stopTicking();
      state = 'done';
      releaseWakeLock();
    }
    paint(remaining);
    if (state === 'running') {
      rafId = requestAnimationFrame(tick);
    } else {
      render();
    }
  }

  function stopTicking() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function paint(remaining) {
    var secs = Math.ceil(remaining / 1000);
    setNumber(String(secs));
    els.subtime.textContent = formatMinSec(secs);
    var frac = Math.min(remaining / RING_FULL_MS, 1);
    els.progress.style.strokeDasharray = CIRC;
    els.progress.style.strokeDashoffset = CIRC * (1 - frac);
  }

  /* ---------- optical centring ----------
     Centring the number's box is not the same as centring what you see. The
     negative letter-spacing is applied after the final digit too, so the box
     is narrower than the ink; and in tabular figures a "1" sits in a
     full-width cell with a wide left sidebearing. "100" ends up ~6px right of
     centre. Measure the real ink bounds and offset the element to compensate. */

  var inkCtx = null;
  var inkReady = false;
  var inkCache = {};

  function initInk() {
    inkCtx = document.createElement('canvas').getContext('2d');
    var cs = getComputedStyle(els.number);
    inkCtx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    // without letterSpacing support the measurement would disagree with layout
    if ('letterSpacing' in inkCtx) {
      inkCtx.letterSpacing = cs.letterSpacing;
      inkReady = true;
    }
  }

  function centreNumber(text) {
    if (inkCtx === null) initInk();
    if (!inkReady) return;

    var offset = inkCache[text];
    if (offset === undefined) {
      var m = inkCtx.measureText(text);
      offset = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 - m.width / 2;
      inkCache[text] = offset;
    }
    els.number.style.transform = 'translateX(' + (-offset).toFixed(2) + 'px)';
  }

  function setNumber(text) {
    els.number.textContent = text;
    centreNumber(text);
  }

  // seconds -> m:ss, the conventional reading of the raw count
  function formatMinSec(secs) {
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /* ---------- wake lock ---------- */

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
      }, function () { /* denied; carry on */ });
    } catch (e) { /* unsupported; carry on */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) { /* ignore */ }
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state === 'running') {
      requestWakeLock();
    }
  });

  /* ---------- transitions ---------- */

  function start(seconds) {
    if (seconds <= 0) return;
    value = seconds;
    totalMs = seconds * 1000;
    endTimestamp = now() + totalMs;
    state = 'running';
    requestWakeLock();
    render();
    paint(totalMs); // paint immediately so Restart never flashes the old 0
    stopTicking();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    pausedMs = Math.max(endTimestamp - now(), 0);
    stopTicking();
    state = 'paused';
    releaseWakeLock();
    render();
  }

  function resume() {
    endTimestamp = now() + pausedMs;
    state = 'running';
    requestWakeLock();
    render();
    rafId = requestAnimationFrame(tick);
  }

  function cancel() {
    stopTicking();
    releaseWakeLock();
    state = 'idle';
    scrollWheelTo(value);
    render();
  }

  els.left.addEventListener('click', function () {
    if (state === 'idle') {
      value = 0;
      scrollWheelTo(0);
      render();
    } else {
      cancel();
    }
  });

  els.right.addEventListener('click', function () {
    if (state === 'idle') start(value);
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
    else if (state === 'done') start(value);
  });

  /* ---------- render ---------- */

  // green for every "go" action, orange only for Pause — as in the iOS timer
  function setRight(label, tone) {
    els.right.textContent = label;
    els.right.classList.toggle('btn-green', tone === 'green');
    els.right.classList.toggle('btn-orange', tone === 'orange');
  }

  function render() {
    els.body.setAttribute('data-state', state);

    if (state === 'idle') {
      setNumber(String(value));
      els.subtime.textContent = formatMinSec(value);
      els.left.textContent = 'Cancel';
      setRight('Start', 'green');
      els.left.classList.toggle('is-off', value === 0);
      els.right.classList.toggle('is-off', value === 0);
      return;
    }

    els.left.textContent = 'Cancel';
    els.left.classList.remove('is-off');
    els.right.classList.remove('is-off');

    if (state === 'running') {
      setRight('Pause', 'orange');
    } else if (state === 'paused') {
      setRight('Resume', 'green');
      paint(pausedMs);
    } else if (state === 'done') {
      setRight('Restart', 'green');
      paint(0);
    }
  }

  scrollWheelTo(0);
  renderDrum();
  render();
})();
