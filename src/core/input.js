/**
 * Pointer-lock input.
 *
 * Note on key choice: the plan originally had Ctrl for boost, but Chrome's
 * Ctrl+W (close tab) fires straight through pointer lock -- holding boost while
 * thrusting forward would close the game. Boost is Q / right mouse instead.
 */

const state = {
  keys: new Set(),
  dx: 0,
  dy: 0,
  firing: false,
  boostEdge: false,
  locked: false,
}

const listeners = { lockChange: [], lockError: [] }
let canvasEl = null

export function initInput(canvas) {
  canvasEl = canvas

  window.addEventListener('keydown', (e) => {
    // Space would re-trigger a still-focused overlay button, and scroll.
    if (e.code === 'Space') e.preventDefault()
    if (e.repeat) return
    state.keys.add(e.code)
    if (e.code === 'KeyQ') state.boostEdge = true
  })

  window.addEventListener('keyup', (e) => state.keys.delete(e.code))

  window.addEventListener('blur', () => {
    state.keys.clear()
    state.firing = false
  })

  canvas.addEventListener('mousedown', (e) => {
    if (!state.locked) return
    if (e.button === 0) state.firing = true
    if (e.button === 2) state.boostEdge = true
  })

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false
  })

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return
    state.dx += e.movementX || 0
    state.dy += e.movementY || 0
  })

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas
    if (!state.locked) {
      state.keys.clear()
      state.firing = false
    }
    for (const fn of listeners.lockChange) fn(state.locked)
  })

  // Chrome refuses pointer lock for a backgrounded/unfocused document. Without
  // this the play button would just silently do nothing.
  document.addEventListener('pointerlockerror', () => {
    for (const fn of listeners.lockError) fn()
  })
}

export function onLockChange(fn) {
  listeners.lockChange.push(fn)
}

export function onLockError(fn) {
  listeners.lockError.push(fn)
}

export async function requestLock() {
  if (!canvasEl || state.locked) return
  try {
    const p = canvasEl.requestPointerLock({ unadjustedMovement: true })
    if (p && p.catch) await p
  } catch {
    // Some browsers reject unadjustedMovement; fall back to the plain call.
    try {
      canvasEl.requestPointerLock()
    } catch {
      /* user will retry */
    }
  }
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock()
}

export const isLocked = () => state.locked
export const isDown = (code) => state.keys.has(code)
export const isFiring = () => state.firing

/** Mouse deltas accumulate between frames and are drained once per update. */
export function consumeMouse(out) {
  out.x = state.dx
  out.y = state.dy
  state.dx = 0
  state.dy = 0
  return out
}

/** Boost is edge-triggered so holding Q does not chain-dash. */
export function consumeBoost() {
  const b = state.boostEdge
  state.boostEdge = false
  return b
}
