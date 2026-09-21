/* Shared geometry and tuning. World units; the window plane sits at z = 0. */

export const WIN_W = 3.2, WIN_H = 1.8;   // the "window" into the room
export const NEAR = 0.1, FAR = 60;

/* Depth. A hand travels from Z_FRONT (arm back, near the chest) to Z_BACK
 * (arm out, palm near the screen). The strike plane sits ~62% along that
 * travel, so after calibration a pad lands where the player expects it. */
export const Z_FRONT = 0.85, Z_BACK = -1.75;
export const PAD_Z = -0.95;

/* Layout. Pinching suppresses strikes, so notes can use the full height
 * without fighting the pads and buttons for vertical space. */
export const PAD_Y   = -0.50;
export const BTN_Y   =  0.78;
export const LAYER_Y =  1.04;
export const NOTE_Y_LO = -0.70, NOTE_Y_HI = 1.05;

export const PAD_GAP = 0.58;                   // spacing between pad centres
/* Targeting is forgiving on purpose: any punch inside the pad band claims the
 * nearest pad rather than needing to land inside its outline. Reaching the
 * outer pads should not be the hard part of playing. */
export const PAD_BAND  = 0.62;                // vertical half-height of the pad row
export const PAD_REACH = 0.90;                // how far sideways a punch may claim a pad

/* Transport */
export const BPM = 96, BARS = 2, STEPS = 32;

/* Hand mapping */
export const SPAN_DEFAULT = { far: 0.070, near: 0.200 };  // replaced by calibration
export const PINCH_ON = 0.60, PINCH_OFF = 0.80;           // hysteresis, ratio of palm span
export const PALM_HOLD_MS = 900;                          // open palm to change kit
export const MOUSE_VEL = 0.85;                            // strike velocity for a click
export const STRIKE_LOCKOUT = 8;                          // frames, per pad
export const BTN_LOCKOUT = 26;

/* Performance ladder. Face tracking degrades first; hand tracking is untouchable. */
export const FACE_EVERY = [3, 5, 0];   // 0 = off, fixed camera

export const CUTOFF_RANGE = [480, 4200];
