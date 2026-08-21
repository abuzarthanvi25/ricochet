/**
 * Pointer-lock input.
 *
 * Note on key choice: the plan originally had Ctrl for boost, but Chrome's
 * Ctrl+W (close tab) fires straight through pointer lock -- holding boost while
 * thrusting forward would close the game. Boost is Q only. It used to also be on
 * the right mouse button, but that was a newcomer trap: the natural "aim/zoom"
 * reflex dashed you into a wall, and RMB has no other use here.
 */

const state = {
  keys: new Set(),
  dx: 0,
  dy: 0,
  firing: false,
  boostEdge: false,
  locked: false,
  // Touch-driven analog movement, fed by core/touch.js. Kept in the same state
  // object as the keyboard so Player.think and the fire/boost paths read one
  // source: tx/ty are the camera-relative plane (right/forward, [-1,1]), tvert
  // the world vertical, touchFiring the on-screen fire button. Look drags fold
  // straight into dx/dy, so the frame loop drains them exactly like a mouse.
  tx: 0,
  ty: 0,
  tvert: 0,
  touchFiring: false,
}

// Reused so Player.think reads the touch move vector with no per-frame alloc.
const _touchMove = { x: 0, y: 0, vert: 0 }

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
    clearTouch()
  })

  canvas.addEventListener('mousedown', (e) => {
    if (!state.locked) return
    if (e.button === 0) state.firing = true
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
// Either input source can fire: mouse button on desktop, on-screen button on touch.
export const isFiring = () => state.firing || state.touchFiring

// ----------------------------------------------------------------- touch input
// core/touch.js writes these; nothing else should. Keeping the setters here (not
// a second input surface) is why the rest of the game never learns it is being
// driven by a thumb rather than a mouse and keyboard.

/** Analog move on the camera-relative plane. x = strafe, y = forward, each [-1,1]. */
export function setTouchMove(x, y) {
  state.tx = x
  state.ty = y
}

/** World vertical thrust from the ascend/descend buttons: -1, 0 or +1. */
export function setTouchVert(v) {
  state.tvert = v
}

/** Hold state of the on-screen fire button. */
export function setTouchFiring(on) {
  state.touchFiring = on
}

/** On-screen boost tap. Edge-triggered like the Q key so a held finger cannot chain-dash. */
export function pressTouchBoost() {
  state.boostEdge = true
}

/** A look drag, in pixels. Folded into the same delta buffer the mouse uses. */
export function addLook(dx, dy) {
  state.dx += dx
  state.dy += dy
}

/** Combined touch movement intent, read once per frame by Player.think. */
export function getTouchMove() {
  _touchMove.x = state.tx
  _touchMove.y = state.ty
  _touchMove.vert = state.tvert
  return _touchMove
}

/** Zero every touch input. Called on blur and when the touch controls hide. */
export function clearTouch() {
  state.tx = 0
  state.ty = 0
  state.tvert = 0
  state.touchFiring = false
}

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
