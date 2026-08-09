# iOS Seconds Timer — Design

**Date:** 2026-08-10
**Status:** Approved

## Purpose

A single-page web app, used from Safari on iPhone, that counts down a duration
and displays it as **raw seconds only**. `100` counts `100, 99, 98 … 0`. It
never converts to minutes and never shows a colon.

This is the one difference from Apple's Clock timer, which caps seconds at 59
and rolls the remainder into minutes. Everything else — layout, typography,
colors, ring, button treatment — copies the iOS dark timer exactly.

## Scope

- One timer. No multiple concurrent timers, no history, no presets, no labels.
- No sound. No vibration. No notifications.
- No persistence across page reloads.
- No build step, no dependencies, no framework.

## Input

The scroll wheel is the only way to set the duration.

A vertical scroll column covering **0–600 seconds**, using CSS
`scroll-snap-type: y mandatory` so it gets native iOS momentum and
snap-to-value with no JS animation. The row in the centre sits on a rounded
grey pill and is rendered white; every other row is secondary grey. A static
`sec` label sits to the right of the column.

**Cap.** 600 seconds (10 minutes) — the wheel's range is the ceiling. `0`
leaves Start inert.

A numeric keypad was specified and built, then removed on request. If a value
above 600 is ever needed, either extend the wheel or restore the keypad; the
display itself handles up to 4 digits without resizing.

## Screens

One screen, four states. Nothing navigates.

### Idle
Big white `0` above the seconds wheel. Buttons: **Cancel** (grey, inert until
a value is set) and **Start** (green).

### Running
Wheel is hidden. The big number counts down in raw seconds. An orange ring
around the number depletes counterclockwise from 12 o'clock. Beneath the
number, the same remaining time rendered as `m:ss` in secondary grey — so
`100` above reads `1:40` below. It ticks with the main count.
Buttons: **Cancel** (grey) / **Pause** (orange).

This replaces the iOS bell-and-finish-time label, which carries little meaning
over a short count. The raw seconds stay the primary readout; the `m:ss` line
is only a conventional reading of the same number.

### Paused
Everything freezes exactly as rendered, ring included.
Buttons: **Cancel** / **Resume** (green).

### Done
The number sits at `0`. The ring is fully empty. Silent — no sound, no flash,
no animation. Buttons: **Cancel** (grey → returns to idle) / **Restart**
(green → runs the same duration again).

## Visual specification

Fidelity to iOS is the point of the project, so these values are requirements,
not suggestions.

| Element | Value |
|---|---|
| Background | `#000000`, true black |
| Number font | `-apple-system` (SF Pro on iOS), weight `200`, ~`22vw`, white, `font-variant-numeric: tabular-nums` |
| Orange | `#FF9F0A` — systemOrange **dark** variant, not the `#FF9500` light-mode one |
| Green | `#30D158` — systemGreen dark variant |
| Wheel selected row | `#2C2C2E` pill, 10px radius, white text |
| Wheel other rows | `#8E8E93` |
| Ring track | `#333333`, stroke ≈ 7px, round line caps |
| Ring progress | `#FF9F0A`, same stroke |
| `m:ss` sub-label | `#8E8E93`, ~17px, `tabular-nums` |
| Buttons | 80px circles. Cancel: `#333333` fill, white label. Start / Resume / Restart: green at ~18% alpha fill, green label. Pause: orange at ~18% alpha, orange label. |
| Pressed state | Opacity ~0.4 on `:active` |
| Page chrome | `viewport-fit=cover` with safe-area insets, `user-select: none`, no tap highlight, `overscroll-behavior: none` |

`tabular-nums` matters: without it the number jitters horizontally as digits
change.

## Architecture

`~/Developer/ios-seconds-timer/`, three files, no build:

- `index.html` — number, ring SVG, wheel, button row
- `styles.css` — the visual specification above
- `app.js` — state machine and timer engine

### Timer engine

Do not decrement a counter on an interval — Safari throttles background tabs
and the count would drift.

Store `endTimestamp = Date.now() + durationMs`. Tick on `requestAnimationFrame`
and derive `remaining = endTimestamp - Date.now()` fresh each frame. Display
`Math.ceil(remaining / 1000)`.

Pausing stores the leftover milliseconds; resuming computes a fresh
`endTimestamp` from it. Because remaining time is always derived from the
clock, locking the phone mid-count and returning shows the correct remaining
time rather than a stale one.

### Ring

A single SVG circle with `stroke-dasharray` set to its circumference, animating
`stroke-dashoffset` from the fractional progress. Rotated `-90deg` and mirrored
so it drains counterclockwise from 12 o'clock. Driven by the same rAF tick, so
it moves smoothly rather than stepping once per second.

### State machine

A single `state` variable (`idle | running | paused | done`) and one `render()`
that writes it to a `data-state` attribute on `<body>`. All visibility and
button labelling is expressed as CSS selectors on that attribute, so there is
no imperative DOM toggling spread through the code.

### Wake lock

Request `navigator.wakeLock` on Start so the screen does not sleep mid-count;
release it on Cancel and on Done. Supported in iOS Safari 16.4+ and wrapped in
`try`/`catch`, so older versions simply run without it.

## Edge cases

- Wheel at `0`: Start stays inert.
- Remaining exactly 0: ring renders empty, never a full circle.
- Backgrounding or locking the device mid-count: remaining time stays correct
  on return.
- Reload mid-count: timer is lost, returns to idle. Accepted.

## Testing

No test framework — the page is a single dependency-free document. Verification
is manual, on a real iPhone in Safari:

1. Idle → wheel scrolls, snaps, and updates the big number.
2. Exactly one row is white and sitting on the grey pill at all times.
3. Start button is green; Pause is orange; Resume and Restart are green.
4. Start → counts in raw seconds, ring depletes smoothly, `m:ss` sub-label
   tracks the main count.
5. Values above 59 display as raw seconds (`100`, not `1:40`) throughout.
6. Pause freezes number and ring; Resume continues from the same point.
7. Lock the phone for ~30s mid-count, unlock: remaining time is correct.
8. Done → number at `0`, ring empty, silent; Restart reruns the same duration;
   Cancel returns to idle.
9. Rendering check against a real iOS timer screenshot: colors, weights, and
   button sizing match.
