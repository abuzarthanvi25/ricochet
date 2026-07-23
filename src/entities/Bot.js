import * as THREE from 'three'
import { CFG } from '../config.js'
import { createBotModel, CLIP } from '../core/assets.js'
import { clampToArena, resolveSphere } from '../core/collision.js'
import { clamp, orientToDirection } from '../core/util.js'

let nextId = 1

const _muzzle = new THREE.Vector3()
const _white = new THREE.Color(0xffffff)

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

    this.hp = CFG.bot.maxHp
    this.alive = true
    this.dying = false
    this.deathTimer = 0
    this.fireCd = 0
    this.flashTimer = 0

    this.group = new THREE.Group()
    this.built = createBotModel(color, bodyTint)
    this.group.add(this.built.model)
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

  // ------------------------------------------------------------------ spawn

  spawnAt(pos) {
    this.pos.copy(pos)
    this.vel.set(0, 0, 0)
    this.wish.set(0, 0, 0)
    this.hp = CFG.bot.maxHp
    this.alive = true
    this.dying = false
    this.deathTimer = 0
    this.fireCd = 0
    this.flashTimer = 0

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
      this.vel.addScaledVector(this.wish, this.accel * dt)
    }

    // Frame-rate independent drag. Never `vel *= 0.92` per frame.
    this.vel.multiplyScalar(Math.pow(this.drag, dt))

    const cap = this.maxSpeed * (this.overspeed > 0 ? 2.2 : 1)
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

    if (this.dying) {
      this._updateDeath(dt, game)
      return
    }
    if (!this.alive) return

    this.think(dt, game)
    this.integrate(dt, game.arena, game.bots)
    this.group.position.copy(this.pos)
    this.orient(dt)
    this._updateAnimation(dt)
    this._updateFlash(dt)
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
    this._updateFlash(dt)

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

  _updateFlash(dt) {
    if (this.flashTimer <= 0) return
    this.flashTimer -= dt
    const k = clamp(this.flashTimer / CFG.bot.hurtFlashTime, 0, 1)
    for (const m of this.built.materials) {
      m.emissive.copy(this.built.baseTint).lerp(_white, k)
      m.emissiveIntensity = 1.35 + k * 2.5
    }
    if (this.flashTimer <= 0) {
      for (const m of this.built.materials) {
        m.emissive.copy(this.built.baseTint)
        m.emissiveIntensity = 1.35
      }
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
  }
}
