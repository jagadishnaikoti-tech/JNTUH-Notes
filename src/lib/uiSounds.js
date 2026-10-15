// ---------------------------------------------------------------------------
// UI click sounds.
//
// A single, very short, quiet click is synthesised with the Web Audio API, so
// there is no audio asset to download and no new dependency. One delegated
// capture-phase listener on the document finds the activated control and plays
// a click for it. Keeping the wiring in one place means:
//
//   - no duplicate listeners and no per-component bookkeeping,
//   - existing onClick / submit / navigation / keyboard behaviour is untouched
//     (we never call preventDefault or stopPropagation),
//   - disabled and decorative elements stay silent.
//
// The on/off preference is one boolean in localStorage ("ln:sound"). Sound is
// opt-out (on by default) and can be turned off from the header toggle.
// ---------------------------------------------------------------------------

export const SOUND_KEY = "ln:sound";

// Elements that count as a genuine control activation. Deliberately excludes
// form fields and generic page content so incidental clicks stay silent.
const CONTROL_SELECTOR = [
  "button",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='menuitemcheckbox']",
  "[role='switch']",
  "a[href]",
  "summary",
  "input[type='submit']",
  "input[type='button']",
  "input[type='reset']",
].join(",");

const MIN_GAP_MS = 45; // ignore clicks arriving faster than this (near-simultaneous taps)
const VOLUME = 0.05; // ~12% - deliberately quiet
const DURATION = 0.045; // ~45ms - short enough to feel immediate

let enabled = readPreference();
const subscribers = new Set();

function readPreference() {
  try {
    const value = localStorage.getItem(SOUND_KEY);
    return value === null ? true : value === "on";
  } catch {
    return true;
  }
}

// ---- Preference store (consumed via useSyncExternalStore) -----------------

export function isSoundEnabled() {
  return enabled;
}

export function getSoundSnapshot() {
  return enabled;
}

export function getServerSoundSnapshot() {
  return true;
}

export function setSoundEnabled(next) {
  const value = !!next;
  if (value === enabled) return;
  enabled = value;
  try {
    localStorage.setItem(SOUND_KEY, value ? "on" : "off");
  } catch {
    /* storage disabled - the choice simply won't persist */
  }
  subscribers.forEach((notify) => {
    try {
      notify();
    } catch {
      /* a misbehaving subscriber must never break the toggle */
    }
  });
}

/** Flip the preference and return the new value. */
export function toggleSoundEnabled() {
  setSoundEnabled(!enabled);
  return enabled;
}

export function subscribeSound(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// ---- Audio engine ---------------------------------------------------------

let audioCtx = null;
let masterGain = null;
let lastPlayedAt = 0;

// The AudioContext is created lazily on the first activation, i.e. inside a
// user gesture, which is what browser autoplay rules require.
function getContext() {
  if (audioCtx) return audioCtx;
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  try {
    audioCtx = new AudioCtor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = VOLUME;
    masterGain.connect(audioCtx.destination);
  } catch {
    audioCtx = null;
    masterGain = null;
  }
  return audioCtx;
}

/**
 * Play one soft click. Safe to call from anywhere: it never throws, never
 * blocks, and simply does nothing when sound is off or audio is unavailable.
 */
export function playUiClick() {
  if (!enabled) return;

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return; // throttle: no harsh stacking
  lastPlayedAt = now;

  const ctx = getContext();
  if (!ctx || !masterGain) return;

  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const start = ctx.currentTime + 0.001;
    const end = start + DURATION;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    // A pure mid-range sine swept gently downward reads as a soft "tick": no
    // harsh transient, no bass thump, no reverb tail.
    osc.type = "sine";
    osc.frequency.setValueAtTime(1180, start);
    osc.frequency.exponentialRampToValueAtTime(860, end);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(1, start + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(env);
    env.connect(masterGain);

    // Release the nodes once finished so long sessions don't accumulate them.
    osc.onended = () => {
      try {
        osc.disconnect();
      } catch {
        /* already gone */
      }
      try {
        env.disconnect();
      } catch {
        /* already gone */
      }
    };

    osc.start(start);
    osc.stop(end + 0.02);
  } catch {
    /* audio blocked or unavailable - silently continue */
  }
}

// ---- Delegated listener ---------------------------------------------------

function isDisabledControl(el) {
  if (!el) return false;
  if (el.disabled === true) return true;
  if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return true;
  if (
    el.classList &&
    (el.classList.contains("is-disabled") || el.classList.contains("disabled"))
  ) {
    return true;
  }
  return false;
}

let installedCleanup = null;

/**
 * Install the single global click-sound listener.
 *
 * Idempotent: calling it while already installed returns the existing cleanup
 * instead of attaching a second listener (so React StrictMode's double-invoked
 * effects can never double up).
 */
export function installClickSounds(root = document) {
  if (installedCleanup) return installedCleanup;

  const onClick = (event) => {
    // Primary button / keyboard activation only; ignore right and middle click.
    if (event.button && event.button !== 0) return;

    const node = event.target;
    if (!node || typeof node.closest !== "function") return;

    const control = node.closest(CONTROL_SELECTOR);
    if (!control) return;
    if (isDisabledControl(control)) return;

    playUiClick();
  };

  root.addEventListener("click", onClick, true);

  installedCleanup = () => {
    root.removeEventListener("click", onClick, true);
    installedCleanup = null;
  };
  return installedCleanup;
}
