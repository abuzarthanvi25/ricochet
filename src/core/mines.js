import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CFG } from '../config.js'

const _v = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _mat4 = new THREE.Matrix4()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _zero = new THREE.Vector3(0, 0, 0)

/**
 * One merged geometry for a whole mine -- the icosahedral body plus its twelve
 * spikes, each spike's transform baked in. Built once, then every mine is an
 * instance of it, so all five mines cost a single draw call instead of 65
 * separate meshes (5 bodies + 60 spikes). The spike directions are the
 * icosahedron vertices, so they sit evenly like a naval mine.
 */
function buildMineGeometry() {
  const M = CFG.mines
  const parts = [new THREE.IcosahedronGeometry(M.bodyRadius, 1)]

  const ico = new THREE.IcosahedronGeometry(1, 0)
  const pos = ico.attributes.position
  const seen = new Set()
  for (let i = 0; i < pos.count; i++) {
    const d = new THREE.Vector3().fromBufferAttribute(pos, i).normalize()
    const key = `${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    // ConeGeometry is indexed but IcosahedronGeometry is not; mergeGeometries
    // needs them to match, so drop the cone's index. (A null merge crashes the
    // renderer with "Cannot read properties of null".)
    const spike = new THREE.ConeGeometry(M.bodyRadius * 0.16, M.spikeLen, 6).toNonIndexed()
    _quat.setFromUnitVectors(_up, d) // cones point +Y; aim each one outward
    _mat4.compose(
      _v.copy(d).multiplyScalar(M.bodyRadius + M.spikeLen * 0.35),
      _quat,
      _scale.setScalar(1)
    )
    spike.applyMatrix4(_mat4)
    parts.push(spike)
  }
  ico.dispose()

  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return merged
}

/**
 * Finite floating sea-mines. A fixed number are placed at match start and never
 * move or respawn -- destructible hazards you can bait bots into. Touching one,
 * or hitting one with a shot, sets it off; the blast damage and kill attribution
 * live in Game.detonateMine so the kill feed and scoring flow through the same
 * path as everything else.
 *
 * All mines share one InstancedMesh, so they cost one draw call and, like the
 * arena debris, one flat-shaded Lambert program -- no new shader-program key.
 * The instanced mesh's frustum culling is off because the per-instance matrices
 * spin every frame and three.js caches an InstancedMesh bounding sphere on first
 * cull; a stale one would pop the mines out of existence.
 */
export class MineField {
  constructor(scene) {
    this.scene = scene
    this.mines = []

    const M = CFG.mines
    const mat = new THREE.MeshLambertMaterial({
      color: 0x272b33,
      emissive: M.color,
      emissiveIntensity: 0.3,
      flatShading: true,
    })
    this.mesh = new THREE.InstancedMesh(buildMineGeometry(), mat, M.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    scene.add(this.mesh)

    for (let i = 0; i < M.count; i++) {
      this.mines.push({
        slot: i,
        pos: new THREE.Vector3(),
        radius: M.radius,
        alive: false,
        rot: new THREE.Euler(),
        spin: 0.15 + Math.random() * 0.2,
      })
    }
    this._writeInstances()
  }

  /** Compose every mine's matrix; a dead mine scales to zero, drawing nothing. */
  _writeInstances() {
    for (const m of this.mines) {
      _quat.setFromEuler(m.rot)
      _scale.setScalar(m.alive ? 1 : 0)
      _mat4.compose(m.alive ? m.pos : _zero, _quat, _scale)
      this.mesh.setMatrixAt(m.slot, _mat4)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** Place every mine afresh. Called from Game.reset. */
  reset(game) {
    const avoid = game.bots.filter((b) => b.alive).map((b) => b.pos.clone())
    for (const m of this.mines) {
      const p = game.arena.findSpawn(m.radius + 1, avoid)
      m.pos.copy(p)
      m.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      m.alive = true
      avoid.push(p.clone())
    }
    this._writeInstances()
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
      m.rot.x += m.spin * dt
      m.rot.y += m.spin * 0.7 * dt

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
    this._writeInstances()
  }

  /** Detonate a mine. `attackerId` is the shot's owner, or -1 for a contact hit. */
  explode(mine, attackerId, game) {
    if (!mine.alive) return
    this._despawn(mine)
    game.detonateMine(mine.pos, attackerId)
  }

  _despawn(mine) {
    mine.alive = false
  }

  clear() {
    for (const m of this.mines) this._despawn(m)
    this._writeInstances()
  }
}
