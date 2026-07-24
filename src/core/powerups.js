import * as THREE from 'three'
import { CFG } from '../config.js'
import { rand } from './util.js'

/**
 * Powerup registry. One source of truth for the in-world mesh tint, the HUD
 * icon and the nameplate badge -- same shape as core/difficulty.js.
 *
 * `glyph` names an <svg> symbol defined once in index.html; the HUD and the
 * nameplates both <use> it rather than each shipping their own artwork.
 */
export const POWERUPS = {
  shield: {
    id: 'shield',
    label: 'SHIELD',
    color: CFG.powerups.shield.color,
    glyph: 'gl-shield',
    blurb: 'Shots bounce off you — and arm against whoever fired them.',
  },
  permaboost: {
    id: 'permaboost',
    label: 'PERMABOOST',
    color: CFG.powerups.permaboost.color,
    glyph: 'gl-boost',
    blurb: 'Faster flight and faster shots. Dash with no cooldown.',
  },
  frostiles: {
    id: 'frostiles',
    label: 'FROSTILES',
    color: CFG.powerups.frost.color,
    glyph: 'gl-frost',
    blurb: 'Direct hits slow the target to a crawl for 2.5s.',
  },
  rocketiles: {
    id: 'rocketiles',
    label: 'ROCKETILES',
    color: CFG.powerups.rocket.color,
    glyph: 'gl-rocket',
    blurb: 'Your shots hunt the nearest bot. Including you, once bounced.',
  },
}

export const POWERUP_IDS = Object.keys(POWERUPS)

/** Distinct core geometry per type, so a pickup is readable before you are close enough to see the colour. */
const CORE_GEOS = {
  shield: () => new THREE.IcosahedronGeometry(0.55, 0),
  permaboost: () => new THREE.ConeGeometry(0.42, 1.0, 5),
  frostiles: () => new THREE.OctahedronGeometry(0.6, 0),
  rocketiles: () => new THREE.TetrahedronGeometry(0.7, 0),
}

const _v = new THREE.Vector3()

/**
 * The pickups floating in the arena.
 *
 * Exactly `budgetPerMatch` spawn per match, one of each type in a shuffled
 * order, so a match always offers all four but never the same one twice.
 *
 * Every mesh is built in the constructor and only ever toggled with `visible`.
 * Nothing is added to or removed from the scene at runtime, and no lights are
 * created -- both would change shader program keys mid-fight (see fx/lights.js).
 */
export class PowerupSystem {
  constructor(scene) {
    this.scene = scene
    this.slots = []
    this.time = 0
    this.spawned = 0
    this.nextSpawnAt = CFG.powerups.firstSpawnDelay
    this.queue = []
    this.onCollect = null

    const shellGeo = new THREE.IcosahedronGeometry(CFG.powerups.pickupRadius, 1)
    const coreGeos = {}
    for (const id of POWERUP_IDS) coreGeos[id] = CORE_GEOS[id]()

    for (let i = 0; i < CFG.powerups.budgetPerMatch; i++) {
      const group = new THREE.Group()
      group.visible = false

      // Additive + toneMapped:false lets bloom do the glow, so a pickup reads
      // as a light source without costing one from the fixed light pool. Keep
      // the opacities low: additive stacking past ~0.4 saturates to white and
      // the type colour -- the whole point of the tint -- disappears.
      const shellMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const shell = new THREE.Mesh(shellGeo, shellMat)
      group.add(shell)

      const cores = {}
      const coreMats = {}
      for (const id of POWERUP_IDS) {
        const mat = new THREE.MeshBasicMaterial({
          color: POWERUPS[id].color,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
        const mesh = new THREE.Mesh(coreGeos[id], mat)
        mesh.visible = false
        group.add(mesh)
        cores[id] = mesh
        coreMats[id] = mat
      }

      scene.add(group)
      this.slots.push({
        group,
        shell,
        shellMat,
        cores,
        coreMats,
        alive: false,
        type: null,
        pos: new THREE.Vector3(),
        radius: CFG.powerups.pickupRadius,
        phase: rand(0, Math.PI * 2),
      })
    }

    this.reset()
  }

  // ------------------------------------------------------------------- flow

  reset() {
    this.time = 0
    this.spawned = 0
    this.nextSpawnAt = CFG.powerups.firstSpawnDelay
    // Shuffled so the order surprises, but all four types appear in a match.
    this.queue = POWERUP_IDS.slice()
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]]
    }
    for (const s of this.slots) this._despawn(s)
  }

  /** How many are still to come -- drives the "last one" HUD tell. */
  get remaining() {
    return Math.max(0, CFG.powerups.budgetPerMatch - this.spawned)
  }

  get active() {
    let n = 0
    for (const s of this.slots) if (s.alive) n++
    return n
  }

  // ------------------------------------------------------------------ frame

  update(dt, game) {
    this.time += dt

    if (this.queue.length && this.time >= this.nextSpawnAt) {
      this._spawn(game)
      this.nextSpawnAt = this.time + CFG.powerups.spawnInterval
    }

    const { bobAmp, bobRate, spinRate } = CFG.powerups

    for (const s of this.slots) {
      if (!s.alive) continue

      const bob = Math.sin(this.time * bobRate + s.phase) * bobAmp
      s.group.position.set(s.pos.x, s.pos.y + bob, s.pos.z)
      s.group.rotation.y += spinRate * dt
      s.shell.rotation.x -= spinRate * 0.6 * dt
      s.cores[s.type].rotation.x += spinRate * 1.7 * dt

      // Pulse so a pickup catches the eye across the arena.
      s.shellMat.opacity = 0.18 + 0.16 * (0.5 + 0.5 * Math.sin(this.time * 3 + s.phase))

      for (const bot of game.bots) {
        if (!bot.alive || bot.powerup) continue
        _v.subVectors(bot.pos, s.group.position)
        const reach = bot.radius + s.radius
        if (_v.lengthSq() > reach * reach) continue
        this._collect(s, bot)
        break
      }
    }
  }

  _spawn(game) {
    const slot = this.slots.find((s) => !s.alive)
    if (!slot) return

    const type = this.queue.shift()
    const avoid = game.bots.filter((b) => b.alive).map((b) => b.pos)
    slot.pos.copy(game.arena.findSpawn(CFG.powerups.pickupRadius, avoid))
    slot.type = type
    slot.alive = true
    slot.phase = rand(0, Math.PI * 2)
    slot.shellMat.color.set(POWERUPS[type].color)

    for (const id of POWERUP_IDS) slot.cores[id].visible = id === type
    slot.group.position.copy(slot.pos)
    slot.group.visible = true

    this.spawned++
  }

  _collect(slot, bot) {
    const type = slot.type
    this._despawn(slot)
    bot.equip(type)
    this.onCollect?.(bot, type)
  }

  _despawn(slot) {
    slot.alive = false
    slot.type = null
    slot.group.visible = false
    for (const id of POWERUP_IDS) slot.cores[id].visible = false
  }

  /** Nearest uncollected pickup within range -- drives the bot COLLECT state. */
  nearestAvailable(pos, maxDist) {
    let best = null
    let bestDist = maxDist
    for (const s of this.slots) {
      if (!s.alive) continue
      const d = pos.distanceTo(s.group.position)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }
}
