import * as THREE from 'three'
import { CFG } from '../config.js'
import { Arena } from './arena.js'
import { CameraRig } from './camera.js'
import { Player } from '../entities/Player.js'
import { Enemy } from '../entities/Enemy.js'
import { ProjectileSystem } from '../weapons/projectiles.js'
import { ExplosionSystem } from '../fx/explosions.js'
import { LightPool } from '../fx/lights.js'
import { sfx } from '../fx/audio.js'
import { clamp } from './util.js'
import { Nameplates } from '../ui/nameplates.js'
import { getDifficulty, loadDifficulty, saveDifficulty } from './difficulty.js'
import { PowerupSystem, POWERUPS } from './powerups.js'

const _v = new THREE.Vector3()

export const STATE = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over',
  WON: 'won',
}

export class Game {
  constructor({ scene, camera, hud, overlays }) {
    this.scene = scene
    this.camera = camera
    this.hud = hud
    this.overlays = overlays

    this.state = STATE.IDLE
    this.score = { you: 0, them: 0 }
    this.time = 0
    this.viewport = { width: window.innerWidth, height: window.innerHeight }

    this.arena = new Arena(scene)
    this.rig = new CameraRig(camera)
    this.projectiles = new ProjectileSystem(scene)
    this.explosions = new ExplosionSystem(scene)
    this.lights = new LightPool(scene)

    this.powerups = new PowerupSystem(scene)
    this.powerups.onCollect = (bot, type) => this._onPowerupCollected(bot, type)

    this.player = new Player(scene)
    this.player.onHurt = () => {
      this.hud.flashDamage()
      this.rig.addShake(0.35)
      sfx.hurt()
    }
    this.player.onPowerupEnd = () => sfx.powerDown()
    this.player.respawnTimer = 0

    this.enemies = []
    for (let i = 0; i < CFG.enemy.count; i++) this.enemies.push(new Enemy(scene, i))

    this.bots = [this.player, ...this.enemies]
    this.damageContext = { bounces: 0, ownerId: -1 }
    this._warnOn = false

    this.nameplates = new Nameplates(document.getElementById('nameplates'))
    for (const e of this.enemies) this.nameplates.register(e)

    this.attackers = new Set()
    this._ranked = []
    this._addLight = (pos, color, intensity) => this.lights.add(pos, color, intensity)
    this.setDifficulty(loadDifficulty())
  }

  // ------------------------------------------------------------- difficulty

  setDifficulty(id) {
    this.difficultyId = getDifficulty(id).id
    this.diff = getDifficulty(id)
    for (const e of this.enemies) e.applyDifficulty(this.diff)
    saveDifficulty(this.difficultyId)
    this.onDifficultyChange?.(this.difficultyId)
  }

  /**
   * Only the N enemies closest to the player may open fire, where N comes from
   * the difficulty. Everyone else keeps flying and repositioning, so the arena
   * stays busy without the player eating four simultaneous firing solutions.
   */
  _updateAttackerSlots() {
    this.attackers.clear()
    if (!this.player.alive) return

    this._ranked.length = 0
    for (const e of this.enemies) {
      if (e.alive) this._ranked.push(e)
    }
    const p = this.player.pos
    this._ranked.sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p))

    const n = Math.min(this.diff.maxAttackers, this._ranked.length)
    for (let i = 0; i < n; i++) this.attackers.add(this._ranked[i])
  }

  canAttack(enemy) {
    return this.attackers.has(enemy)
  }

  // ------------------------------------------------------------------- flow

  reset() {
    this.score.you = 0
    this.score.them = 0
    this.time = 0
    this.projectiles.clear()
    this.explosions.clear()
    this.powerups.reset()
    this.hud.clearKills()

    this.player.spawnAt(this.arena.findSpawn(this.player.radius))
    this.player.respawnTimer = 0

    const taken = [this.player.pos]
    for (const e of this.enemies) {
      const p = this.arena.findSpawn(e.radius, taken)
      e.spawnAt(p)
      taken.push(p)
    }

    this.rig.reset(this.player)
    this.hud.setScore(0, 0, CFG.match.killsToWin)
    this.hud.setHp(this.player.hp, CFG.bot.maxHp)
    this.hud.setWarn(false)
    this.hud.setPowerup(null, 0)
    this.attackers.clear()
    this.nameplates.hideAll()
  }

  start() {
    this.reset()
    this.state = STATE.PLAYING
  }

  pause() {
    if (this.state === STATE.PLAYING) this.state = STATE.PAUSED
  }

  resume() {
    if (this.state === STATE.PAUSED) this.state = STATE.PLAYING
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    if (this.state !== STATE.PLAYING) {
      // Keep the camera alive on the pause/game-over screens so the arena
      // still drifts behind the overlay.
      this.arena.update(dt)
      this.rig.update(dt, this.player, this.arena)
      this.nameplates.hideAll()
      return
    }

    this.time += dt

    // Refresh the aim basis from this frame's mouse BEFORE the bots think, or
    // the player aims one frame stale and the crosshair lags the shot.
    this.rig._rebuildBasis()

    this.arena.update(dt)

    this._updateAttackerSlots()
    for (const b of this.bots) b.update(dt, this)
    // After the bots have moved, so a pickup is collected the frame you reach
    // it rather than the frame after.
    this.powerups.update(dt, this)
    this._handleRespawns(dt)

    this.projectiles.update(dt, this)
    this.explosions.update(dt)

    this.rig.update(dt, this.player, this.arena)

    this._updateLights()
    this._updateHud()
    this.nameplates.update(this.camera, this.bots, this.arena, this.viewport)
  }

  _handleRespawns(dt) {
    for (const e of this.enemies) {
      if (e.alive || e.dying) continue
      e.respawnTimer -= dt
      if (e.respawnTimer <= 0) {
        e.spawnAt(this.arena.findSpawn(e.radius, [this.player.pos]))
      }
    }

    const p = this.player
    if (!p.alive && !p.dying) {
      p.respawnTimer -= dt
      if (p.respawnTimer <= 0) {
        p.spawnAt(
          this.arena.findSpawn(
            p.radius,
            this.enemies.filter((e) => e.alive).map((e) => e.pos)
          )
        )
        this.rig.snapNext = true
      }
    }
  }

  _updateLights() {
    this.lights.begin()
    for (const p of this.projectiles.active) {
      this.lights.add(p.pos, p.color, CFG.fx.lightIntensity)
    }
    // Bound once in the constructor -- this runs every frame.
    this.explosions.collectLights(this._addLight)
    this.lights.commit(this.camera.position)
  }

  _onPowerupCollected(bot, type) {
    const preset = POWERUPS[type]
    if (bot === this.player) {
      sfx.powerUp()
      this.hud.announcePowerup(preset)
    } else {
      sfx.powerUpRemote(bot.pos.distanceTo(this.camera.position))
    }
    this.hud.addKill({
      killer: bot === this.player ? 'YOU' : bot.label,
      killerTeam: bot.team,
      victim: preset.label,
      victimTeam: 'powerup',
      verb: 'PICKED UP',
    })
  }

  _updateHud() {
    const p = this.player
    this.hud.setHp(p.alive ? p.hp : 0, CFG.bot.maxHp)
    this.hud.setCooldown(p.alive ? 1 - clamp(p.fireCd / CFG.player.fireCooldown, 0, 1) : 0)
    this.hud.setBoost(p.alive ? 1 - clamp(p.boostCd / CFG.player.boostCooldown, 0, 1) : 0)
    this.hud.setPowerup(p.alive ? p.powerup : null, p.powerup01())

    const threat = p.alive ? this.projectiles.ricochetThreatTo(p.pos, 26, p.id) : null
    const on = !!threat
    if (on !== this._warnOn) {
      this._warnOn = on
      this.hud.setWarn(on)
      if (on) sfx.warn()
    }
  }

  // ------------------------------------------------------------- projectiles

  spawnProjectile(owner, origin, dir) {
    // Difficulty scales enemy damage only. A player's own ricochet always comes
    // back at full strength -- that rule should never get easier.
    const scale = owner.team === 'enemy' ? this.diff.damageScale : 1
    const p = this.projectiles.spawn(
      owner.id,
      owner.team,
      origin,
      dir,
      scale,
      owner.projKind(),
      owner.projMod()
    )
    if (p) sfx.fire(origin.distanceTo(this.camera.position))
    return p
  }

  onProjectileBounce(p, _normal, hitKind) {
    const dist = p.pos.distanceTo(this.camera.position)
    if (hitKind === 'shield') sfx.shieldHit(dist)
    else sfx.bounce(p.bounces, dist)
  }

  setDamageContext(p) {
    this.damageContext.bounces = p.bounces
    this.damageContext.ownerId = p.ownerId
  }

  /**
   * Blast on expiry or on a direct hit. `directHitBot` already took the direct
   * damage, so it is skipped here rather than double-dipping.
   */
  detonate(p, directHitBot) {
    this.explosions.spawn(p.pos, p.color)
    const camDist = p.pos.distanceTo(this.camera.position)
    sfx.explode(camDist)
    this.rig.addShake(clamp(1 - camDist / 30, 0, 1) * 0.5)

    this.setDamageContext(p)

    for (const bot of this.bots) {
      if (!bot.alive || bot === directHitBot) continue
      if (bot.id === p.ownerId && p.bounces === 0) continue

      const d = bot.pos.distanceTo(p.pos)
      if (d > CFG.proj.blastRadius + bot.radius) continue

      const falloff = 1 - clamp((d - bot.radius) / CFG.proj.blastRadius, 0, 1)

      _v.subVectors(bot.pos, p.pos)
      if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0)
      _v.normalize()
      // Knockback before damage, so a lethal blast still throws the corpse.
      bot.vel.addScaledVector(_v, CFG.proj.blastKnock * falloff)
      bot.overspeed = 0.5

      bot.takeDamage(CFG.proj.blastDamage * falloff * p.damageScale, p.ownerId, this)
      if (bot === this.player) this.hud.flashDamage()
      else if (bot.alive) this.hud.hitmarker(false)
    }
  }

  // ------------------------------------------------------------------ kills

  onBotKilled(victim, attackerId) {
    const killer = this.bots.find((b) => b.id === attackerId) || null
    const bounced = this.damageContext.bounces > 0
    const selfKill = killer === victim

    sfx.death(victim.pos.distanceTo(this.camera.position))

    if (victim.team === 'enemy') {
      // Counts down only once the death animation has finished, so this is the
      // delay *after* the corpse clears -- not the total time dead.
      victim.respawnTimer = CFG.enemy.respawnDelay

      if (killer === this.player) {
        this.score.you++
        this.hud.hitmarker(true)
        sfx.kill()
        this.hud.addKill({
          killer: 'YOU',
          killerTeam: 'player',
          victim: victim.label,
          victimTeam: 'enemy',
          verb: bounced ? 'RICOCHET' : 'DIRECT',
        })
      } else if (selfKill) {
        // A bot killed by its own bounced shot. No score, but it is worth seeing.
        this.hud.addKill({
          killer: null,
          victim: victim.label,
          victimTeam: 'enemy',
          verb: 'OWN RICOCHET',
        })
      } else {
        this.hud.addKill({
          killer: killer ? killer.label : 'BLAST',
          killerTeam: 'enemy',
          victim: victim.label,
          victimTeam: 'enemy',
          verb: bounced ? 'RICOCHET' : 'DIRECT',
        })
      }
    } else {
      victim.respawnTimer = CFG.match.playerRespawnDelay
      this.rig.addShake(0.9)

      if (selfKill) {
        // Killed by your own ricochet: the mechanic biting back. Costs a point.
        this.score.you = Math.max(0, this.score.you - 1)
        this.hud.addKill({
          killer: null,
          victim: 'YOU',
          victimTeam: 'player',
          verb: 'OWN RICOCHET',
        })
      } else {
        this.score.them++
        this.hud.addKill({
          killer: killer ? killer.label : 'BLAST',
          killerTeam: 'enemy',
          victim: 'YOU',
          victimTeam: 'player',
          verb: bounced ? 'RICOCHET' : 'DIRECT',
        })
      }
    }

    this.hud.setScore(this.score.you, this.score.them, CFG.match.killsToWin)
    this._checkMatchEnd()
  }

  _checkMatchEnd() {
    if (this.score.you >= CFG.match.killsToWin) {
      this.state = STATE.WON
      sfx.win()
      this.onMatchEnd?.('win', this.score)
    } else if (this.score.them >= CFG.match.killsToWin) {
      this.state = STATE.OVER
      sfx.lose()
      this.onMatchEnd?.('lose', this.score)
    }
  }

  onPlayerBoost() {
    sfx.boost()
  }

  // ------------------------------------------------------------------ debug

  debugText(fps) {
    const p = this.player
    let maxBounce = 0
    for (const pr of this.projectiles.active) maxBounce = Math.max(maxBounce, pr.bounces)
    return [
      `fps       ${fps.toFixed(0)}`,
      `speed     ${p.vel.length().toFixed(1)} / ${p.maxSpeed}`,
      `pos       ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}`,
      `proj      ${this.projectiles.active.length} / ${CFG.pools.projectiles}`,
      `maxbounce ${maxBounce}`,
      `enemies   ${this.enemies.filter((e) => e.alive).length} alive`,
      `states    ${this.enemies.map((e) => (e.alive ? e.state[0] : '-')).join(' ')}`,
      `powerups  ${this.powerups.active} out, ${this.powerups.remaining} left this match`,
      `equipped  ${this.bots.map((b) => (b.powerup ? b.powerup[0].toUpperCase() : '-')).join(' ')}`,
      `drawcalls ${this._drawCalls ?? 0}`,
    ].join('\n')
  }
}
