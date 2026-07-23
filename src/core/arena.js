import * as THREE from 'three'
import { CFG, HALF } from '../config.js'
import { rand, randomDirection, pick } from './util.js'

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
      return new THREE.MeshStandardMaterial({
        color: 0x0b1420,
        roughness: 0.85,
        metalness: 0.15,
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

  _buildDebris() {
    const geoCache = DEBRIS_SHAPES.map((f) => {
      const g = f()
      g.computeBoundingSphere()
      return g
    })

    const material = new THREE.MeshStandardMaterial({
      color: 0x2a3646,
      roughness: 0.95,
      metalness: 0.25,
      emissive: 0x0e2233,
      emissiveIntensity: 0.6,
      flatShading: true,
    })

    for (let i = 0; i < CFG.debris.count; i++) {
      const radius = rand(CFG.debris.minR, CFG.debris.maxR)
      const gi = Math.floor(Math.random() * geoCache.length)
      const geo = geoCache[gi]

      const mesh = new THREE.Mesh(geo, material)
      // Normalise every shape so its bounding sphere is exactly `radius` --
      // that sphere IS the collider, so the visual must match it.
      mesh.scale.setScalar(radius / geo.boundingSphere.radius)

      const pos = this._findDebrisSpot(radius)
      mesh.position.copy(pos)
      mesh.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI))

      const d = CFG.debris.driftMax
      const spin = CFG.debris.spinMax
      this.debris.push({
        mesh,
        pos,
        radius,
        vel: randomDirection().multiplyScalar(rand(0.15, d)),
        spin: new THREE.Vector3(rand(-spin, spin), rand(-spin, spin), rand(-spin, spin)),
      })
      this.scene.add(mesh)
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

      d.mesh.position.copy(d.pos)
      d.mesh.rotation.x += d.spin.x * dt
      d.mesh.rotation.y += d.spin.y * dt
      d.mesh.rotation.z += d.spin.z * dt
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
