/**
 * On-screen controls for touch devices. The game itself never learns it is being
 * driven by a thumb: everything here writes the same core/input.js state a mouse
 * and keyboard would (setTouchMove/Vert/Firing, pressTouchBoost, addLook), so
 * Player.think, the fire path and the analytic sweep are all untouched.
 *
 * Layout (landscape): the left `lookZoneStart` fraction of the screen is a
 * DYNAMIC analog joystick -- the base spawns wherever the thumb lands, so there
 * is no fixed target to reach for. The rest is a look-drag zone. A floating
 * fire / boost / ascend / descend cluster sits bottom-right, and a pause button
 * top-left. Every input is routed by pointerId, so move, look and fire can all
 * be live at once across separate fingers.
 */

import { CFG } from '../config.js'
import {
  setTouchMove,
  setTouchVert,
  setTouchFiring,
  pressTouchBoost,
  addLook,
  clearTouch,
} from './input.js'

/**
 * Pure joystick math, extracted so it can be unit-tested headless (no DOM).
 * `dx,dy` are the thumb's offset from the base in screen pixels (y down). Returns
 * a camera-relative push: `x` = strafe (right positive), `y` = forward (screen-up
 * positive, so the sign of dy is flipped). Magnitude is 0 inside the deadzone,
 * rescaled to reach 1 exactly at `radius`, and clamped to 1 beyond it.
 */
export function computeJoystick(dx, dy, radius, deadzone) {
  const len = Math.hypot(dx, dy)
  const dead = deadzone * radius
  if (len <= dead) return { x: 0, y: 0 }
  // Rescale so motion begins just past the deadzone and saturates at the rim.
  const t = Math.min(1, (len - dead) / (radius - dead))
  const scale = t / len
  return { x: dx * scale, y: -dy * scale }
}

const isTouchLike = () =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0

/** Auto-detect, with `?touch` to force it on and `?desktop` to force it off (dev). */
export function detectTouch() {
  const q = new URLSearchParams(location.search)
  if (q.has('touch')) return true
  if (q.has('desktop')) return false
  return isTouchLike()
}

export class TouchControls {
  constructor() {
    this.enabled = false
    this.onPause = null

    // Pointer roles, keyed by pointerId so several fingers coexist.
    this._moveId = null // dynamic joystick
    this._lookId = null // right-zone look drag
    this._lookLast = { x: 0, y: 0 }
    this._fireLast = { x: 0, y: 0 }
    this._up = false
    this._down = false

    this._build()
    this._bind()
  }

  _build() {
    const root = document.createElement('div')
    root.id = 'touch-controls'

    this.look = document.createElement('div')
    this.look.id = 'touch-look'

    this.joy = document.createElement('div')
    this.joy.id = 'touch-joy'
    this.joyThumb = document.createElement('div')
    this.joyThumb.id = 'touch-joy-thumb'
    this.joy.appendChild(this.joyThumb)

    this.btnPause = this._btn('touch-pause', '❚❚')
    this.btnUp = this._btn('touch-up', '▲')
    this.btnDown = this._btn('touch-down', '▼')
    this.btnBoost = this._btn('touch-boost', 'BOOST')
    this.btnFire = this._btn('touch-fire', 'FIRE')

    root.append(
      this.look,
      this.joy,
      this.btnPause,
      this.btnUp,
      this.btnDown,
      this.btnBoost,
      this.btnFire
    )
    document.body.appendChild(root)
    this.root = root
  }

  _btn(id, label) {
    const b = document.createElement('div')
    b.id = id
    b.className = 'touch-btn'
    b.textContent = label
    return b
  }

  _bind() {
    // Look zone (also the dynamic joystick). Buttons paint on top and capture
    // their own pointers, so a tap that reaches here is always empty screen.
    this.look.addEventListener('pointerdown', (e) => this._onLookDown(e))
    this.look.addEventListener('pointermove', (e) => this._onLookMove(e))
    this.look.addEventListener('pointerup', (e) => this._onLookUp(e))
    this.look.addEventListener('pointercancel', (e) => this._onLookUp(e))

    // Fire: hold to fire, and dragging off the button steers the look so one
    // thumb can aim while firing -- the whole point of a bounce-aim game.
    this.btnFire.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      e.preventDefault()
      this.btnFire.setPointerCapture(e.pointerId)
      this.btnFire.classList.add('pressed')
      this._fireLast.x = e.clientX
      this._fireLast.y = e.clientY
      setTouchFiring(true)
    })
    this.btnFire.addEventListener('pointermove', (e) => {
      if (!this.btnFire.classList.contains('pressed')) return
      this._look(e.clientX - this._fireLast.x, e.clientY - this._fireLast.y)
      this._fireLast.x = e.clientX
      this._fireLast.y = e.clientY
    })
    const endFire = () => {
      this.btnFire.classList.remove('pressed')
      setTouchFiring(false)
    }
    this.btnFire.addEventListener('pointerup', endFire)
    this.btnFire.addEventListener('pointercancel', endFire)

    // Boost: edge-triggered tap.
    this.btnBoost.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      e.preventDefault()
      this.btnBoost.classList.add('pressed')
      pressTouchBoost()
    })
    const endBoost = () => this.btnBoost.classList.remove('pressed')
    this.btnBoost.addEventListener('pointerup', endBoost)
    this.btnBoost.addEventListener('pointercancel', endBoost)

    // Ascend / descend: held. Combine so pressing both cancels to zero.
    this._holdBtn(this.btnUp, (on) => {
      this._up = on
      setTouchVert((this._up ? 1 : 0) - (this._down ? 1 : 0))
    })
    this._holdBtn(this.btnDown, (on) => {
      this._down = on
      setTouchVert((this._up ? 1 : 0) - (this._down ? 1 : 0))
    })

    // Pause: tap. Guarded by enabled so a stray tap on a hidden layout is inert.
    this.btnPause.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      e.preventDefault()
      this.onPause?.()
    })
  }

  _holdBtn(btn, set) {
    btn.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      e.preventDefault()
      btn.setPointerCapture(e.pointerId)
      btn.classList.add('pressed')
      set(true)
    })
    const end = () => {
      btn.classList.remove('pressed')
      set(false)
    }
    btn.addEventListener('pointerup', end)
    btn.addEventListener('pointercancel', end)
  }

  _onLookDown(e) {
    if (!this.enabled) return
    e.preventDefault()
    const leftZone = e.clientX < window.innerWidth * CFG.touch.lookZoneStart
    if (leftZone && this._moveId === null) {
      this._moveId = e.pointerId
      this.look.setPointerCapture(e.pointerId)
      this._joyCx = e.clientX
      this._joyCy = e.clientY
      this._showJoy(e.clientX, e.clientY, 0, 0)
    } else if (!leftZone && this._lookId === null) {
      this._lookId = e.pointerId
      this.look.setPointerCapture(e.pointerId)
      this._lookLast.x = e.clientX
      this._lookLast.y = e.clientY
    }
  }

  _onLookMove(e) {
    if (e.pointerId === this._moveId) {
      const dx = e.clientX - this._joyCx
      const dy = e.clientY - this._joyCy
      const r = CFG.touch.joyRadius
      const v = computeJoystick(dx, dy, r, CFG.touch.deadzone)
      setTouchMove(v.x, v.y)
      // Thumb visual, clamped to the ring.
      const len = Math.hypot(dx, dy) || 1
      const c = Math.min(len, r) / len
      this._showJoy(this._joyCx, this._joyCy, dx * c, dy * c)
    } else if (e.pointerId === this._lookId) {
      this._look(e.clientX - this._lookLast.x, e.clientY - this._lookLast.y)
      this._lookLast.x = e.clientX
      this._lookLast.y = e.clientY
    }
  }

  _onLookUp(e) {
    if (e.pointerId === this._moveId) {
      this._moveId = null
      setTouchMove(0, 0)
      this._hideJoy()
    } else if (e.pointerId === this._lookId) {
      this._lookId = null
    }
  }

  _look(dx, dy) {
    addLook(dx * CFG.touch.lookSpeed, dy * CFG.touch.lookSpeed)
  }

  _showJoy(cx, cy, tx, ty) {
    this.joy.style.left = `${cx}px`
    this.joy.style.top = `${cy}px`
    this.joyThumb.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`
    this.joy.classList.add('on')
  }

  _hideJoy() {
    this.joy.classList.remove('on')
    this.joyThumb.style.transform = 'translate(-50%, -50%)'
  }

  /** Wipe every live role and zero the input -- used on hide so nothing sticks. */
  _reset() {
    this._moveId = null
    this._lookId = null
    this._up = false
    this._down = false
    this.btnFire.classList.remove('pressed')
    this.btnBoost.classList.remove('pressed')
    this.btnUp.classList.remove('pressed')
    this.btnDown.classList.remove('pressed')
    this._hideJoy()
    clearTouch()
  }

  show() {
    this.enabled = true
    this.root.classList.add('active')
  }

  hide() {
    this.enabled = false
    this.root.classList.remove('active')
    this._reset()
  }
}
