# Handspace

A hand-tracked musical instrument that runs in a browser with nothing but a webcam.
No headset, no install. The screen behaves like a window into a small room; you reach
into it to hit pads and pinch out notes.

Buildless — plain ES modules and an import map. No bundler, no npm install, no server
code. Deploys as static files.

## Run it

On Windows, double-click **`start.bat`** — it serves the folder and opens the page in
Chrome. Leave the window open while you play; closing it stops the server.

Otherwise, by hand:

```bash
python -m http.server 8080     # python3 on macOS/Linux
# open http://localhost:8080/ in Chrome
```

Camera access needs a secure context, so `file://` will not work. Chrome treats
`localhost` as secure, so the camera prompt appears normally.

### If the picture stays black

`getUserMedia` takes whatever the system calls the default camera, and on a machine
with OBS, a phone-as-webcam bridge or any other virtual camera installed, that default
is often the virtual one — it opens without error and feeds nothing but black. The app
detects this and moves to real hardware on its own. A picker appears above the preview
in the bottom right whenever there is more than one camera; the choice is remembered.

## The camera is optional

The gate offers two ways in. **Turn on the camera** gives you hand tracking. **Play
without a camera** skips getUserMedia and MediaPipe entirely — the instrument is fully
playable with the mouse and keyboard, and it starts instantly and runs much faster.

With the camera on, `h` toggles hand tracking off and back without reloading, for when
you want to stop your hands triggering things mid-session.

## First run

With the camera on you calibrate once: hold your palm out near the screen, then bring
it back to your chest. That learns your reach and is stored in `localStorage`.
Everything downstream — where the strike plane sits, how hard a punch reads — depends
on it. `shift+C` runs it again; **skip** falls back to a generic range.

## Playing

| Action | Result |
|---|---|
| Punch toward the screen over a pad | Hit, velocity from how fast you crossed the plane |
| Pinch thumb to index | Sustained note — height picks the pitch, left/right opens the filter |
| Left-click a pad | Hit |
| Right-click and drag | Sustained note that follows the pointer |
| Punch or click **rec** / **play** / **clear** | Transport |
| Punch or click **1**–**4** | Select that layer; hit the selected one again to mute it |

A pinched hand cannot strike, and an open hand cannot sound a note — the two never
fight each other, so notes get the full height of the room for pitch.

Pads do not need a direct hit. Any strike inside the pad band claims the nearest pad,
so the outer ones are as easy to reach as the middle.

### Keys

`A` `S` `D` `F` `G` pads · `space` play/stop · `r` record · `1`–`4` layer · `m` mute ·
`x` clear layer · `shift+X` clear all · `k` kit (`shift+K` back) · `t` save take ·
`e` export MIDI · `h` hand tracking on/off · `p` open-palm kit change on/off ·
`c` camera preview · `shift+C` recalibrate

### Gestures that fire on their own

Holding an open palm on the left cycles the kit, but it is **off by default** — an
open hand resting in frame should not change your sound. Turn it on with `p`. The
setting is remembered.

## Layout

```
index.html          shell, import map, overlays
src/
  main.js           boot, the per-frame loop, gesture rules
  config.js         geometry and tuning constants
  audio.js          Web Audio engine — drum voices and the pinch voice
  loop.js           four-layer transport, lookahead scheduler
  scene.js          three.js room, off-axis projection
  vision.js         camera, MediaPipe, landmarks to a point in the room
  filter.js         One Euro filter
  calibrate.js      the two-pose reach calibration
  kits.js           kit loading, with one kit inlined as a fallback
  midi.js           type-1 MIDI export
  storage.js        localStorage for calibration and takes
  ui.js             HUD, toasts, saved-takes strip
  style.css
kits/               kit definitions — data, not code
legacy/             the original single-file prototype, for reference
```

## The two ideas that make it feel dimensional

**Depth from palm span.** The apparent size of the palm is a proxy for how close the
hand is to the lens. Reaching toward the screen grows it, which maps to *deeper into
the scene*. A pad is struck when the cursor crosses the plane at `z = -0.95` moving
away from the viewer. Span is measured as the mean of five bones across the palm
rather than one wrist-to-knuckle segment, which keeps it steady while the hand rotates.

**Head-coupled perspective.** The camera builds an off-axis (asymmetric) frustum each
frame from the tracked head position instead of using a centred perspective camera.
Lean left and you see more of the right side of the room. Without it the scene reads
as a video game; with it, it reads as a box you are looking into.

## Adding a kit

Drop a JSON file in `kits/` and add its name to `kits/index.json`. No code changes.

```json
{
  "id": "moon",
  "name": "Moon",
  "scale": [57, 60, 62, 64, 67, 69, 72, 74, 76, 79],
  "lead": { "type": "saw3", "detune": 7, "sub": 1, "q": 7 },
  "pads": [
    { "name": "kick", "color": "#ff7a4d", "gm": 36, "voice": "body",
      "from": 140, "to": 44, "drop": 0.14, "decay": 0.45 }
  ]
}
```

Five pads. `voice` is `body` (pitched drop — kicks, toms), `noise` (filtered noise,
optionally with a tuned `body` under it — snares, hats, claps) or `metal` (inharmonic
square bank — cymbals, cowbells, bells). `lead.type` is `saw3`, `pluck`, `fm` or
`organ`. `gm` is the General MIDI percussion note used on export. `scale` is MIDI note
numbers, low to high, one guide line drawn per degree.

Loops store the **pad slot**, not the sound, so switching kits re-voices a pattern that
is already recorded.

## Graceful failure

Every optional piece degrades instead of breaking:

- Face model fails to load → fixed camera, everything else works.
- Frame rate below 30 → face detection drops to every 5th frame, then off. Hand
  tracking is never touched.
- `kits/` fails to fetch → the one kit inlined in `kits.js` is used.
- `localStorage` unavailable → no calibration memory and no saved takes, still plays.

## Constraints

Free and open source only, no accounts, no paid APIs. Runs entirely client-side —
camera frames stay on the machine. Static hosting; deploys to Cloudflare Pages as-is.

## Later

This is the hands-mode front end for BHS Studio. When the DAW work resumes, Handspace
becomes an input surface that writes into the studio's timeline rather than its own
standalone loop.
