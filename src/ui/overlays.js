import { DIFFICULTIES } from '../core/difficulty.js'
import { POWERUPS } from '../core/powerups.js'

const $ = (id) => document.getElementById(id)
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * One definition, rendered onto both the title screen and the pause menu. Two
 * copies of this in the HTML is how they end up disagreeing after a rebind.
 */
const CONTROL_COLUMNS = [
  [
    { keys: ['W', 'A', 'S', 'D'], label: 'Thrust' },
    { keys: ['Space'], label: 'Ascend' },
    { keys: ['Shift'], label: 'Descend' },
  ],
  [
    { keys: ['Q'], alt: 'RMB', label: 'Boost dash' },
    { keys: ['Mouse'], label: 'Aim' },
    { keys: ['LMB'], label: 'Fire' },
    { keys: ['Esc'], label: 'Pause' },
  ],
]

export class Overlays {
  constructor() {
    this.root = $('overlay')
    this.screens = {
      title: $('screen-title'),
      over: $('screen-over'),
      win: $('screen-win'),
      paused: $('screen-paused'),
    }
    this.btnPlay = $('btn-play')
    this.btnRetry = $('btn-retry')
    this.btnAgain = $('btn-again')
    this.btnResume = $('btn-resume')
    this.loading = $('loading')

    this.btnPlay.disabled = true

    this.diffGroups = [...document.querySelectorAll('[data-difficulty-group]')]
    this.controlGroups = [...document.querySelectorAll('[data-controls-group]')]
    this.powerupGroups = [...document.querySelectorAll('[data-powerup-group]')]
    this.soundGroups = [...document.querySelectorAll('[data-sound-group]')]
    this._onDifficultyPick = null
    this._onSoundToggle = null
    this._buildDifficultyControls()
    this._buildControls()
    this._buildPowerupGuide()
    this._buildSoundToggle()
  }

  /** Same toggle on the title screen and the pause menu. */
  _buildSoundToggle() {
    for (const group of this.soundGroups) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'sound-btn'

      const icon = document.createElementNS(SVG_NS, 'svg')
      icon.setAttribute('class', 'sound-icon')
      icon.setAttribute('viewBox', '0 0 24 24')
      const use = document.createElementNS(SVG_NS, 'use')
      use.setAttribute('href', '#gl-sound-on')
      icon.appendChild(use)

      const label = document.createElement('span')
      label.textContent = 'SOUND'

      btn.append(icon, label)
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur()
        this._onSoundToggle?.()
      })
      group.appendChild(btn)
    }
  }

  onSoundToggle(fn) {
    this._onSoundToggle = fn
  }

  setMuted(on) {
    for (const group of this.soundGroups) {
      const btn = group.querySelector('.sound-btn')
      btn.classList.toggle('muted', on)
      btn.querySelector('use').setAttribute('href', on ? '#gl-sound-off' : '#gl-sound-on')
      btn.querySelector('span').textContent = on ? 'SOUND OFF' : 'SOUND ON'
    }
  }

  /** Same key legend on the title screen and the pause menu. */
  _buildControls() {
    for (const group of this.controlGroups) {
      for (const column of CONTROL_COLUMNS) {
        const col = document.createElement('div')
        col.className = 'ctrl-col'

        for (const entry of column) {
          const row = document.createElement('div')
          row.className = 'ctrl'

          for (const k of entry.keys) {
            const kbd = document.createElement('kbd')
            kbd.textContent = k
            row.appendChild(kbd)
          }
          if (entry.alt) {
            const kbd = document.createElement('kbd')
            kbd.className = 'alt'
            kbd.textContent = entry.alt
            row.appendChild(kbd)
          }

          const label = document.createElement('span')
          label.textContent = entry.label
          row.appendChild(label)
          col.appendChild(row)
        }
        group.appendChild(col)
      }
    }
  }

  /** Powerup legend, straight off the registry so it cannot go stale. */
  _buildPowerupGuide() {
    for (const group of this.powerupGroups) {
      const list = group.querySelector('.pg-list')
      for (const p of Object.values(POWERUPS)) {
        const row = document.createElement('div')
        row.className = 'pg-row'
        row.style.color = hex(p.color)

        const icon = document.createElementNS(SVG_NS, 'svg')
        icon.setAttribute('class', 'pg-icon')
        icon.setAttribute('viewBox', '0 0 24 24')
        const use = document.createElementNS(SVG_NS, 'use')
        use.setAttribute('href', `#${p.glyph}`)
        icon.appendChild(use)

        const name = document.createElement('span')
        name.className = 'pg-name'
        name.textContent = p.label

        const blurb = document.createElement('span')
        blurb.className = 'pg-blurb'
        blurb.textContent = p.blurb

        row.append(icon, name, blurb)
        list.appendChild(row)
      }
    }
  }

  /** Same selector rendered on the title and pause screens; one source of truth. */
  _buildDifficultyControls() {
    for (const group of this.diffGroups) {
      const options = group.querySelector('.diff-options')
      for (const d of Object.values(DIFFICULTIES)) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'diff-btn'
        btn.dataset.diff = d.id
        btn.textContent = d.label
        btn.addEventListener('click', (e) => {
          e.currentTarget.blur()
          this._onDifficultyPick?.(d.id)
        })
        options.appendChild(btn)
      }
    }
  }

  onDifficultyPick(fn) {
    this._onDifficultyPick = fn
  }

  setDifficulty(id) {
    const preset = DIFFICULTIES[id]
    for (const group of this.diffGroups) {
      for (const btn of group.querySelectorAll('.diff-btn')) {
        btn.classList.toggle('active', btn.dataset.diff === id)
      }
      const blurb = group.querySelector('.diff-blurb')
      if (blurb && preset) blurb.textContent = preset.blurb
    }
  }

  ready() {
    this.btnPlay.disabled = false
    this.loading.classList.add('hidden')
  }

  failed(message) {
    this.loading.classList.remove('hidden')
    this.loading.textContent = message
    this.loading.style.color = '#ff3355'
  }

  /** Transient hint on the title screen (e.g. pointer lock was refused). */
  notice(message) {
    this.loading.classList.remove('hidden')
    this.loading.textContent = message
    this.loading.style.color = '#ffb020'
    clearTimeout(this._noticeTimer)
    this._noticeTimer = setTimeout(() => this.loading.classList.add('hidden'), 4000)
  }

  _show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name)
    this.root.classList.remove('hidden')
  }

  hide() {
    this.root.classList.add('hidden')
  }

  showTitle() {
    this._show('title')
  }

  showPaused() {
    this._show('paused')
  }

  showGameOver(reason, you, them) {
    $('over-reason').textContent = reason
    $('over-you').textContent = you
    $('over-them').textContent = them
    this._show('over')
  }

  showWin(you, them) {
    $('win-you').textContent = you
    $('win-them').textContent = them
    this._show('win')
  }

  /** Buttons must blur after a click or Space would re-trigger them in-flight. */
  bind({ onPlay, onRetry, onResume }) {
    const wrap = (fn) => (e) => {
      e.currentTarget.blur()
      fn()
    }
    this.btnPlay.addEventListener('click', wrap(onPlay))
    this.btnRetry.addEventListener('click', wrap(onRetry))
    this.btnAgain.addEventListener('click', wrap(onRetry))
    this.btnResume.addEventListener('click', wrap(onResume))
  }
}
