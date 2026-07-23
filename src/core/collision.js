import * as THREE from 'three'
import { HALF } from '../config.js'

const EPS = 1e-9

/**
 * Sweep a sphere of `radius` from `pos` along unit `dir` for up to `maxT`
 * units, against the *inside* of the arena box.
 *
 * Returns the distance travelled before contact, or -1 if it stays inside for
 * the whole sweep. `outNormal` receives the inward-facing wall normal.
 *
 * The arena is axis-aligned, so this is an exact per-axis solve -- no
 * iteration, no tunnelling, regardless of how fast the projectile is going.
 */
export function sweepArena(pos, dir, maxT, radius, outNormal) {
  const h = [HALF.x - radius, HALF.y - radius, HALF.z - radius]
  const p = [pos.x, pos.y, pos.z]
  const d = [dir.x, dir.y, dir.z]

  let bestT = Infinity
  let bestAxis = -1
  let bestSign = 0

  for (let i = 0; i < 3; i++) {
    let t = Infinity
    let sign = 0
    if (d[i] > EPS) {
      t = (h[i] - p[i]) / d[i]
      sign = 1
    } else if (d[i] < -EPS) {
      t = (-h[i] - p[i]) / d[i]
      sign = -1
    }
    if (t < bestT && t <= maxT) {
      bestT = t
      bestAxis = i
      bestSign = sign
    }
  }

  if (bestAxis < 0) return -1

  outNormal.set(0, 0, 0)
  outNormal.setComponent(bestAxis, -bestSign) // points back into the arena
  // A negative t means we already started outside (float drift); treat as an
  // immediate contact so the reflect still pushes us back in.
  return Math.max(0, bestT)
}

/**
 * First intersection of the ray (origin, unit dir) with a sphere, within maxT.
 * Returns -1 for a miss. Handles an origin already inside the sphere by
 * returning the exit point, which lets a projectile spawned inside debris
 * escape instead of getting stuck.
 */
export function raySphere(origin, dir, maxT, center, radius) {
  const ox = origin.x - center.x
  const oy = origin.y - center.y
  const oz = origin.z - center.z

  const b = ox * dir.x + oy * dir.y + oz * dir.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius

  if (c > 0 && b > 0) return -1 // outside, travelling away

  const disc = b * b - c
  if (disc < 0) return -1

  const sq = Math.sqrt(disc)
  let t = -b - sq
  if (t < 0) t = -b + sq // origin was inside
  if (t < 0 || t > maxT) return -1
  return t
}

/** True when nothing in `spheres` blocks the segment from `a` to `b`. */
const _losDir = new THREE.Vector3()
export function segmentClear(a, b, spheres, skip = null) {
  _losDir.subVectors(b, a)
  const len = _losDir.length()
  if (len < EPS) return true
  _losDir.multiplyScalar(1 / len)
  for (const s of spheres) {
    if (s === skip) continue
    if (raySphere(a, _losDir, len, s.pos, s.radius) >= 0) return false
  }
  return true
}

/**
 * Keep a bot inside the arena. Bots do NOT bounce -- bouncing the thing you
 * are steering feels like losing control. We clamp the position and kill only
 * the inward-facing component of velocity.
 */
export function clampToArena(pos, vel, radius) {
  let hit = false
  const h = [HALF.x - radius, HALF.y - radius, HALF.z - radius]
  const axes = ['x', 'y', 'z']
  for (let i = 0; i < 3; i++) {
    const a = axes[i]
    if (pos[a] > h[i]) {
      pos[a] = h[i]
      if (vel[a] > 0) vel[a] = 0
      hit = true
    } else if (pos[a] < -h[i]) {
      pos[a] = -h[i]
      if (vel[a] < 0) vel[a] = 0
      hit = true
    }
  }
  return hit
}

/** Same idea for a bot overlapping a debris sphere: push out, cancel inward vel. */
const _push = new THREE.Vector3()
export function resolveSphere(pos, vel, radius, center, otherRadius, restitution = 0) {
  _push.subVectors(pos, center)
  const distSq = _push.lengthSq()
  const minDist = radius + otherRadius
  if (distSq >= minDist * minDist) return false

  // Exactly concentric: pick an arbitrary axis so the push-out still resolves.
  const dist = Math.sqrt(distSq)
  if (dist < EPS) _push.set(0, 1, 0)
  else _push.multiplyScalar(1 / dist)

  pos.copy(center).addScaledVector(_push, minDist)
  const inward = vel.dot(_push)
  if (inward < 0) vel.addScaledVector(_push, -inward * (1 + restitution))
  return true
}
