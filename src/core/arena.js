import * as THREE from 'three'
import { CFG, HALF } from '../config.js'
import { rand, randomDirection } from './util.js'

// Module-scope scratch: arena.update runs every frame over every debris.
const _mat4 = new THREE.Matrix4()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()

/** Grid decal painted onto the wall interiors, generated at runtime. */
function makeGridTexture() {
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, S, S)
  ctx.strokeStyle = 'rgba(120, 220, 255, 1)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3)

  ctx.strokeStyle = 'rgba(120, 220, 255, 0.22)'
  ctx.lineWidth = 1
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * S
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, S)
    ctx.moveTo(0, p)
    ctx.lineTo(S, p)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const DEBRIS_SHAPES = [
  () => new THREE.IcosahedronGeometry(1, 0),
  () => new THREE.DodecahedronGeometry(1, 0),
  () => new THREE.OctahedronGeometry(1, 0),
  () => new THREE.BoxGeometry(1.4, 1.4, 1.4),
  () => new THREE.TetrahedronGeometry(1.3, 0),
  () => new THREE.TorusGeometry(0.75, 0.3, 6, 10),
  () => new THREE.ConeGeometry(1, 1.8, 6),
]

export class Arena {
  constructor(scene) {
    this.scene = scene
    this.debris = []
    this._buildWalls()
    this._buildDebris()
  }

  _buildWalls() {
    const { w, h, d } = CFG.arena
    const CELL = 5

    const base = makeGridTexture()
    // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z. Each face spans a
    // different pair of axes, so each needs its own repeat to keep cells square.
    const repeats = [
      [d / CELL, h / CELL],
      [d / CELL, h / CELL],
      [w / CELL, d / CELL],
      [w / CELL, d / CELL],
      [w / CELL, h / CELL],
      [w / CELL, h / CELL],
    ]

    const materials = repeats.map(([ru, rv]) => {
      const tex = base.clone()
      tex.needsUpdate = true
      tex.repeat.set(ru, rv)
      // Lambert, not Standard. The walls are a BackSide box the camera sits
      // inside, so they cover essentially every pixel -- the most overdrawn
      // surface in the game by a wide margin. At roughness 0.85 / metalness
      // 0.15 the PBR BRDF was buying almost nothing over plain diffuse, and an
      // interleaved A/B measured the swap at -2.2ms of GPU time per frame.
      // They still light up from passing projectiles, which is the point.
      return new THREE.MeshLambertMaterial({
        color: 0x0b1420,
        side: THREE.BackSide,
        emissive: 0x1a4a66,
        emissiveMap: tex,
        emissiveIntensity: 0.9,
      })
    })

    this.walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials)
    this.scene.add(this.walls)

    // Glowing outline so the cube edges read clearly against the fog.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.55 })
    )
    this.scene.add(edges)
    this.edges = edges
  }

  /**
   * Debris are drawn as one InstancedMesh per shape rather than one Mesh each.
   * They already shared a single material, so 25 separate meshes bought nothing
   * but 25 draw calls; grouped by geometry that becomes at most 7, and usually
   * fewer since a shape with no instances is skipped entirely.
   *
   * Collision is untouched: `pos` and `radius` stay plain data on the debris
   * record, which is all core/collision.js ever reads.
   */
  _buildDebris() {
    const geoCache = DEBRIS_SHAPES.map((f) => {
      const g = f()
      g.computeBoundingSphere()
      return g
    })

    // Lambert for the same reason as the walls: roughness 0.95 is diffuse in
    // all but name, and flat-shaded rock gains nothing from a PBR BRDF.
    const material = new THREE.MeshLambertMaterial({
      color: 0x2a3646,
      emissive: 0x0e2233,
      emissiveIntensity: 0.6,
      flatShading: true,
    })

    // Assign shapes first so each InstancedMesh can be sized exactly.
    const picks = []
    const perShape = new Array(geoCache.length).fill(0)
    for (let i = 0; i < CFG.debris.count; i++) {
      const gi = Math.floor(Math.random() * geoCache.length)
      picks.push(gi)
      perShape[gi]++
    }

    this.debrisMeshes = geoCache.map((geo, gi) => {
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, perShape[gi]))
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = perShape[gi]
      // three.js caches an InstancedMesh's bounding sphere on first cull and
      // never recomputes it. These instances drift every frame, so a cached
      // sphere goes stale and debris would start popping out of existence.
      // Each group is spread across the whole arena and would almost never cull
      // anyway -- 7 unconditional draws is the cheaper, correct trade.
      mesh.frustumCulled = false
      this.scene.add(mesh)
      return mesh
    })

    const written = new Array(geoCache.length).fill(0)
    for (let i = 0; i < CFG.debris.count; i++) {
      const gi = picks[i]
      const geo = geoCache[gi]
      const radius = rand(CFG.debris.minR, CFG.debris.maxR)
      const pos = this._findDebrisSpot(radius)

      const d = CFG.debris.driftMax
      const spin = CFG.debris.spinMax
      this.debris.push({
        mesh: this.debrisMeshes[gi],
        slot: written[gi]++,
        pos,
        radius,
        // Normalise every shape so its bounding sphere is exactly `radius` --
        // that sphere IS the collider, so the visual must match it.
        scale: radius / geo.boundingSphere.radius,
        rot: new THREE.Euler(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI)),
        vel: randomDirection().multiplyScalar(rand(0.15, d)),
        spin: new THREE.Vector3(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)),
      })
    }
  }

  /** Random spot that clears the arena centre and every debris already placed. */
  _findDebrisSpot(radius) {
    const pad = radius + 1
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = new THREE.Vector3(
        rand(-HALF.x + pad, HALF.x - pad),
        rand(-HALF.y + pad, HALF.y - pad),
        rand(-HALF.z + pad, HALF.z - pad)
      )
      if (p.length() < CFG.debris.minGapFromCenter + radius) continue
      let ok = true
      for (const d of this.debris) {
        if (p.distanceTo(d.pos) < d.radius + radius + 2) {
          ok = false
          break
        }
      }
      if (ok) return p
    }
    // Fallback: shove it somewhere legal rather than loop forever.
    return new THREE.Vector3(
      rand(-HALF.x + pad, HALF.x - pad),
      rand(-HALF.y + pad, HALF.y - pad),
      rand(-HALF.z + pad, HALF.z - pad)
    )
  }

  update(dt) {
    for (const d of this.debris) {
      d.pos.addScaledVector(d.vel, dt)

      // Debris bounce off the walls themselves; they are the only thing in the
      // arena besides projectiles that does.
      const hx = HALF.x - d.radius
      const hy = HALF.y - d.radius
      const hz = HALF.z - d.radius
      if (d.pos.x > hx || d.pos.x < -hx) {
        d.pos.x = THREE.MathUtils.clamp(d.pos.x, -hx, hx)
        d.vel.x *= -1
      }
      if (d.pos.y > hy || d.pos.y < -hy) {
        d.pos.y = THREE.MathUtils.clamp(d.pos.y, -hy, hy)
        d.vel.y *= -1
      }
      if (d.pos.z > hz || d.pos.z < -hz) {
        d.pos.z = THREE.MathUtils.clamp(d.pos.z, -hz, hz)
        d.vel.z *= -1
      }

      d.rot.x += d.spin.x * dt
      d.rot.y += d.spin.y * dt
      d.rot.z += d.spin.z * dt

      _quat.setFromEuler(d.rot)
      _scale.setScalar(d.scale)
      _mat4.compose(d.pos, _quat, _scale)
      d.mesh.setMatrixAt(d.slot, _mat4)
    }

    for (const m of this.debrisMeshes) {
      if (m.count) m.instanceMatrix.needsUpdate = true
    }
  }

  /** A spawn point with clearance from walls, debris and everything in `avoid`. */
  findSpawn(clearRadius, avoid = []) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const pad = clearRadius + 3
      const p = new THREE.Vector3(
        rand(-HALF.x + pad, HALF.x - pad),
        rand(-HALF.y + pad, HALF.y - pad),
        rand(-HALF.z + pad, HALF.z - pad)
      )
      let ok = true
      for (const d of this.debris) {
        if (p.distanceTo(d.pos) < d.radius + clearRadius + 2) {
          ok = false
          break
        }
      }
      if (ok) {
        for (const a of avoid) {
          if (p.distanceTo(a) < 22) {
            ok = false
            break
          }
        }
      }
      if (ok) return p
    }
    return new THREE.Vector3(rand(-10, 10), rand(-8, 8), rand(-10, 10))
  }
}
