import * as THREE from 'three'
import { CFG } from '../config.js'

/**
 * A handful of point lights shared between every projectile and blast.
 *
 * One light per projectile would mean up to ~96 dynamic lights, which recompiles
 * shaders and destroys the frame rate. Instead we gather candidates each frame
 * and hand the pool to the ones nearest the camera -- the only ones anybody can
 * actually see lighting anything.
 */
export class LightPool {
  constructor(scene) {
    this.lights = []
    this.candidates = []

    for (let i = 0; i < CFG.pools.lights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, CFG.fx.lightDistance, 2)
      l.visible = false
      scene.add(l)
      this.lights.push(l)
    }
  }

  begin() {
    this.candidates.length = 0
  }

  add(pos, color, intensity) {
    this.candidates.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      color,
      intensity,
      d: 0,
    })
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
      l.visible = true
    }
    for (let i = n; i < this.lights.length; i++) {
      this.lights[i].visible = false
      this.lights[i].intensity = 0
    }
  }
}
