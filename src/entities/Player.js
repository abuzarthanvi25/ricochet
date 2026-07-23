import * as THREE from 'three'
import { Bot } from './Bot.js'
import { CFG } from '../config.js'
import { isDown, isFiring, consumeBoost } from '../core/input.js'
import { orientToDirection } from '../core/util.js'

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
  }

  spawnAt(pos) {
    super.spawnAt(pos)
    this.boostCd = 0
  }

  think(dt, game) {
    const rig = game.rig
    this.aimDir.copy(rig.forward)

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
    if (w.lengthSq() > 1e-6) w.normalize()

    // Permaboost zeroes the cooldown rather than removing the edge trigger --
    // holding Q must still not chain-dash. See the note in core/input.js.
    const permaboost = this.powerup === 'permaboost'
    if (permaboost) this.boostCd = 0
    else if (this.boostCd > 0) this.boostCd -= dt

    if (consumeBoost() && this.boostCd <= 0) {
      _dir.copy(w.lengthSq() > 1e-6 ? w : rig.forward)
      this.vel.addScaledVector(_dir, CFG.player.boostImpulse)
      if (!permaboost) this.boostCd = CFG.player.boostCooldown
      this.overspeed = 0.9
      game.onPlayerBoost()
    }
    rig.kickFov(this.overspeed > 0.35)

    if (isFiring() && this.canFire()) {
      this.getMuzzleWorld(_origin)
      rig.getAimPoint(game.arena, game.bots, this, _aimPoint)
      _dir.subVectors(_aimPoint, _origin).normalize()
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
