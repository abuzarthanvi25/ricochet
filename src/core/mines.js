import * as THREE from 'three'
import { CFG } from '../config.js'

const _v = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()

/** The 12 icosahedron-vertex directions, so the spikes sit evenly like a naval mine. */
function spikeDirections() {
  const ico = new THREE.IcosahedronGeometry(1, 0)
  const pos = ico.attributes.position
  const seen = new Set()
  const dirs = []
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize()
    const key = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    dirs.push(v)
  }
  ico.dispose()
  return dirs
}

/**
 * Finite floating sea-mines. A fixed number are placed at match start and never
 * move or respawn -- destructible hazards you can bait bots into. Touching one,
 * or hitting one with a shot, sets it off; the blast damage and kill attribution
 * live in Game.detonateMine so the kill feed and scoring flow through the same
 * path as everything else.
 *
 * Every mesh is built in the constructor and only ever toggled with `visible`,
 * and no lights are created -- both would change shader program keys mid-fight
 * (see fx/lights.js). Unlike the additive pickups these are LIT solid meshes, so
 * they read as menacing metal objects rather than glowing collectibles.
 */
export class MineField {
  constructor(scene) {
    this.scene = scene
    this.mines = []

    const M = CFG.mines
    const bodyGeo = new THREE.IcosahedronGeometry(M.bodyRadius, 1)
    const spikeGeo = new THREE.ConeGeometry(M.bodyRadius * 0.16, M.spikeLen, 6)
    const dirs = spikeDirections()

    for (let i = 0; i < M.count; i++) {
      const group = new THREE.Group()
      group.visible = false

      const bodyMat = new THREE.MeshLambertMaterial({
        color: 0x1a1d24,
        emissive: M.color,
        emissiveIntensity: 0.35,
        flatShading: true,
      })
      const body = new THREE.Mesh(bodyGeo, bodyMat)
      group.add(body)

      // flatShading matches the body and the arena debris, so all three share
      // one Lambert program -- the mines add no new shader-program key, and
      // there is nothing for a first match to compile mid-frame (see fx/lights).
      const spikeMat = new THREE.MeshLambertMaterial({
        color: 0x3a3f48,
        emissive: M.color,
        emissiveIntensity: 0.12,
        flatShading: true,
      })
      for (const d of dirs) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat)
        // Cones point +Y; aim each one outward from the body, sunk in slightly.
        _q.setFromUnitVectors(_up, d)
        spike.quaternion.copy(_q)
        spike.position.copy(d).multiplyScalar(M.bodyRadius + M.spikeLen * 0.35)
        group.add(spike)
      }

      scene.add(group)
      this.mines.push({
        group,
        body,
        bodyMat,
        spikeMat,
        pos: new THREE.Vector3(),
        radius: M.radius,
        alive: false,
        spin: 0.15 + Math.random() * 0.2,
      })
    }
  }

  /** Place every mine afresh. Called from Game.reset. */
  reset(game) {
    const avoid = game.bots.filter((b) => b.alive).map((b) => b.pos.clone())
    for (const m of this.mines) {
      const p = game.arena.findSpawn(m.radius + 1, avoid)
      m.pos.copy(p)
      m.group.position.copy(p)
      m.group.rotation.set(0, 0, 0)
      m.group.visible = true
      m.alive = true
      avoid.push(p.clone())
    }
  }

  get active() {
    let n = 0
    for (const m of this.mines) if (m.alive) n++
    return n
  }

  update(dt, game) {
    for (const m of this.mines) {
      if (!m.alive) continue
      // Idle tumble so they read as free-floating, not welded in place.
      m.group.rotation.x += m.spin * dt
      m.group.rotation.y += m.spin * 0.7 * dt

      for (const bot of game.bots) {
        if (!bot.alive) continue
        _v.subVectors(bot.pos, m.pos)
        const reach = bot.radius + m.radius
        if (_v.lengthSq() > reach * reach) continue
        // A bot flew into it: environmental, nobody is credited (attacker -1).
        this.explode(m, -1, game)
        break
      }
    }
  }

  /** Detonate a mine. `attackerId` is the shot's owner, or -1 for a contact hit. */
  explode(mine, attackerId, game) {
    if (!mine.alive) return
    this._despawn(mine)
    game.detonateMine(mine.pos, attackerId)
  }

  _despawn(mine) {
    mine.alive = false
    mine.group.visible = false
  }

  clear() {
    for (const m of this.mines) this._despawn(m)
  }
}
