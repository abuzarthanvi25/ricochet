import * as THREE from 'three'
import { CFG } from '../config.js'

/**
 * A small, FIXED set of point lights shared between projectiles and blasts.
 *
 * Critical detail: these lights are created visible and NEVER toggled. three.js
 * bakes the number of visible lights into the shader program cache key, so
 * flipping `visible` as projectiles come and go changes that count and forces
 * every material in the scene to recompile mid-frame. Measured cost of a single
 * such transition here was 97-177ms -- a hard, visible freeze, and the reason
 * the game stuttered "randomly" during chaotic fights (each distinct light
 * count only stalls the first time it occurs).
 *
 * Unused lights are parked at intensity 0 instead. The count never changes, so
 * the programs compile once and stay cached.
 */
export class LightPool {
  constructor(scene) {
    this.lights = []
    this.candidates = []

    for (let i = 0; i < CFG.pools.lights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, CFG.fx.lightDistance, 2)
      l.visible = true // never changes -- see note above
      // Park far outside the arena so a zero-intensity light cannot contribute.
      l.position.set(0, -1000, 0)
      scene.add(l)
      this.lights.push(l)
    }
  }

  begin() {
    this.candidates.length = 0
  }

  add(pos, color, intensity) {
    this.candidates.push({ x: pos.x, y: pos.y, z: pos.z, color, intensity, d: 0 })
  }

  commit(cameraPos) {
    for (const c of this.candidates) {
      const dx = c.x - cameraPos.x
      const dy = c.y - cameraPos.y
      const dz = c.z - cameraPos.z
      c.d = dx * dx + dy * dy + dz * dz
    }
    this.candidates.sort((a, b) => a.d - b.d)

    const n = Math.min(this.candidates.length, this.lights.length)
    for (let i = 0; i < n; i++) {
      const c = this.candidates[i]
      const l = this.lights[i]
      l.position.set(c.x, c.y, c.z)
      l.color.copy(c.color)
      l.intensity = c.intensity
    }
    for (let i = n; i < this.lights.length; i++) {
      this.lights[i].intensity = 0
      this.lights[i].position.set(0, -1000, 0)
    }
  }
}
