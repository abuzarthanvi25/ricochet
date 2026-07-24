import * as THREE from 'three'
import { CFG } from '../config.js'
import { createBotModel, CLIP } from '../core/assets.js'
import { clampToArena, resolveSphere } from '../core/collision.js'
import { clamp, orientToDirection } from '../core/util.js'
import { getProjSpeedMul } from '../core/settings.js'

let nextId = 1

const _muzzle = new THREE.Vector3()
const _white = new THREE.Color(0xffffff)
const _frost = new THREE.Color(CFG.powerups.frost.tint)

// Shared by every bot's shield -- geometry is identical, only the tint differs.
// Built lazily on first construction rather than at module load so the headless
// tests can import Bot's siblings without a WebGL context in the way.
let _shieldGeo = null
let _shieldWireGeo = null

/**
 * Shared bot: model + animation state machine + zero-g movement + damage.
 * Player and Enemy differ only in what drives `wish` and `aimDir` each frame.
 */
export class Bot {
  constructor(scene, { team, color, bodyTint, label, maxSpeed, drag, accel, fireCooldown }) {
    this.id = nextId++
    this.team = team
    this.label = label
    this.scene = scene
    this.accel = accel
    this.fireCooldown = fireCooldown
    this.overspeed = 0

    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.wish = new THREE.Vector3()
    this.aimDir = new THREE.Vector3(0, 0, -1)

    this.radius = CFG.bot.radius
    this.maxSpeed = maxSpeed
    this.drag = drag

    // Max HP is an instance field, not the CFG constant: difficulty scales it
    // per bot (Enemy.applyDifficulty) and the player has its own pool. spawnAt
    // must reset from THIS, or a scaled bot silently reverts to 100 on respawn.
    this.maxHp = CFG.bot.maxHp
    this.hp = this.maxHp
    this.alive = true
    this.dying = false
    this.deathTimer = 0
    this.fireCd = 0
    this.flashTimer = 0
    // Seconds since this bot last took damage. Drives the player's regen on the
    // easy tiers; harmless on everyone else.
    this._sinceHit = 0

    // Powerups. One slot, no swapping -- see equip().
    this.powerup = null
    this.powerupTimer = 0
    // A plain number rather than a method: weapons/projectiles.js reads it in
    // the sweep, and keeping it a field lets the headless tests use plain
    // object mocks with no extra stubbing.
    this.shieldRadius = 0
    this.speedMul = 1 // frostile slow
    this.powerMul = 1 // permaboost
    this.slowTimer = 0
    this._tint = null
    // Flight assist braking flag, set by Player each frame; bots leave it false.
    this._assistBraking = false

    this.group = new THREE.Group()
    this.built = createBotModel(color, bodyTint)
    this.group.add(this.built.model)
    this._buildShield(color)
    scene.add(this.group)

    this.mixer = new THREE.AnimationMixer(this.built.model)
    this.actions = {}
    for (const name of Object.values(CLIP)) {
      const clip = this.built.clips[name]
      const action = this.mixer.clipAction(clip)
      action.enabled = true
      this.actions[name] = action
    }

    // Locomotion is a continuous two-clip blend that never stops running; the
    // one-shots (Shoot / Hurt / Death) ride on top and fade the blend out.
    this.actions[CLIP.IDLE].setEffectiveWeight(1).play()
    this.actions[CLIP.MOVE].setEffectiveWeight(0).play()
    this.override = null
  }

  /**
   * Two-layer bubble: a faint solid shell plus a geodesic wireframe. Built once
   * here and only ever toggled with `visible` -- adding a mesh (or worse, a
   * light) mid-fight would change shader program keys and stall a frame.
   * `main.js` warms these up while the title screen is still on.
   */
  _buildShield(teamColor) {
    const r = CFG.powerups.shield.radius
    if (!_shieldGeo) _shieldGeo = new THREE.IcosahedronGeometry(r, 2)
    // Detail 1 on purpose: a coarse cage reads as a shield, while a fine mesh
    // just becomes a solid ball once bloom gets hold of it.
    if (!_shieldWireGeo) _shieldWireGeo = new THREE.IcosahedronGeometry(r, 1)

    this.shield = new THREE.Group()
    this.shield.visible = false

    const common = {
      color: teamColor,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      // The player's own camera sits close enough to end up inside the bubble.
      side: THREE.DoubleSide,
    }
    // These opacities look absurdly low written down. They are not: additive
    // blending skips tone mapping and then feeds UnrealBloomPass, which is well
    // over threshold at 0.35 -- at 0.1/0.45 the bubble blew out to an opaque
    // white ball that hid the bot inside it entirely.
    this.shieldMat = new THREE.MeshBasicMaterial({ ...common, opacity: 0.03 })
    this.shieldWireMat = new THREE.MeshBasicMaterial({
      ...common,
      opacity: 0.13,
      wireframe: true,
    })

    this.shield.add(new THREE.Mesh(_shieldGeo, this.shieldMat))
    this.shield.add(new THREE.Mesh(_shieldWireGeo, this.shieldWireMat))
    this.group.add(this.shield)
  }

  // --------------------------------------------------------------- powerups

  /**
   * One slot, no swapping: PowerupSystem refuses to hand one over while
   * `this.powerup` is set, so this only ever fills an empty slot.
   */
  equip(id) {
    this.powerup = id
    this.powerupTimer = CFG.powerups.duration
    this._applyPowerupState()
  }

  clearPowerup() {
    this.powerup = null
    this.powerupTimer = 0
    this._applyPowerupState()
  }

  /** Fraction of the powerup's life left, for the HUD ring. */
  powerup01() {
    return this.powerup ? clamp(this.powerupTimer / CFG.powerups.duration, 0, 1) : 0
  }

  _applyPowerupState() {
    const shielded = this.powerup === 'shield'
    this.shieldRadius = shielded ? CFG.powerups.shield.radius : 0
    if (this.shield) this.shield.visible = shielded

    // Kept separate from `speedMul` (the frostile slow) so the two multiply.
    // Being frozen while permaboosted should leave you slow-but-less-slow, not
    // hand whichever effect landed last the final say.
    this.powerMul = this.powerup === 'permaboost' ? CFG.powerups.permaboost.speedMul : 1
  }

  _updatePowerup(dt) {
    if (!this.powerup) return

    this.powerupTimer -= dt
    if (this.powerupTimer <= 0) {
      this.clearPowerup()
      this.onPowerupEnd?.()
      return
    }

    if (this.shieldRadius > 0) {
      // Flickers out over the last second so its end is never a surprise.
      const fade = clamp(this.powerupTimer / 1.0, 0, 1)
      const pulse = 0.5 + 0.5 * Math.sin(this.powerupTimer * 9)
      this.shieldMat.opacity = (0.02 + 0.025 * pulse) * fade
      this.shieldWireMat.opacity = (0.09 + 0.08 * pulse) * fade
    }
  }

  /** Frostile hit. Strongest slow and longest timer win, so stacking cannot shorten one. */
  applySlow(duration, mul) {
    const wasFree = this.slowTimer <= 0
    this.slowTimer = Math.max(this.slowTimer, duration)
    this.speedMul = Math.min(this.speedMul, mul)
    // Only on the transition -- a second frostile mid-freeze must not re-fire
    // the cue, or a sustained freeze turns into a stutter of overlapping sounds.
    if (wasFree) this.onSlowed?.()
  }

  _updateSlow(dt) {
    if (this.slowTimer <= 0) return
    this.slowTimer -= dt
    if (this.slowTimer <= 0) {
      this.slowTimer = 0
      this.speedMul = 1
    }
  }

  /** What this bot's shots currently are. Read by Game.spawnProjectile. */
  projKind() {
    return this.powerup === 'rocketiles' ? 'rocket' : 'blast'
  }

  projMod() {
    return this.powerup === 'frostiles' ? 'frost' : null
  }

  /**
   * Muzzle velocity for this bot right now. Speed is per-projectile rather than
   * a global constant because permaboost makes your shots faster; the enemy
   * lead-aim solver reads this too, or a permaboosted bot would consistently
   * lead too far.
   */
  projSpeed() {
    // Global player-set multiplier times the permaboost multiplier. Reading it
    // here is what keeps the enemy lead-aim solver honest -- Enemy._tryFire
    // solves the intercept with projSpeed(), so both scale together.
    const base = CFG.proj.speed * getProjSpeedMul()
    return this.powerup === 'permaboost' ? base * CFG.powerups.permaboost.projSpeedMul : base
  }

  // ------------------------------------------------------------------ spawn

  spawnAt(pos) {
    this.pos.copy(pos)
    this.vel.set(0, 0, 0)
    this.wish.set(0, 0, 0)
    this.hp = this.maxHp
    this._sinceHit = 0
    this.alive = true
    this.dying = false
    this.deathTimer = 0
    this.fireCd = 0
    this.flashTimer = 0
    this.slowTimer = 0
    this.speedMul = 1
    this._tint = null
    this.clearPowerup()

    if (this.override) {
      this.override.action.stop()
      this.override = null
    }
    this.actions[CLIP.DEATH].stop()
    this.actions[CLIP.IDLE].reset().setEffectiveWeight(1).play()
    this.actions[CLIP.MOVE].reset().setEffectiveWeight(0).play()

    this.group.visible = true
    this.group.position.copy(pos)
    this.group.rotation.set(0, 0, 0)
    for (const m of this.built.materials) {
      m.opacity = 1
      m.emissive.copy(this.built.baseTint)
    }
  }

  // -------------------------------------------------------------- animation

  playOverride(name) {
    if (this.override && this.override.name === CLIP.DEATH) return
    if (this.override) this.override.action.stop()

    const action = this.actions[name]
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveWeight(0)
    action.play()

    this.override = { name, action, t: 0, dur: action.getClip().duration }
  }

  _updateAnimation(dt) {
    let overrideWeight = 0

    if (this.override) {
      const o = this.override
      o.t += dt
      const fadeIn = 0.06
      const fadeOut = o.name === CLIP.SHOOT ? Math.min(0.12, o.dur * 0.35) : 0.16

      if (o.name === CLIP.DEATH) {
        overrideWeight = clamp(o.t / fadeIn, 0, 1) // death never fades back out
      } else {
        overrideWeight = clamp(Math.min(o.t / fadeIn, (o.dur - o.t) / fadeOut), 0, 1)
        if (o.t >= o.dur) {
          o.action.stop()
          this.override = null
          overrideWeight = 0
        }
      }
      if (this.override) this.override.action.setEffectiveWeight(overrideWeight)
    }

    const loco = 1 - overrideWeight
    const speed01 = clamp((this.vel.length() / this.maxSpeed) * 1.4, 0, 1)
    this.actions[CLIP.IDLE].setEffectiveWeight(loco * (1 - speed01))
    this.actions[CLIP.MOVE].setEffectiveWeight(loco * speed01)

    this.mixer.update(dt)
  }

  // ---------------------------------------------------------------- physics

  integrate(dt, arena, others) {
    if (this.wish.lengthSq() > 1e-6) {
      // Frostile slow scales thrust and the cap, never maxSpeed/accel
      // themselves -- Enemy.applyDifficulty() rewrites those, so a slow stored
      // there would silently vanish on a mid-match difficulty change.
      this.vel.addScaledVector(this.wish, this.accel * this.speedMul * this.powerMul * dt)
    }

    // Frame-rate independent drag. Never `vel *= 0.92` per frame. Flight assist
    // (player only) swaps in a much stronger drag while no thrust is held and no
    // dash is in flight, so the ship settles to a near-stop in about half a
    // second instead of drifting on. Bots never set _assistBraking -- their
    // coasting drift is part of how they read.
    const dragK = this._assistBraking ? CFG.player.assistDrag : this.drag
    this.vel.multiplyScalar(Math.pow(dragK, dt))

    const cap = this.maxSpeed * this.speedMul * this.powerMul * (this.overspeed > 0 ? 2.2 : 1)
    const sp = this.vel.length()
    if (sp > cap) this.vel.multiplyScalar(cap / sp)

    this.pos.addScaledVector(this.vel, dt)

    clampToArena(this.pos, this.vel, this.radius)
    for (const d of arena.debris) {
      resolveSphere(this.pos, this.vel, this.radius, d.pos, d.radius)
    }
    if (others) {
      for (const o of others) {
        if (o === this || !o.alive) continue
        resolveSphere(this.pos, this.vel, this.radius, o.pos, o.radius, 0.2)
      }
    }
  }

  // ----------------------------------------------------------------- combat

  getMuzzleWorld(out = _muzzle) {
    const m = this.built.muzzle
    if (!m) return out.copy(this.pos).addScaledVector(this.aimDir, this.radius)
    // Walk the ancestors so the bone is current even mid-frame.
    m.updateWorldMatrix(true, false)
    return out.setFromMatrixPosition(m.matrixWorld)
  }

  canFire() {
    return this.alive && this.fireCd <= 0
  }

  fire(game, dir) {
    if (!this.canFire()) return null
    this.fireCd = this.fireCooldown
    this.playOverride(CLIP.SHOOT)
    const origin = this.getMuzzleWorld(new THREE.Vector3())
    return game.spawnProjectile(this, origin, dir)
  }

  takeDamage(amount, attackerId, game) {
    if (!this.alive) return
    this.hp -= amount
    this._sinceHit = 0
    this.flashTimer = CFG.bot.hurtFlashTime

    if (this.hp <= 0) {
      this.hp = 0
      this.die(attackerId, game)
    } else {
      this.playOverride(CLIP.HURT)
      this.onHurt?.(amount, attackerId)
    }
  }

  die(attackerId, game) {
    this.alive = false
    this.dying = true
    this.deathTimer = 0
    // You lose whatever you were holding. A scarce powerup that survived death
    // would make the holder strictly better off for dying.
    this.clearPowerup()
    this.playOverride(CLIP.DEATH)
    this.deathSpin = new THREE.Vector3(
      (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 1.6
    )
    game.onBotKilled(this, attackerId)
  }

  // ------------------------------------------------------------------ frame

  update(dt, game) {
    if (this.fireCd > 0) this.fireCd -= dt
    if (this.overspeed > 0) this.overspeed -= dt
    this._sinceHit += dt
    this._updateSlow(dt)

    if (this.dying) {
      this._updateDeath(dt, game)
      return
    }
    if (!this.alive) return

    this._updatePowerup(dt)
    this.think(dt, game)
    this.integrate(dt, game.arena, game.bots)
    this.group.position.copy(this.pos)
    this.orient(dt)
    this._updateAnimation(dt)
    this._updateTint(dt)
  }

  _updateDeath(dt, game) {
    this.deathTimer += dt

    // Zero-g: a dead bot keeps its momentum and tumbles instead of falling.
    this.vel.multiplyScalar(Math.pow(0.35, dt))
    this.pos.addScaledVector(this.vel, dt)
    clampToArena(this.pos, this.vel, this.radius)
    this.group.position.copy(this.pos)
    this.group.rotateX(this.deathSpin.x * dt)
    this.group.rotateZ(this.deathSpin.z * dt)

    this._updateAnimation(dt)
    this._updateTint(dt)

    const fadeStart = CFG.bot.deathSinkTime * 0.45
    if (this.deathTimer > fadeStart) {
      const k = clamp(1 - (this.deathTimer - fadeStart) / (CFG.bot.deathSinkTime - fadeStart), 0, 1)
      for (const m of this.built.materials) m.opacity = k
    }

    if (this.deathTimer >= CFG.bot.deathSinkTime) {
      this.dying = false
      this.group.visible = false
      this.onDeathComplete?.(game)
    }
  }

  /**
   * Hurt flash on top of a resting tint that goes frost-blue while slowed.
   * Writing `emissive` is a uniform update and safe every frame; adding a
   * define or toggling `transparent` here would recompile the material.
   */
  _updateTint(dt) {
    const resting = this.slowTimer > 0 ? _frost : this.built.baseTint

    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      const k = clamp(this.flashTimer / CFG.bot.hurtFlashTime, 0, 1)
      for (const m of this.built.materials) {
        m.emissive.copy(resting).lerp(_white, k)
        m.emissiveIntensity = 1.35 + k * 2.5
      }
      if (this.flashTimer <= 0) this.flashTimer = 0
      this._tint = null // force a rewrite on the frame the flash ends
      return
    }

    if (this._tint === resting) return
    this._tint = resting
    for (const m of this.built.materials) {
      m.emissive.copy(resting)
      m.emissiveIntensity = 1.35
    }
  }

  /** Snap to the aim direction. Player overrides this to lag the body. */
  orient() {
    orientToDirection(this.group, this.aimDir, 1)
  }

  /** Subclasses fill `wish` (unit accel direction) and `aimDir`. */
  think() {}

  dispose() {
    this.scene.remove(this.group)
    for (const m of this.built.materials) m.dispose()
    this.shieldMat?.dispose()
    this.shieldWireMat?.dispose()
  }
}
