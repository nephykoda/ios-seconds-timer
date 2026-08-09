(function () {
  'use strict';

  var MAX_INPUT = 9999;   // 4-digit cap
  var WHEEL_MAX = 600;    // wheel covers 0-600; keypad handles anything above
  var ROW = 40;           // must match --row-h in styles.css
  var CIRC = 2 * Math.PI * 140;

  var els = {
    body: document.body,
    number: document.getElementById('number'),
    endtime: document.getElementById('endtime'),
    ghost: document.getElementById('ghost'),
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

  /* ---------- wheel ---------- */

  (function buildWheel() {
    var html = '';
    for (var i = 0; i <= WHEEL_MAX; i++) {
      html += '<div class="wheel-item">' + i + '</div>';
    }
    els.wheelItems.innerHTML = html;
  })();

  function scrollWheelTo(v) {
    var target = Math.min(Math.max(v, 0), WHEEL_MAX) * ROW;
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
    if (idx !== value) {
      value = idx;
      render();
    }
  }, { passive: true });

  /* ---------- keypad ---------- */

  els.ghost.addEventListener('focus', function () {
    if (state !== 'idle') { els.ghost.blur(); return; }
    els.body.setAttribute('data-keypad', 'on');
    els.ghost.value = value ? String(value) : '';
  });

  els.ghost.addEventListener('input', function () {
    var digits = els.ghost.value.replace(/\D/g, '').slice(0, 4);
    els.ghost.value = digits;
    value = Math.min(parseInt(digits, 10) || 0, MAX_INPUT);
    render();
  });

  els.ghost.addEventListener('blur', function () {
    els.body.removeAttribute('data-keypad');
    scrollWheelTo(value);
  });

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
    els.number.textContent = String(Math.ceil(remaining / 1000));
    var frac = totalMs > 0 ? remaining / totalMs : 0;
    els.progress.style.strokeDasharray = CIRC;
    els.progress.style.strokeDashoffset = CIRC * (1 - frac);
  }

  function formatEndTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + suffix;
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
    els.ghost.blur();
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

  function render() {
    els.body.setAttribute('data-state', state);

    if (state === 'idle') {
      els.number.textContent = String(value);
      els.left.textContent = 'Cancel';
      els.right.textContent = 'Start';
      els.left.classList.toggle('is-off', value === 0);
      els.right.classList.toggle('is-off', value === 0);
      return;
    }

    els.left.textContent = 'Cancel';
    els.left.classList.remove('is-off');
    els.right.classList.remove('is-off');

    if (state === 'running') {
      els.right.textContent = 'Pause';
      els.endtime.textContent = formatEndTime(endTimestamp);
    } else if (state === 'paused') {
      els.right.textContent = 'Resume';
      els.endtime.textContent = formatEndTime(now() + pausedMs);
      paint(pausedMs);
    } else if (state === 'done') {
      els.right.textContent = 'Restart';
      paint(0);
    }
  }

  scrollWheelTo(0);
  render();
})();
