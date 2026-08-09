(function () {
  'use strict';

  var WHEEL_MAX = 100;    // the wheel is the only input, so this is the ceiling
  // The ring is an absolute 0-100s gauge, not a percentage of the chosen
  // duration: a 30s timer starts the ring 30% full and drains to empty, so the
  // arc always means the same number of seconds whatever you picked.
  var RING_FULL_MS = 100 * 1000;
  var ROW = 40;           // must match --row-h in styles.css
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

  /* ---------- wheel ---------- */

  (function buildWheel() {
    var html = '';
    for (var i = 0; i <= WHEEL_MAX; i++) {
      html += '<div class="wheel-item">' + i + '</div>';
    }
    els.wheelItems.innerHTML = html;
  })();

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

  els.wheelScroll.addEventListener('scroll', function () {
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
    els.number.textContent = String(secs);
    els.subtime.textContent = formatMinSec(secs);
    var frac = Math.min(remaining / RING_FULL_MS, 1);
    els.progress.style.strokeDasharray = CIRC;
    els.progress.style.strokeDashoffset = CIRC * (1 - frac);
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
      els.number.textContent = String(value);
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
  render();
})();
