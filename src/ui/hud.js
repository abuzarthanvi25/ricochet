import { clamp } from '../core/util.js'

const RING_CIRCUMFERENCE = 2 * Math.PI * 26 // matches r=26 in index.html

const $ = (id) => document.getElementById(id)

export class Hud {
  constructor() {
    this.root = $('hud')
    this.hpFill = $('hp-fill')
    this.boostFill = $('boost-fill')
    this.ring = $('cooldown-ring')
    this.crosshair = $('crosshair')
    this.hitmarkerEl = $('hitmarker')
    this.scoreYou = $('score-you')
    this.scoreThem = $('score-them')
    this.scoreTarget = $('score-target')
    this.killfeed = $('killfeed')
    this.vignette = $('vignette')
    this.warn = $('warn-inbound')
    this.debugEl = $('debug')

    this.ring.style.strokeDasharray = RING_CIRCUMFERENCE
    this._vignetteLevel = 0
    this._hitTimer = null
  }

  show() {
    this.root.classList.remove('hidden')
  }

  hide() {
    this.root.classList.add('hidden')
  }

  setHp(hp, max) {
    const k = clamp(hp / max, 0, 1)
    this.hpFill.style.transform = `scaleX(${k})`
    this.hpFill.classList.toggle('low', k <= 0.55 && k > 0.25)
    this.hpFill.classList.toggle('critical', k <= 0.25)
    // Vignette tightens as integrity drops -- readable without looking down.
    this.vignette.style.opacity = k > 0.5 ? 0 : (0.5 - k) * 1.3
  }

  /** k = 1 means ready to fire. */
  setCooldown(k) {
    const r = clamp(k, 0, 1)
    this.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - r)
    this.crosshair.classList.toggle('reloading', r < 1)
  }

  setBoost(k) {
    const r = clamp(k, 0, 1)
    this.boostFill.style.transform = `scaleX(${r})`
    this.boostFill.classList.toggle('charging', r < 1)
  }

  setScore(you, them, target) {
    this.scoreYou.textContent = you
    this.scoreThem.textContent = them
    this.scoreTarget.textContent = target
  }

  hitmarker(isKill) {
    const el = this.hitmarkerEl
    el.classList.remove('show')
    el.classList.toggle('kill', !!isKill)
    void el.offsetWidth // restart the CSS animation
    el.classList.add('show')
  }

  flashDamage() {
    this.vignette.style.opacity = 0.85
    clearTimeout(this._dmgTimer)
    this._dmgTimer = setTimeout(() => {
      this.vignette.style.opacity = this._restingVignette ?? 0
    }, 120)
  }

  setWarn(on) {
    this.warn.classList.toggle('hidden', !on)
  }

  addKill({ killer, killerTeam, victim, victimTeam, verb }) {
    const line = document.createElement('div')
    line.className = 'line'
    const kc = killerTeam === 'player' ? 'you' : 'bot'
    const vc = victimTeam === 'player' ? 'you' : 'bot'
    line.innerHTML = killer
      ? `<span class="who ${kc}">${killer}</span><span class="verb">${verb}</span><span class="who ${vc}">${victim}</span>`
      : `<span class="who ${vc}">${victim}</span><span class="verb">${verb}</span>`
    this.killfeed.prepend(line)

    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove()

    setTimeout(() => {
      line.classList.add('fading')
      setTimeout(() => line.remove(), 600)
    }, 4200)
  }

  clearKills() {
    this.killfeed.innerHTML = ''
  }

  setDebug(text) {
    if (text == null) {
      this.debugEl.classList.add('hidden')
      return
    }
    this.debugEl.classList.remove('hidden')
    this.debugEl.textContent = text
  }
}
