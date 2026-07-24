/**
 * Player-facing options that persist across sessions: flight assist, aim assist,
 * and mouse sensitivity. Kept apart from difficulty (core/difficulty.js) and
 * audio (fx/audio.js), which own their own storage. Every getter is defensive --
 * localStorage throws in private mode, and the shipped defaults are fine there.
 */

const FA_KEY = 'ricochet.flightassist'
const AA_KEY = 'ricochet.aimassist'
const SENS_KEY = 'ricochet.sensitivity'

export const SENS_MIN = 0.3
export const SENS_MAX = 2.0

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
