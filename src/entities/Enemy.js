import * as THREE from 'three'
import { Bot } from './Bot.js'
import { CFG, HALF } from '../config.js'
import { rand, clamp, interceptTime, jitterDirection } from '../core/util.js'
import { segmentClear } from '../core/collision.js'

const _toTarget = new THREE.Vector3()
const _dirTo = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _steer = new THREE.Vector3()
const _muzzle = new THREE.Vector3()
const _aimAt = new THREE.Vector3()
const _fireDir = new THREE.Vector3()
const _rel = new THREE.Vector3()
const _perp = new THREE.Vector3()
const _pdir = new THREE.Vector3()
const _away = new THREE.Vector3()
const _losBlockers = []
const UP = new THREE.Vector3(0, 1, 0)

export const AI = {
  PATROL: 'PATROL',
  COLLECT: 'COLLECT',
  ENGAGE: 'ENGAGE',
  EVADE: 'EVADE',
  HURT: 'HURT',
}

export class Enemy extends Bot {
  constructor(scene, index) {
    super(scene, {
      team: 'enemy',
      color: CFG.teams.enemy,
      bodyTint: CFG.teams.enemyBody,
      label: `BOT-${String(index + 1).padStart(2, '0')}`,
      maxSpeed: CFG.enemy.maxSpeed,
      drag: CFG.enemy.drag,
      accel: CFG.enemy.accel,
      fireCooldown: CFG.enemy.fireCooldown,
    })

    this.state = AI.PATROL
    this.waypoint = new THREE.Vector3()
    this.strafeSign = Math.random() < 0.5 ? -1 : 1
    this.strafeTimer = rand(1.5, 3)
    this.bobPhase = rand(0, Math.PI * 2)
    this.evadeCd = 0
    this.evadeHold = 0
    this.staggerTimer = 0
    this.respawnTimer = 0
    this.engageDelay = 0
    this.time = 0
    this.diff = null
  }

  /** Re-tune this bot for a difficulty preset. Safe to call mid-match. */
  applyDifficulty(diff) {
    this.diff = diff
    this.maxSpeed = diff.maxSpeed
    this.accel = diff.accel
    this.fireCooldown = diff.fireCooldown
    // Easy tiers make bots less tanky (34 dmg/hit, so botHp 50 => two hits).
    // Clamp current hp in case difficulty drops mid-match; spawnAt refills from
    // this on the next respawn.
    this.maxHp = diff.botHp
    if (this.hp > this.maxHp) this.hp = this.maxHp
  }

  spawnAt(pos) {
    super.spawnAt(pos)
    this.state = AI.PATROL
    this.staggerTimer = 0
    this.evadeCd = 0
    this.evadeHold = 0
    this.respawnTimer = 0
    this.engageDelay = this.diff ? this.diff.reactionDelay : 0
    this._newWaypoint()
  }

  _newWaypoint() {
    const pad = 6
    this.waypoint.set(
      rand(-HALF.x + pad, HALF.x - pad),
      rand(-HALF.y + pad, HALF.y - pad),
      rand(-HALF.z + pad, HALF.z - pad)
    )
  }

  onHurt() {
    this.staggerTimer = CFG.enemy.staggerTime
  }

  think(dt, game) {
    const diff = this.diff || game.diff
    this.time += dt
    this.evadeCd -= dt
    this.evadeHold -= dt

    const player = game.player
    const target = player.alive ? player : null

    // Permaboost, bot flavour: the dodge has no cooldown, so it can break away
    // from every incoming shot instead of one every evadeCooldown seconds.
    if (this.powerup === 'permaboost') this.evadeCd = 0

    // --- EVADE: highest priority, interrupts everything ------------------
    const threat = game.projectiles.findThreat(
      this.pos,
      CFG.enemy.evadeRadius,
      CFG.enemy.evadeDot,
      this.id
    )
    if (threat && this.evadeCd <= 0) {
      this._dodge(threat)
      this.evadeCd = diff.evadeCooldown
      this.evadeHold = 0.35
      this.state = AI.EVADE
    }

    // --- stagger ---------------------------------------------------------
    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt
      this.wish.set(0, 0, 0)
      if (target) this.aimDir.copy(_dirTo.subVectors(target.pos, this.pos).normalize())
      return
    }

    _steer.set(0, 0, 0)
    let dist = Infinity

    if (target) {
      _toTarget.subVectors(target.pos, this.pos)
      dist = _toTarget.length()
      _dirTo.copy(_toTarget).multiplyScalar(1 / Math.max(dist, 1e-4))
    }

    // Only four powerups exist in a whole match, so a bot with an empty slot
    // will break off a fight to contest one. It keeps shooting on the way --
    // COLLECT changes where it flies, not whether it fights.
    const pickup = this.powerup
      ? null
      : game.powerups.nearestAvailable(this.pos, CFG.powerups.seekRadius)

    if (this.evadeHold > 0) {
      // Keep coasting the dodge for a beat instead of instantly re-engaging.
      _steer.copy(this.vel).normalize()
      if (target) this.aimDir.copy(_dirTo)
    } else if (pickup) {
      this.state = AI.COLLECT
      _steer.subVectors(pickup.group.position, this.pos).normalize()
      if (target && dist < diff.engageRange) this.aimDir.copy(_dirTo)
      else this.aimDir.copy(_steer)
    } else if (target && dist < diff.engageRange) {
      // Entering ENGAGE starts a short reaction delay, so a bot that has just
      // spotted you cannot fire on the same frame it turns to face you.
      if (this.state !== AI.ENGAGE) this.engageDelay = diff.reactionDelay
      this.state = AI.ENGAGE
      this._engageSteer(_steer, dist)
      this.aimDir.copy(_dirTo)
    } else {
      this.state = AI.PATROL
      this._patrolSteer(_steer)
    }
    if (this.engageDelay > 0) this.engageDelay -= dt

    this._avoid(_steer, game.arena, game.bots)

    if (_steer.lengthSq() > 1e-6) _steer.normalize()
    this.wish.copy(_steer)

    if (this.state === AI.PATROL && _steer.lengthSq() > 1e-6) this.aimDir.copy(_steer)

    if (target && dist < diff.engageRange) this._tryFire(game, target, diff)
  }

  _engageSteer(out, dist) {
    // Hold a preferred band: close in when far, back off when crowded.
    let radial = 0
    if (dist > CFG.enemy.preferMax) radial = 1
    else if (dist < CFG.enemy.preferMin) radial = -1

    _tangent.crossVectors(_dirTo, UP)
    if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0)
    _tangent.normalize().multiplyScalar(this.strafeSign)

    this.strafeTimer -= 1 / 60
    if (this.strafeTimer <= 0) {
      this.strafeSign *= -1
      this.strafeTimer = rand(1.5, 3)
    }

    out.addScaledVector(_dirTo, radial * 1.1)
    out.addScaledVector(_tangent, 1.0)
    out.y += Math.sin(this.time * 0.8 + this.bobPhase) * 0.45
  }

  _patrolSteer(out) {
    if (this.pos.distanceTo(this.waypoint) < CFG.enemy.waypointReach) this._newWaypoint()
    out.subVectors(this.waypoint, this.pos).normalize()
  }

  /** Steer perpendicular to the incoming shot's line, not just "away from it". */
  _dodge(proj) {
    _pdir.copy(proj.vel).normalize()
    _rel.subVectors(this.pos, proj.pos)
    const along = _rel.dot(_pdir)
    _perp.copy(_rel).addScaledVector(_pdir, -along)

    if (_perp.lengthSq() < 1e-4) {
      _perp.crossVectors(_pdir, UP)
      if (_perp.lengthSq() < 1e-4) _perp.set(1, 0, 0)
    }
    _perp.normalize()
    _perp.y += rand(-0.4, 0.6)
    _perp.normalize()

    this.vel.addScaledVector(_perp, CFG.enemy.evadeImpulse)
    this.overspeed = 0.6
  }

  _avoid(out, arena, bots) {
    const look = CFG.enemy.avoidLookahead
    const strength = CFG.enemy.avoidStrength / 45

    for (const d of arena.debris) {
      _away.subVectors(this.pos, d.pos)
      const gap = _away.length() - d.radius - this.radius
      if (gap > look) continue
      _away.normalize()
      out.addScaledVector(_away, (1 - clamp(gap / look, 0, 1)) * strength * 1.6)
    }

    for (const b of bots) {
      if (b === this || !b.alive || b.team !== this.team) continue
      _away.subVectors(this.pos, b.pos)
      const gap = _away.length() - b.radius - this.radius
      if (gap > 5) continue
      _away.normalize()
      out.addScaledVector(_away, (1 - clamp(gap / 5, 0, 1)) * strength)
    }

    // Wall repulsion, so they stop grinding along the box.
    const margin = 7
    const axes = ['x', 'y', 'z']
    const half = [HALF.x, HALF.y, HALF.z]
    for (let i = 0; i < 3; i++) {
      const a = axes[i]
      const distHigh = half[i] - this.pos[a]
      const distLow = half[i] + this.pos[a]
      if (distHigh < margin) out[a] -= (1 - distHigh / margin) * strength * 2
      if (distLow < margin) out[a] += (1 - distLow / margin) * strength * 2
    }
  }

  _tryFire(game, target, diff) {
    if (!this.canFire()) return
    if (this.engageDelay > 0) return
    // Only the difficulty's allotted number of bots may shoot at once.
    if (!game.canAttack(this)) return

    this.getMuzzleWorld(_muzzle)
    if (!segmentClear(_muzzle, target.pos, game.arena.debris)) return
    // Reuse one scratch array; this runs per bot per frame and the old
    // `bots.filter(...)` allocated a fresh array every call.
    _losBlockers.length = 0
    for (const b of game.bots) {
      if (b.alive && b !== this && b !== target) _losBlockers.push(b)
    }
    if (!segmentClear(_muzzle, target.pos, _losBlockers)) return

    // Lead the shot. If the target somehow outruns the projectile, aim direct.
    // Uses this bot's own muzzle velocity: a permaboosted bot fires faster, and
    // solving with the nominal speed would make it consistently over-lead.
    const t = interceptTime(_muzzle, target.pos, target.vel, this.projSpeed())
    if (t > 0 && t < 4) _aimAt.copy(target.pos).addScaledVector(target.vel, t)
    else _aimAt.copy(target.pos)

    _fireDir.subVectors(_aimAt, _muzzle).normalize()
    jitterDirection(_fireDir, diff.aimJitterDeg)

    this.aimDir.copy(_fireDir)
    this.fire(game, _fireDir)
    this.fireCd += rand(0, diff.fireCooldownJitter)
  }
}
