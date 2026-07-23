import Stats from 'stats-gl'
import GUI from 'lil-gui'
import * as THREE from 'three'
import { CFG } from '../config.js'
import { randomDirection, rand } from '../core/util.js'

/**
 * Performance overlay: stats-gl for FPS / CPU ms / GPU ms, lil-gui for live
 * counters and a stress test.
 *
 * `renderer.info.programs.length` is on the panel deliberately -- if that
 * number climbs while you play, three.js is recompiling shaders mid-frame,
 * which is the single most common cause of stutter in a scene whose light
 * count changes.
 *
 * Enable with ?perf in the URL, or press F4.
 */
export class Perf {
  constructor(renderer, game) {
    this.renderer = renderer
    this.game = game
    this.enabled = false
    this.stats = null
    this.gui = null
    this.frames = 0
    this.worstFrame = 0
    this._last = performance.now()

    this.readout = {
      fps: 0,
      frameMs: 0,
      worstMs: 0,
      drawCalls: 0,
      triangles: 0,
      programs: 0,
      projectiles: 0,
      explosions: 0,
      geometries: 0,
      textures: 0,
    }
  }

  async mount() {
    if (this.stats) return

    this.stats = new Stats({
      trackGPU: true,
      trackCPT: false,
      trackHz: true,
      trackFPS: true,
      horizontal: false,
      mode: 0,
    })
    try {
      await this.stats.init(this.renderer.getContext())
    } catch (err) {
      console.warn('[perf] GPU timing unavailable:', err?.message ?? err)
    }
    this.stats.dom.style.position = 'fixed'
    this.stats.dom.style.left = '12px'
    this.stats.dom.style.top = '12px'
    this.stats.dom.style.zIndex = '60'
    document.body.appendChild(this.stats.dom)

    this.gui = new GUI({ title: 'RICOCHET · perf', width: 268 })
    this.gui.domElement.style.position = 'fixed'
    this.gui.domElement.style.right = '12px'
    this.gui.domElement.style.top = '12px'
    this.gui.domElement.style.zIndex = '60'

    const live = this.gui.addFolder('live')
    live.add(this.readout, 'fps').listen().disable()
    live.add(this.readout, 'frameMs').name('frame ms').listen().disable()
    live.add(this.readout, 'worstMs').name('worst ms').listen().disable()
    live.add(this.readout, 'drawCalls').name('draw calls').listen().disable()
    live.add(this.readout, 'triangles').listen().disable()
    live.add(this.readout, 'programs').name('shader programs').listen().disable()
    live.add(this.readout, 'projectiles').listen().disable()
    live.add(this.readout, 'explosions').listen().disable()
    live.add(this.readout, 'geometries').listen().disable()
    live.add(this.readout, 'textures').listen().disable()
    live.open()

    const stress = this.gui.addFolder('stress test')
    const actions = {
      chaos: () => stressTest(this.game, 'chaos'),
      extreme: () => stressTest(this.game, 'extreme'),
      resetWorst: () => {
        this.worstFrame = 0
        this.readout.worstMs = 0
      },
    }
    stress.add(actions, 'chaos').name('spawn chaos load')
    stress.add(actions, 'extreme').name('spawn EXTREME load')
    stress.add(actions, 'resetWorst').name('reset worst ms')
    stress.open()

    this.enabled = true
  }

  setVisible(on) {
    if (!this.stats) return
    this.enabled = on
    this.stats.dom.style.display = on ? '' : 'none'
    this.gui.domElement.style.display = on ? '' : 'none'
  }

  begin() {
    if (this.enabled && this.stats) this.stats.begin()
  }

  end() {
    if (!this.enabled || !this.stats) return
    this.stats.end()
    this.stats.update()

    const now = performance.now()
    const ms = now - this._last
    this._last = now

    if (ms > this.worstFrame && this.frames > 30) this.worstFrame = ms
    this.frames++

    // Refresh the numeric readout a few times a second, not every frame --
    // lil-gui DOM writes would otherwise show up in our own measurement.
    if (this.frames % 12 !== 0) return

    const info = this.renderer.info
    const r = this.readout
    r.fps = +(1000 / Math.max(ms, 0.001)).toFixed(0)
    r.frameMs = +ms.toFixed(2)
    r.worstMs = +this.worstFrame.toFixed(2)
    r.drawCalls = info.render.calls
    r.triangles = info.render.triangles
    r.programs = info.programs ? info.programs.length : 0
    r.projectiles = this.game.projectiles.active.length
    r.explosions = this.game.explosions.active.length
    r.geometries = info.memory.geometries
    r.textures = info.memory.textures
  }
}

const _v = new THREE.Vector3()

/**
 * Worst-case load, on demand. `chaos` is a busy real fight; `extreme` saturates
 * the projectile pool and detonates a wall of blasts at once -- deliberately
 * past anything gameplay produces, so headroom is visible.
 */
export function stressTest(game, level = 'chaos') {
  const shots = level === 'extreme' ? CFG.pools.projectiles : 40
  const blasts = level === 'extreme' ? CFG.pools.explosions : 8

  for (const e of game.enemies) {
    if (!e.alive) e.spawnAt(game.arena.findSpawn(e.radius))
  }

  for (let i = 0; i < shots; i++) {
    const origin = _v.set(rand(-20, 20), rand(-12, 12), rand(-20, 20)).clone()
    const dir = randomDirection(new THREE.Vector3())
    const owner = i % 2 === 0 ? game.player : game.enemies[i % game.enemies.length]
    game.projectiles.spawn(owner.id, owner.team, origin, dir, 1)
  }

  for (let i = 0; i < blasts; i++) {
    game.explosions.spawn(
      new THREE.Vector3(rand(-24, 24), rand(-14, 14), rand(-24, 24)),
      new THREE.Color(i % 2 ? CFG.proj.colorArmed : CFG.proj.colorFresh)
    )
  }

  return { shots, blasts }
}
