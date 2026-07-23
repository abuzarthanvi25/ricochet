import * as THREE from 'three'
import { CFG } from '../config.js'
import { clamp } from '../core/util.js'
import { segmentClear } from '../core/collision.js'

const _world = new THREE.Vector3()
const _proj = new THREE.Vector3()

/**
 * World-space name + health bar floating above each enemy, drawn as DOM rather
 * than sprites: text stays crisp at any distance and costs no draw calls.
 * Plates hide when the bot is behind the camera, out of range, dead, or with a
 * rock between it and you -- otherwise they read as x-ray vision.
 */
export class Nameplates {
  constructor(container) {
    this.container = container
    this.plates = new Map()
  }

  register(bot) {
    if (this.plates.has(bot.id)) return

    const root = document.createElement('div')
    root.className = 'nameplate'

    const name = document.createElement('div')
    name.className = 'np-name'
    name.textContent = bot.label

    const bar = document.createElement('div')
    bar.className = 'np-bar'
    const fill = document.createElement('div')
    fill.className = 'np-fill'
    bar.appendChild(fill)

    root.appendChild(name)
    root.appendChild(bar)
    this.container.appendChild(root)

    this.plates.set(bot.id, { root, fill, bot, shown: false })
  }

  update(camera, bots, arena, viewport) {
    const { width, height } = viewport

    for (const plate of this.plates.values()) {
      const bot = plate.bot

      if (!bot.alive || bot.dying) {
        this._hide(plate)
        continue
      }

      // Anchor above the head, not at the centre.
      _world.copy(bot.pos)
      _world.y += CFG.ui.nameplateHeight

      const dist = camera.position.distanceTo(_world)
      if (dist > CFG.ui.nameplateMaxDist) {
        this._hide(plate)
        continue
      }

      _proj.copy(_world).project(camera)
      // z > 1 means it projected behind the camera and would ghost onto screen.
      if (_proj.z > 1) {
        this._hide(plate)
        continue
      }

      if (!segmentClear(camera.position, _world, arena.debris)) {
        this._hide(plate)
        continue
      }

      const x = (_proj.x * 0.5 + 0.5) * width
      const y = (-_proj.y * 0.5 + 0.5) * height

      const hp01 = clamp(bot.hp / CFG.bot.maxHp, 0, 1)
      // Shrink and fade with distance so a far-off crowd does not clutter.
      const scale = clamp(1.15 - dist / CFG.ui.nameplateMaxDist, 0.55, 1)
      const opacity = clamp(1.35 - dist / CFG.ui.nameplateMaxDist, 0.35, 1)

      plate.root.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)})`
      plate.root.style.opacity = opacity.toFixed(2)
      plate.fill.style.transform = `scaleX(${hp01})`
      plate.fill.classList.toggle('low', hp01 <= 0.5 && hp01 > 0.25)
      plate.fill.classList.toggle('critical', hp01 <= 0.25)

      if (!plate.shown) {
        plate.root.style.display = 'block'
        plate.shown = true
      }
    }
  }

  _hide(plate) {
    if (!plate.shown) return
    plate.root.style.display = 'none'
    plate.shown = false
  }

  hideAll() {
    for (const plate of this.plates.values()) this._hide(plate)
  }
}
