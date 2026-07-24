import * as THREE from 'three'
import { CFG } from '../config.js'
import { clamp, damp } from './util.js'
import { sweepArena, raySphere } from './collision.js'

const _desired = new THREE.Vector3()
const _back = new THREE.Vector3()
const _up = new THREE.Vector3()
const _toCam = new THREE.Vector3()
const _look = new THREE.Vector3()
const _normal = new THREE.Vector3()

/**
 * Third-person chase rig. Owns the yaw/pitch the player steers with; the bot
 * body follows the rig, not the other way round.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera
    this.yaw = 0
    this.pitch = 0
    this.forward = new THREE.Vector3(0, 0, -1)
    this.right = new THREE.Vector3(1, 0, 0)
    this.pos = new THREE.Vector3(0, 0, 10)
    this.fovTarget = CFG.camera.fov
    this.snapNext = true
    this.shake = 0
    // Player-set look-speed multiplier over the base sensitivity. 1 = default.
    this.sensitivityMul = 1
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount)
  }

  reset(target) {
    this.yaw = 0
    this.pitch = 0
    this._rebuildBasis()
    this.snapNext = true
    this.fovTarget = CFG.camera.fov
    if (target) this.pos.copy(target.pos).addScaledVector(this.forward, -CFG.camera.offset[2])
  }

  applyMouse(dx, dy) {
    const s = CFG.camera.mouseSensitivity * this.sensitivityMul
    this.yaw -= dx * s
    this.pitch -= dy * s
    const lim = THREE.MathUtils.degToRad(CFG.camera.pitchClampDeg)
    this.pitch = clamp(this.pitch, -lim, lim)
  }

  _rebuildBasis() {
    const cp = Math.cos(this.pitch)
    this.forward
      .set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
      .normalize()
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
  }

  kickFov(boosting) {
    this.fovTarget = boosting ? CFG.camera.fovBoost : CFG.camera.fov
  }

  /** Explicit target, for states that sit between resting and full boost. */
  setFov(fov) {
    this.fovTarget = fov
  }

  update(dt, target, arena) {
    this._rebuildBasis()

    const [ox, oy, oz] = CFG.camera.offset
    _back.copy(this.forward).negate()
    _up.crossVectors(_back, this.right).normalize()

    _desired
      .copy(target.pos)
      .addScaledVector(this.right, ox)
      .addScaledVector(_up, oy)
      .addScaledVector(_back, oz)

    this._avoidGeometry(target.pos, _desired, arena)

    if (this.snapNext) {
      this.pos.copy(_desired)
      this.snapNext = false
    } else {
      const t = 1 - Math.exp(-CFG.camera.stiffness * dt)
      this.pos.lerp(_desired, t)
    }

    this.camera.position.copy(this.pos)
    _look.copy(this.pos).add(this.forward)
    this.camera.lookAt(_look) // cameras aim -Z, which is our forward

    // Positional shake only, applied after lookAt so aim stays honest -- the
    // crosshair must never lie about where the shot goes.
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt)
      const s = this.shake * 0.32
      this.camera.position.x += (Math.random() * 2 - 1) * s
      this.camera.position.y += (Math.random() * 2 - 1) * s
      this.camera.position.z += (Math.random() * 2 - 1) * s
    }

    const fov = damp(this.camera.fov, this.fovTarget, CFG.camera.fovLerp, dt)
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  /** Pull the camera in when a wall or a rock would sit between it and the bot. */
  _avoidGeometry(from, desired, arena) {
    _toCam.subVectors(desired, from)
    const dist = _toCam.length()
    if (dist < 1e-4) return
    _toCam.multiplyScalar(1 / dist)

    let best = dist
    const r = CFG.camera.collideRadius

    const tw = sweepArena(from, _toCam, dist, r, _normal)
    if (tw >= 0 && tw < best) best = tw

    for (const d of arena.debris) {
      const t = raySphere(from, _toCam, best, d.pos, d.radius + r)
      if (t >= 0 && t < best) best = t
    }

    if (best < dist) desired.copy(from).addScaledVector(_toCam, Math.max(1.2, best))
  }

  /**
   * Where the crosshair actually lands. Projectiles leave the muzzle -- which
   * is offset from the camera -- so they must be aimed at this point rather
   * than fired parallel to the camera, or nothing hits where it looks.
   */
  getAimPoint(arena, bots, exclude, out = new THREE.Vector3()) {
    let best = CFG.camera.far
    const tw = sweepArena(this.pos, this.forward, best, 0, _normal)
    if (tw >= 0) best = tw

    for (const d of arena.debris) {
      const t = raySphere(this.pos, this.forward, best, d.pos, d.radius)
      if (t >= 0) best = t
    }
    for (const b of bots) {
      if (!b.alive || b === exclude) continue
      const t = raySphere(this.pos, this.forward, best, b.pos, b.radius)
      if (t >= 0) best = t
    }

    return out.copy(this.pos).addScaledVector(this.forward, Math.max(best, 2))
  }
}
