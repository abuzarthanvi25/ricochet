import * as THREE from 'three'
import { Bot } from './Bot.js'
import { CFG } from '../config.js'
import { isDown, isFiring, consumeBoost, getTouchMove } from '../core/input.js'
import { orientToDirection, aimAssist } from '../core/util.js'

const _origin = new THREE.Vector3()
const _aimPoint = new THREE.Vector3()
const _dir = new THREE.Vector3()

export class Player extends Bot {
  constructor(scene) {
    super(scene, {
      team: 'player',
      color: CFG.teams.player,
      bodyTint: CFG.teams.playerBody,
      label: 'YOU',
      maxSpeed: CFG.player.maxSpeed,
      drag: CFG.player.drag,
      accel: CFG.player.accel,
      fireCooldown: CFG.player.fireCooldown,
    })
    this.boostCd = 0
    this.faceDir = new THREE.Vector3(0, 0, -1)
    // Flight assist on by default; main.js overrides from localStorage and the X
    // key toggles it. When on and no thrust is held, integrate() brakes hard.
    this.flightAssist = true
  }

  spawnAt(pos) {
    super.spawnAt(pos)
    this.boostCd = 0
  }

  think(dt, game) {
    const rig = game.rig
    this.aimDir.copy(rig.forward)

    // Health regen on the easy tiers, and only after a lull without being hit.
    // playerRegen is 0 on SOLDIER/VETERAN, so this is a no-op there.
    const regen = game.diff.playerRegen
    if (regen > 0 && this._sinceHit > CFG.player.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + regen * dt)
    }

    // Thrust is camera-relative on the horizontal axes but Space/Shift stay on
    // WORLD up/down. That is the whole trick to making 6-direction flight
    // readable: "up" never rotates out from under you.
    const w = this.wish.set(0, 0, 0)
    if (isDown('KeyW')) w.add(rig.forward)
    if (isDown('KeyS')) w.sub(rig.forward)
    if (isDown('KeyD')) w.add(rig.right)
    if (isDown('KeyA')) w.sub(rig.right)
    if (isDown('Space')) w.y += 1
    if (isDown('ShiftLeft') || isDown('ShiftRight')) w.y -= 1

    // Touch joystick feeds the same camera-relative plane, its buttons the world
    // vertical -- added on top of the keyboard so a hybrid device can use either.
    // The joystick is analog, so its push is scaled, not a full unit like a key.
    const tm = getTouchMove()
    if (tm.y) w.addScaledVector(rig.forward, tm.y)
    if (tm.x) w.addScaledVector(rig.right, tm.x)
    if (tm.vert) w.y += tm.vert

    // Clamp to a unit push so diagonals aren't faster, but PRESERVE a partial
    // analog tilt below full. Every keyboard combination is already magnitude >= 1
    // (a single key is exactly 1), so this is bit-identical to the old normalize
    // for the keyboard and only matters for a half-pushed stick.
    if (w.lengthSq() > 1) w.normalize()

    // Permaboost zeroes the cooldown rather than removing the edge trigger --
    // holding Q must still not chain-dash. See the note in core/input.js.
    // Thrust and top speed come from `powerMul` in Bot.integrate, and shot speed
    // from projSpeed(); this handles the dash itself.
    const PB = CFG.powerups.permaboost
    const permaboost = this.powerup === 'permaboost'
    if (permaboost) this.boostCd = 0
    else if (this.boostCd > 0) this.boostCd -= dt

    if (consumeBoost() && this.boostCd <= 0) {
      _dir.copy(w.lengthSq() > 1e-6 ? w : rig.forward)
      this.vel.addScaledVector(_dir, CFG.player.boostImpulse * (permaboost ? PB.boostMul : 1))
      if (!permaboost) this.boostCd = CFG.player.boostCooldown
      this.overspeed = 0.9
      game.onPlayerBoost()
    }
    // Permaboost holds a wider FOV for its whole duration, so the speed reads on
    // screen instead of only in the numbers. A dash still kicks past it.
    rig.setFov(this.overspeed > 0.35 ? CFG.camera.fovBoost : permaboost ? PB.fov : CFG.camera.fov)

    // Flight assist: brake hard when holding no thrust key and no dash is in
    // flight (overspeed covers a fresh boost or a blast knockback). Read by
    // Bot.integrate on the next line of the frame.
    this._assistBraking = this.flightAssist && w.lengthSq() < 1e-6 && this.overspeed <= 0

    if (isFiring() && this.canFire()) {
      this.getMuzzleWorld(_origin)
      rig.getAimPoint(game.arena, game.bots, this, _aimPoint)
      _dir.subVectors(_aimPoint, _origin).normalize()
      // Bullet magnetism, strength from the difficulty (0 on SOLDIER/VETERAN)
      // and gated by the global options toggle. Nudges only this initial
      // direction; the shot then bounces and arms as any other would.
      const a = CFG.assist
      const strength = game.aimAssistEnabled ? game.diff.aimAssist : 0
      aimAssist(_origin, _dir, game.bots, this, strength, a.coneDeg, a.maxDist)
      this.fire(game, _dir)
    }
  }

  /** The body lags the camera slightly -- reads as the bot *reacting* to you. */
  orient(dt) {
    const t = 1 - Math.exp(-CFG.player.bodyTurnRate * dt)
    this.faceDir.lerp(this.aimDir, t)
    if (this.faceDir.lengthSq() < 1e-6) this.faceDir.copy(this.aimDir)
    this.faceDir.normalize()
    orientToDirection(this.group, this.faceDir, 1)
  }
}
