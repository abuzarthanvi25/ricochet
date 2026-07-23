import * as THREE from 'three'
import { CFG } from '../config.js'
import { sweepArena, raySphere } from '../core/collision.js'
import { clamp } from '../core/util.js'

const _dir = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _wallNormal = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _colFresh = new THREE.Color(CFG.proj.colorFresh)
const _colArmed = new THREE.Color(CFG.proj.colorArmed)
const _colHot = new THREE.Color(CFG.proj.colorFullyArmed)

const EPS = 1e-5

export class ProjectileSystem {
  constructor(scene) {
    this.scene = scene
    this.pool = []
    this.active = []

    const geo = new THREE.SphereGeometry(CFG.proj.radius, 10, 8)

    for (let i = 0; i < CFG.pools.projectiles; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: CFG.proj.colorFresh,
        toneMapped: false, // let it blow out into the bloom pass
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      scene.add(mesh)

      const n = CFG.fx.trailLength
      const trailGeo = new THREE.BufferGeometry()
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
      const trailMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const trail = new THREE.Line(trailGeo, trailMat)
      trail.visible = false
      trail.frustumCulled = false
      scene.add(trail)

      this.pool.push({
        alive: false,
        ownerId: -1,
        ownerTeam: -1,
        damageScale: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        bounces: 0,
        mesh,
        mat,
        trail,
        trailGeo,
        trailPts: [],
        color: new THREE.Color(),
      })
    }
  }

  spawn(ownerId, ownerTeam, origin, dir, damageScale = 1) {
    const p = this.pool.find((x) => !x.alive)
    if (!p) return null // pool exhausted; dropping a shot beats stuttering

    p.alive = true
    p.ownerId = ownerId
    p.ownerTeam = ownerTeam
    p.damageScale = damageScale
    p.pos.copy(origin)
    p.vel.copy(dir).normalize().multiplyScalar(CFG.proj.speed)
    p.age = 0
    p.bounces = 0
    p.trailPts.length = 0
    p.mesh.visible = true
    p.mesh.position.copy(origin)
    p.trail.visible = true

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
    p.mat.color.copy(p.color)

    const colors = p.trailGeo.attributes.color
    const n = CFG.fx.trailLength
    for (let i = 0; i < n; i++) {
      const fade = 1 - i / n
      colors.setXYZ(i, p.color.r * fade, p.color.g * fade, p.color.b * fade)
    }
    colors.needsUpdate = true
  }

  _pushTrail(p) {
    p.trailPts.unshift(p.pos.x, p.pos.y, p.pos.z)
    const max = CFG.fx.trailLength * 3
    if (p.trailPts.length > max) p.trailPts.length = max

    const attr = p.trailGeo.attributes.position
    const arr = attr.array
    const count = p.trailPts.length / 3
    for (let i = 0; i < p.trailPts.length; i++) arr[i] = p.trailPts[i]
    // Collapse unused vertices onto the last real one so nothing streaks to 0,0,0.
    for (let i = p.trailPts.length; i < arr.length; i += 3) {
      arr[i] = p.trailPts[p.trailPts.length - 3]
      arr[i + 1] = p.trailPts[p.trailPts.length - 2]
      arr[i + 2] = p.trailPts[p.trailPts.length - 1]
    }
    attr.needsUpdate = true
    p.trailGeo.setDrawRange(0, Math.max(2, count))
  }

  update(dt, game) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]
      const outcome = this._step(p, dt, game)

      if (outcome === 'gone') {
        this.active.splice(i, 1)
        continue
      }

      p.mesh.position.copy(p.pos)
      this._pushTrail(p)

      if (p.age >= CFG.proj.lifetime) {
        game.detonate(p, null)
        this._recycle(p)
        this.active.splice(i, 1)
      }
    }
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
    p.alive = false
    p.mesh.visible = false
    p.trail.visible = false
  }

  clear() {
    for (const p of this.active) this._recycle(p)
    this.active.length = 0
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
  ricochetThreatTo(pos, withinDist, selfId) {
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
