import * as THREE from 'three'
import { CFG } from '../config.js'
import { clamp, randomDirection } from '../core/util.js'

const SHARDS = 16
const DURATION = 0.5

/** Soft round spark. Default square Points read as flat tiles up close. */
function makeSparkTexture() {
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(canvas)
}

export class ExplosionSystem {
  constructor(scene) {
    this.scene = scene
    this.pool = []
    this.active = []

    const shellGeo = new THREE.SphereGeometry(1, 20, 14)
    const spark = makeSparkTexture()

    for (let i = 0; i < CFG.pools.explosions; i++) {
      const shellMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // DoubleSide matters: a blast next to you puts the camera INSIDE the
        // shell, and a front-faces-only sphere would simply vanish.
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      const shell = new THREE.Mesh(shellGeo, shellMat)
      shell.visible = false
      shell.frustumCulled = false
      scene.add(shell)

      const shardGeo = new THREE.BufferGeometry()
      shardGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SHARDS * 3), 3))
      const shardMat = new THREE.PointsMaterial({
        size: 0.42,
        map: spark,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const shards = new THREE.Points(shardGeo, shardMat)
      shards.visible = false
      shards.frustumCulled = false
      scene.add(shards)

      this.pool.push({
        alive: false,
        t: 0,
        pos: new THREE.Vector3(),
        shell,
        shellMat,
        shards,
        shardGeo,
        shardMat,
        vels: Array.from({ length: SHARDS }, () => new THREE.Vector3()),
      })
    }
  }

  spawn(pos, color) {
    const e = this.pool.find((x) => !x.alive)
    if (!e) return

    e.alive = true
    e.t = 0
    e.pos.copy(pos)

    e.shellMat.color.set(color)
    e.shell.position.copy(pos)
    e.shell.scale.setScalar(0.25)
    e.shell.visible = true

    e.shardMat.color.set(color)
    const arr = e.shardGeo.attributes.position.array
    for (let i = 0; i < SHARDS; i++) {
      arr[i * 3] = pos.x
      arr[i * 3 + 1] = pos.y
      arr[i * 3 + 2] = pos.z
      randomDirection(e.vels[i]).multiplyScalar(6 + Math.random() * 14)
    }
    e.shardGeo.attributes.position.needsUpdate = true
    e.shards.visible = true

    this.active.push(e)
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i]
      e.t += dt
      const k = clamp(e.t / DURATION, 0, 1)

      // Shell punches out fast then fades. Alpha falls off cubically and peaks
      // low: a blast at point-blank range must read as a flash, not a wall of
      // colour blanking out the fight.
      const grow = 1 - Math.pow(1 - k, 3)
      e.shell.scale.setScalar(0.25 + grow * CFG.proj.blastRadius)
      e.shellMat.opacity = Math.pow(1 - k, 3) * 0.4

      const arr = e.shardGeo.attributes.position.array
      for (let j = 0; j < SHARDS; j++) {
        const v = e.vels[j]
        v.multiplyScalar(Math.pow(0.05, dt))
        arr[j * 3] += v.x * dt
        arr[j * 3 + 1] += v.y * dt
        arr[j * 3 + 2] += v.z * dt
      }
      e.shardGeo.attributes.position.needsUpdate = true
      e.shardMat.opacity = Math.pow(1 - k, 2)
      e.shardMat.size = 0.42 * (1 - k * 0.6)

      if (k >= 1) {
        e.alive = false
        e.shell.visible = false
        e.shards.visible = false
        this.active.splice(i, 1)
      }
    }
  }

  /** Feed live blasts to the shared light pool. */
  collectLights(sink) {
    for (const e of this.active) {
      const k = clamp(e.t / DURATION, 0, 1)
      sink(e.pos, e.shellMat.color, (1 - k) * CFG.fx.lightIntensity * 5)
    }
  }

  clear() {
    for (const e of this.active) {
      e.alive = false
      e.shell.visible = false
      e.shards.visible = false
    }
    this.active.length = 0
  }
}
