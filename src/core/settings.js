/**
 * Player-facing options that persist across sessions: flight assist, aim assist,
 * and mouse sensitivity. Kept apart from difficulty (core/difficulty.js) and
 * audio (fx/audio.js), which own their own storage. Every getter is defensive --
 * localStorage throws in private mode, and the shipped defaults are fine there.
 */

const FA_KEY = 'ricochet.flightassist'
const AA_KEY = 'ricochet.aimassist'
const BLOOM_KEY = 'ricochet.bloom'
const SENS_KEY = 'ricochet.sensitivity'
const PROJ_KEY = 'ricochet.projspeed'

export const SENS_MIN = 0.3
export const SENS_MAX = 2.0
export const PROJ_MIN = 0.6
export const PROJ_MAX = 1.6

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function loadBool(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function saveBool(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* non-fatal */
  }
}

export const loadFlightAssist = () => loadBool(FA_KEY, true)
export const saveFlightAssist = (on) => saveBool(FA_KEY, on)

// Aim assist defaults on, but its *strength* still comes from the difficulty, so
// this only gates a lever that is already 0 on SOLDIER/VETERAN.
export const loadAimAssist = () => loadBool(AA_KEY, true)
export const saveAimAssist = (on) => saveBool(AA_KEY, on)

// Bloom is the single most expensive thing in the frame, so a low-end machine
// wins the most from turning it off. Defaults on.
export const loadBloom = () => loadBool(BLOOM_KEY, true)
export const saveBloom = (on) => saveBool(BLOOM_KEY, on)

export function loadSensitivity() {
  try {
    const v = parseFloat(localStorage.getItem(SENS_KEY))
    return Number.isFinite(v) && v > 0 ? clamp(v, SENS_MIN, SENS_MAX) : 1
  } catch {
    return 1
  }
}

export function saveSensitivity(mul) {
  try {
    localStorage.setItem(SENS_KEY, String(mul))
  } catch {
    /* non-fatal */
  }
}

// Global projectile-speed multiplier over CFG.proj.speed. Applied in
// Bot.projSpeed(), so it scales spawned shots AND the enemy lead-aim solver
// together -- a faster shot the bots still lead correctly. Kept as a live
// module value the hot path reads, not threaded through every call site.
let projSpeedMul = 1
try {
  const v = parseFloat(localStorage.getItem(PROJ_KEY))
  if (Number.isFinite(v) && v > 0) projSpeedMul = clamp(v, PROJ_MIN, PROJ_MAX)
} catch {
  /* default 1 is fine */
}

export const getProjSpeedMul = () => projSpeedMul

export function setProjSpeedMul(mul) {
  projSpeedMul = clamp(mul, PROJ_MIN, PROJ_MAX)
  try {
    localStorage.setItem(PROJ_KEY, String(projSpeedMul))
  } catch {
    /* non-fatal */
  }
  return projSpeedMul
}
