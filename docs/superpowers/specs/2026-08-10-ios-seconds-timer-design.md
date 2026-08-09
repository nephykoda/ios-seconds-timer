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

A vertical scroll column covering **0–100 seconds**, using CSS
`scroll-snap-type: y mandatory` so it gets native iOS momentum and
snap-to-value with no JS animation. The row in the centre sits on a rounded
grey pill and is rendered white; every other row is secondary grey. A static
`sec` label sits to the right of the column.

**Cap.** 100 seconds. This is a 100-second timer by definition — the wheel's
range, the ring's scale, and the product's purpose all agree on that number.
`0` leaves Start inert.

A numeric keypad was specified and built, then removed on request. With a
100-row wheel, scrolling to any value is quick enough that typing is not
needed.

## Screens

One screen, four states. Nothing navigates.

### Nav bar
Persistent across all states, copying the iOS Clock header: a decorative
`‹ Timers` back button in orange on the left (non-interactive — there is
nowhere to go back to) and a centred semibold title reading **`100 secs`**,
permanently. The title names the app, not the current selection — this is the
100-second timer whatever value is dialled in — so it is static markup with no
JS behind it. The bar carries generous top padding (18px above the safe-area
inset) so the title clears the notch comfortably.

### Idle
Big white `0` above the seconds wheel. Buttons: **Cancel** (grey, inert until
a value is set) and **Start** (green).

### Running
Wheel is hidden. The big number counts down in raw seconds. An orange ring
around the number is anchored at 12 o'clock and runs clockwise, so its leading
edge retreats **anticlockwise** as time runs out. **Above** the number, a bell
icon and the same remaining time rendered as `m:ss` — so `100` reads `1:40`.
It ticks with the main count and is deliberately low contrast (`#5A5A5E`) so it
informs without competing with the raw seconds.
Buttons: **Cancel** (grey) / **Pause** (orange).

The `m:ss` reading takes the place of the iOS finish-clock-time, which carries
little meaning over a short count. The bell icon is kept for fidelity.

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
| Number font | `-apple-system` (SF Pro on iOS), weight `100` (Ultralight), `min(25vw, 132px)`, `-0.03em` tracking, white, `font-variant-numeric: tabular-nums` |
| Nav title | 17px, weight `600` (semibold), white |
| Nav back | 17px regular, orange, with a 2.6px-stroke chevron |
| Orange | `#FF9F0A` — systemOrange **dark** variant, not the `#FF9500` light-mode one |
| Green | `#30D158` — systemGreen dark variant |
| Wheel selected row | `#2C2C2E` pill, 10px radius, white text |
| Wheel other rows | `#8E8E93` |
| Ring track | `#333333`, stroke ≈ 7px, round line caps |
| Ring progress | `#FF9F0A`, same stroke |
| Bell + `m:ss` sub-label | `#5A5A5E`, 16px, `tabular-nums`, sits **above** the number |
| Buttons | 80px circles. Cancel: `#333333` fill, white label. Start / Resume / Restart: green at ~18% alpha fill, green label. Pause: orange at ~18% alpha, orange label. |
| Pressed state | Opacity ~0.4 on `:active` |
| Vertical rhythm | Stage gap `0` — the wheel's edge fade means neighbours can sit nearly flush. Buttons 8px under the wheel. Wheel takes `34px` top margin **while idle only**, giving the picker breathing room without moving the ring in the running state. Stage padded `60px` below the safe-area inset so the ring clears the nav bar by ~80px. |
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

**The ring is an absolute 0–100 second gauge, not a progress bar.** Its fill is
`remaining / 100s`, never `remaining / chosenDuration`. A 100s timer therefore
starts on a full circle; a 30s timer starts 30% filled and drains from there;
a 5s timer starts as a short stub near 12 o'clock. The arc always denotes the
same number of seconds regardless of what was selected, so the ring is directly
readable across runs.

A single SVG circle with `stroke-dasharray` set to its circumference, animating
`stroke-dashoffset` from the fractional progress. Rotated `-90deg` only — no
mirroring — so the arc is anchored at 12 o'clock running clockwise and its
leading edge retreats anticlockwise down the left side as time elapses. Driven
by the same rAF tick, so it moves smoothly rather than stepping once per
second.

### Dial sizing

The dial is sized by the readout (sub-label + number), **not** by the ring. The
ring is an absolutely-positioned overlay centred on the dial, so while idle —
when it is invisible — it reserves no vertical space and the number can sit
close to the wheel. Once running, the ring overflows the dial box symmetrically
into the space the hidden wheel still occupies.

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
4. Start → counts in raw seconds, the ring's leading edge retreats
   anticlockwise, and the `m:ss` sub-label above tracks the main count.
10. Nav title reads `100 secs` in every state, and the ring's position does not
    shift between idle and running.
5. Values above 59 display as raw seconds (`100`, not `1:40`) throughout.
6. Pause freezes number and ring; Resume continues from the same point.
7. Lock the phone for ~30s mid-count, unlock: remaining time is correct.
8. Done → number at `0`, ring empty, silent; Restart reruns the same duration;
   Cancel returns to idle.
9. Rendering check against a real iOS timer screenshot: colors, weights, and
   button sizing match.
