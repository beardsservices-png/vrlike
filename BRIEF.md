# Handspace — build brief

Hand-tracked musical instrument that runs in a browser with nothing but a webcam.
No headset, no install, no app store. The screen behaves like a window into a small
room; the player reaches into it to hit pads and pinch out notes.

A working single-file prototype already exists: `handspace.html`. Start from it
rather than from scratch.

---

## Run it

Camera access needs a secure context, so `file://` won't work. From the repo root:

```bash
python3 -m http.server 8080
# open http://localhost:8080/handspace.html in Chrome
```

Chrome treats `localhost` as secure, so the camera prompt appears normally.

---

## How it works now

Everything is in one HTML file, ES modules loaded from jsDelivr, no build step.

| Piece | What it does |
|---|---|
| **three.js 0.161** | Renders the room: five pads, three transport buttons, a 32-step loop ring, floor grid |
| **MediaPipe `HandLandmarker`** | Two hands, 21 landmarks each, `VIDEO` running mode, GPU delegate |
| **MediaPipe `FaceDetector`** (blaze_face_short_range) | Head position, runs every third frame, optional — the app still works if it fails to load |
| **Web Audio API** | Synthesized drums, a 3-oscillator saw/sub voice with a resonant lowpass, convolution reverb from a generated impulse |
| **`Loop` class** | 2 bars at 96 BPM, 16th-note quantize, lookahead scheduler (25ms tick, 150ms window) |

### The two ideas that make it feel dimensional

**1. Depth from hand span.** The distance between wrist (landmark 0) and middle-finger
MCP (landmark 9) is a proxy for how close the hand is to the lens. Reaching toward the
screen grows that span, which is mapped to *deeper into the scene* (z goes negative).
A pad is struck when the cursor crosses the pad plane at `z = -0.95` moving away from
the viewer; strike velocity comes from how fast it crossed.

**2. Head-coupled perspective.** The camera uses an off-axis (asymmetric) frustum built
each frame from the tracked head position, rather than a normal centered perspective
camera. The window plane sits at `z = 0` and is 3.2 × 1.8 world units. Leaning left
shows more of the right side of the room. This is what sells depth on a flat screen —
without it the scene reads as a video game; with it, it reads as a box you're looking into.

### Controls

| Action | Result |
|---|---|
| Punch toward the screen over a pad | Hit, velocity-sensitive |
| Pinch thumb to index | Sustained note — height sets pitch (A minor pentatonic), horizontal position sets filter cutoff |
| Punch the rec / play / clear panels | Transport |
| `space` `r` `x` `c` | Play-stop, record, clear, camera preview |

---

## What to build next

Order matters — each step depends on the one above it.

**1. Split the file.** `src/audio.js`, `src/vision.js`, `src/scene.js`, `src/loop.js`,
`src/main.js`, with `index.html` as the shell. Keep it buildless — plain ES modules and
an import map, so it can still be served as static files.

**2. Calibration pass.** A 10-second setup on first load: hold your hand at the screen,
then at your chest, and store the observed span range in `localStorage`. The hardcoded
`0.085 → 0.24` span range is the weakest part of the prototype and differs by camera,
lens, and arm length. Everything downstream feels better once this is per-user.

**3. Smoothing.** A One Euro filter on landmark positions. Fixed lerp smoothing trades
lag against jitter badly; One Euro gives responsive strikes and quiet cursors at the
same time. This is the second-biggest feel upgrade after calibration.

**4. Layered looping.** Overdub instead of one flat event list — four layers, each
independently mutable and clearable, each with its own color on the step ring.

**5. MIDI export.** Same approach used in Vamp: write a type-1 MIDI file from the loop
events and offer it as a download, so a take can move into a real DAW.

**6. Instrument switching.** A left-hand gesture (open palm held for ~600ms) cycles
the pad kit and the pinch voice. Kits as plain JSON so new ones don't need code.

**7. Session persistence.** Save loops to `localStorage` as JSON, with a strip of
saved takes along the bottom.

---

## Constraints

- Free and open source only. No paid APIs, no accounts.
- Static hosting — deploy to Cloudflare Pages alongside the other sites. No server needed.
- Runs entirely client-side; camera frames stay on the machine and go nowhere.
- Target 30fps on a mid-range laptop with integrated graphics. If hand tracking and face
  tracking together fall under that, drop face detection to every fifth frame before
  touching hand tracking.
- Graceful failure: if the face model fails to load, the scene falls back to a fixed
  camera and keeps working. Keep that pattern for anything added later.

## Acceptance check

A person sits down, allows the camera, and within about twenty seconds is playing a
drum pattern in time without reading instructions. If they need to be told how to hit
a pad, the depth mapping or the calibration is wrong, not the documentation.

## Later

This is the hands-mode front end for BHS Studio. When the DAW work resumes, Handspace
becomes an input surface that writes into the studio's timeline rather than its own
standalone loop.
