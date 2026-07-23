import * as THREE from 'three'
import { CFG } from '../config.js'
import { sweepArena, raySphere } from '../core/collision.js'
import { clamp } from '../core/util.js'

const _dir = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _wallNormal = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _mat4 = new THREE.Matrix4()
const _scaleV = new THREE.Vector3(1, 1, 1)
const _quat = new THREE.Quaternion()
const _hidden = new THREE.Vector3(0, -10000, 0)
const _colFresh = new THREE.Color(CFG.proj.colorFresh)
const _colArmed = new THREE.Color(CFG.proj.colorArmed)
const _colHot = new THREE.Color(CFG.proj.colorFullyArmed)

const EPS = 1e-5
const TRAIL = CFG.fx.trailLength
const SEGS = TRAIL - 1 // line segments per trail

/**
 * All projectiles render in exactly two draw calls: one InstancedMesh for the
 * glowing heads, one LineSegments holding every trail. Previously each
 * projectile owned its own Mesh plus its own Line with its own buffer upload,
 * which put ~90 draw calls and ~90 per-frame buffer uploads on screen during a
 * busy fight.
 */
export class ProjectileSystem {
  constructor(scene) {
    this.scene = scene
    this.pool = []
    this.active = []
    this.free = []

    const N = CFG.pools.projectiles

    // --- heads: one instanced sphere ---
    const headGeo = new THREE.SphereGeometry(CFG.proj.radius, 10, 8)
    // three's color_fragment chunk only applies vColor under USE_COLOR, so
    // instanceColor alone never reaches the fragment shader. vertexColors plus
    // an all-white geometry colour attribute opens that path; vColor then ends
    // up as 1 * white * instanceColor, i.e. exactly the per-instance tint.
    const vertCount = headGeo.attributes.position.count
    const white = new Float32Array(vertCount * 3).fill(1)
    headGeo.setAttribute('color', new THREE.BufferAttribute(white, 3))

    const headMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      toneMapped: false,
    })
    this.heads = new THREE.InstancedMesh(headGeo, headMat, N)
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.heads.frustumCulled = false
    this.heads.count = N
    // setColorAt allocates instanceColor on first use.
    this.heads.setColorAt(0, _colFresh)
    this.heads.instanceColor.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.heads)

    // --- trails: one LineSegments for the whole pool ---
    const trailGeo = new THREE.BufferGeometry()
    this.trailPos = new Float32Array(N * SEGS * 2 * 3)
    this.trailCol = new Float32Array(N * SEGS * 2 * 3)
    trailGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage)
    )
    trailGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage)
    )
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.trails = new THREE.LineSegments(trailGeo, trailMat)
    this.trails.frustumCulled = false
    scene.add(this.trails)
    this.trailGeo = trailGeo

    for (let i = 0; i < N; i++) {
      this.pool.push({
        index: i,
        alive: false,
        ownerId: -1,
        ownerTeam: -1,
        damageScale: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        bounces: 0,
        // Ring buffer of trail points, newest first, flat xyz.
        trailPts: new Float32Array(TRAIL * 3),
        trailCount: 0,
        color: new THREE.Color(),
      })
      this.free.push(i)
    }

    this._hideAllInstances()
  }

  _hideAllInstances() {
    for (let i = 0; i < this.pool.length; i++) this._hideInstance(i)
    this.heads.instanceMatrix.needsUpdate = true
  }

  _hideInstance(i) {
    _mat4.compose(_hidden, _quat, _scaleV)
    this.heads.setMatrixAt(i, _mat4)
  }

  spawn(ownerId, ownerTeam, origin, dir, damageScale = 1) {
    // O(1) free list; the old `pool.find(x => !x.alive)` was a linear scan on
    // every single shot.
    const idx = this.free.pop()
    if (idx === undefined) return null // pool exhausted; dropping a shot beats stuttering

    const p = this.pool[idx]
    p.alive = true
    p.ownerId = ownerId
    p.ownerTeam = ownerTeam
    p.damageScale = damageScale
    p.pos.copy(origin)
    p.vel.copy(dir).normalize().multiplyScalar(CFG.proj.speed)
    p.age = 0
    p.bounces = 0
    p.trailCount = 0

    this._applyHeat(p)
    this._pushTrail(p)
    this.active.push(p)
    return p
  }

  /**
   * Bounce count drives the colour, and the jump from 0 -> 1 is deliberately a
   * hard cut rather than a gradient: that is the exact moment the projectile
   * becomes lethal to its own shooter, so it needs to read instantly.
   */
  _applyHeat(p) {
    if (p.bounces === 0) {
      p.color.copy(_colFresh)
    } else {
      const t = clamp((p.bounces - 1) / Math.max(1, CFG.proj.bouncesToFullHeat - 1), 0, 1)
      p.color.copy(_colArmed).lerp(_colHot, t)
    }
    this.heads.setColorAt(p.index, p.color)
    this.heads.instanceColor.needsUpdate = true
  }

  /** Push the current position onto the head of the trail ring buffer. */
  _pushTrail(p) {
    const pts = p.trailPts
    // Shift back by one point (small fixed-size copy, no allocation).
    for (let i = Math.min(p.trailCount, TRAIL - 1); i > 0; i--) {
      pts[i * 3] = pts[(i - 1) * 3]
      pts[i * 3 + 1] = pts[(i - 1) * 3 + 1]
      pts[i * 3 + 2] = pts[(i - 1) * 3 + 2]
    }
    pts[0] = p.pos.x
    pts[1] = p.pos.y
    pts[2] = p.pos.z
    if (p.trailCount < TRAIL) p.trailCount++
  }

  /** Write every active trail into the shared segment buffer, once per frame. */
  _writeTrailBuffer() {
    const pos = this.trailPos
    const col = this.trailCol
    let v = 0 // vertex cursor

    for (const p of this.active) {
      const pts = p.trailPts
      const segs = Math.max(0, p.trailCount - 1)
      for (let s = 0; s < segs; s++) {
        const a = s * 3
        const b = (s + 1) * 3
        const fadeA = 1 - s / TRAIL
        const fadeB = 1 - (s + 1) / TRAIL

        pos[v * 3] = pts[a]
        pos[v * 3 + 1] = pts[a + 1]
        pos[v * 3 + 2] = pts[a + 2]
        col[v * 3] = p.color.r * fadeA
        col[v * 3 + 1] = p.color.g * fadeA
        col[v * 3 + 2] = p.color.b * fadeA
        v++

        pos[v * 3] = pts[b]
        pos[v * 3 + 1] = pts[b + 1]
        pos[v * 3 + 2] = pts[b + 2]
        col[v * 3] = p.color.r * fadeB
        col[v * 3 + 1] = p.color.g * fadeB
        col[v * 3 + 2] = p.color.b * fadeB
        v++
      }
    }

    this.trailGeo.setDrawRange(0, v)
    // Upload only the range actually written, not the whole pool's worth.
    const posAttr = this.trailGeo.attributes.position
    const colAttr = this.trailGeo.attributes.color
    posAttr.addUpdateRange(0, v * 3)
    colAttr.addUpdateRange(0, v * 3)
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }

  update(dt, game) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]
      const outcome = this._step(p, dt, game)

      if (outcome === 'gone') {
        this.active.splice(i, 1)
        continue
      }

      this._pushTrail(p)

      if (p.age >= CFG.proj.lifetime) {
        game.detonate(p, null)
        this._recycle(p)
        this.active.splice(i, 1)
      }
    }

    // One matrix write per live projectile, one buffer upload for the lot.
    for (const p of this.active) {
      _mat4.compose(p.pos, _quat, _scaleV)
      this.heads.setMatrixAt(p.index, _mat4)
    }
    this.heads.instanceMatrix.needsUpdate = true
    this._writeTrailBuffer()
  }

  /**
   * Advance one projectile through a frame.
   *
   * Every test here is an analytic sweep, not a point sample, so speed cannot
   * cause tunnelling: walls solve exactly per axis, debris and bots are
   * ray/sphere. The loop re-runs after each bounce and spends the remaining
   * distance in the same frame, which keeps a corner ricochet from eating a
   * whole frame of travel.
   */
  _step(p, dt, game) {
    p.age += dt

    let remaining = CFG.proj.speed * dt
    let bouncesThisFrame = 0
    _dir.copy(p.vel).normalize()

    while (remaining > EPS && bouncesThisFrame <= CFG.proj.maxBouncesPerFrame) {
      let bestT = remaining
      let hitKind = null
      let hitObj = null

      const tw = sweepArena(p.pos, _dir, bestT, CFG.proj.radius, _wallNormal)
      if (tw >= 0) {
        bestT = tw
        hitKind = 'wall'
      }

      for (const d of game.arena.debris) {
        const t = raySphere(p.pos, _dir, bestT, d.pos, d.radius + CFG.proj.radius)
        if (t >= 0) {
          bestT = t
          hitKind = 'debris'
          hitObj = d
        }
      }

      for (const bot of game.bots) {
        if (!bot.alive) continue
        // THE arming rule: a projectile ignores only its own shooter, and only
        // until it has bounced once. After that it is live against everyone,
        // the owner included.
        if (bot.id === p.ownerId && p.bounces === 0) continue
        const t = raySphere(p.pos, _dir, bestT, bot.pos, bot.radius + CFG.proj.radius)
        if (t >= 0) {
          bestT = t
          hitKind = 'bot'
          hitObj = bot
        }
      }

      p.pos.addScaledVector(_dir, bestT)
      remaining -= bestT

      if (!hitKind) break

      if (hitKind === 'bot') {
        // Must be set BEFORE takeDamage: a lethal hit runs onBotKilled
        // synchronously, and the kill feed reads the bounce count from here.
        game.setDamageContext(p)
        hitObj.takeDamage(CFG.proj.directDamage * p.damageScale, p.ownerId, game)
        game.detonate(p, hitObj)
        this._recycle(p)
        return 'gone'
      }

      if (hitKind === 'wall') {
        _normal.copy(_wallNormal)
      } else {
        _normal.subVectors(p.pos, hitObj.pos)
        if (_normal.lengthSq() < 1e-8) _normal.set(0, 1, 0)
        _normal.normalize()
      }

      p.vel.reflect(_normal)
      _dir.copy(p.vel).normalize()
      p.pos.addScaledVector(_normal, 0.03) // ease off the surface

      p.bounces++
      bouncesThisFrame++
      this._applyHeat(p)
      this._pushTrail(p) // kink the trail exactly at the contact point
      game.onProjectileBounce(p, _normal)
    }

    return 'alive'
  }

  _recycle(p) {
    if (!p.alive) return
    p.alive = false
    p.trailCount = 0
    this._hideInstance(p.index)
    this.free.push(p.index)
  }

  clear() {
    for (const p of this.active) this._recycle(p)
    this.active.length = 0
    this.heads.instanceMatrix.needsUpdate = true
    this.trailGeo.setDrawRange(0, 0)
  }

  /**
   * Nearest projectile bearing down on `pos` that could actually damage the bot
   * with id `selfId`. Drives both the enemy EVADE state and the player's
   * INCOMING RICOCHET warning.
   */
  findThreat(pos, withinDist, dotMin, selfId) {
    let best = null
    let bestDist = withinDist

    for (const p of this.active) {
      // Can't be hurt by your own shot until it has bounced.
      if (p.ownerId === selfId && p.bounces === 0) continue

      _tmp.subVectors(pos, p.pos)
      const dist = _tmp.length()
      if (dist > bestDist || dist < 1e-3) continue

      _tmp.multiplyScalar(1 / dist)
      _dir.copy(p.vel).normalize()
      if (_dir.dot(_tmp) < dotMin) continue

      best = p
      bestDist = dist
    }
    return best
  }

  /** Only warn about shots that have already bounced -- those are the surprise. */
  ricochetThreatTo(pos, withinDist) {
    for (const p of this.active) {
      if (p.bounces === 0) continue
      _tmp.subVectors(pos, p.pos)
      const dist = _tmp.length()
      if (dist > withinDist || dist < 1e-3) continue
      _tmp.multiplyScalar(1 / dist)
      _dir.copy(p.vel).normalize()
      if (_dir.dot(_tmp) > 0.93) return p
    }
    return null
  }
}
