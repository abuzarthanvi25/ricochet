import * as THREE from 'three'

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const rand = (lo, hi) => lo + Math.random() * (hi - lo)
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1))
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/** Frame-rate independent exponential approach. `rate` is roughly 1/seconds. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt))

/** Same, for vectors, in place. */
export function dampVec(out, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt)
  out.lerp(target, t)
  return out
}

/** Uniform point on the unit sphere. */
export function randomDirection(out = new THREE.Vector3()) {
  const z = rand(-1, 1)
  const a = rand(0, Math.PI * 2)
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(a), z, r * Math.sin(a))
}

/** Nudge a unit vector by up to `deg` degrees in a random direction. */
const _jitAxis = new THREE.Vector3()
export function jitterDirection(dir, deg) {
  if (deg <= 0) return dir
  randomDirection(_jitAxis)
  _jitAxis.cross(dir)
  if (_jitAxis.lengthSq() < 1e-6) return dir
  _jitAxis.normalize()
  return dir.applyAxisAngle(_jitAxis, rand(-deg, deg) * (Math.PI / 180)).normalize()
}

const _orientM = new THREE.Matrix4()
const _orientQ = new THREE.Quaternion()
const _ZERO = new THREE.Vector3(0, 0, 0)
const _UP = new THREE.Vector3(0, 1, 0)

/**
 * Point an object's local -Z along `dir`.
 *
 * Object3D.lookAt() aims local +Z for non-cameras, which is the opposite of the
 * camera convention. Everything in this game uses -Z as forward (bot models get
 * a PI yaw offset at load to match), so orientation goes through here instead.
 * Matrix4.lookAt(eye, target) sets z = normalize(eye - target), hence ZERO/dir.
 */
export function orientToDirection(obj, dir, slerp = 1) {
  _orientM.lookAt(_ZERO, dir, _UP)
  _orientQ.setFromRotationMatrix(_orientM)
  if (slerp >= 1) obj.quaternion.copy(_orientQ)
  else obj.quaternion.slerp(_orientQ, slerp)
}

/**
 * Intercept time for a constant-speed projectile fired from `shooter` at a
 * target moving at constant `targetVel`. Returns -1 when no solution exists
 * (target outruns the projectile), in which case callers should aim directly.
 */
export function interceptTime(shooterPos, targetPos, targetVel, projSpeed) {
  const rx = targetPos.x - shooterPos.x
  const ry = targetPos.y - shooterPos.y
  const rz = targetPos.z - shooterPos.z
  const a = targetVel.lengthSq() - projSpeed * projSpeed
  const b = 2 * (rx * targetVel.x + ry * targetVel.y + rz * targetVel.z)
  const c = rx * rx + ry * ry + rz * rz

  if (Math.abs(a) < 1e-6) {
    // target speed == projectile speed: linear case
    return Math.abs(b) < 1e-6 ? -1 : -c / b
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / (2 * a)
  const t2 = (-b + sq) / (2 * a)
  const lo = Math.min(t1, t2)
  const hi = Math.max(t1, t2)
  if (lo > 0) return lo
  if (hi > 0) return hi
  return -1
}
