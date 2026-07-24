import { DIFFICULTIES } from '../core/difficulty.js'
import { POWERUPS } from '../core/powerups.js'
import { SENS_MIN, SENS_MAX, PROJ_MIN, PROJ_MAX } from '../core/settings.js'

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
    { keys: ['Q'], label: 'Boost dash' },
    { keys: ['Mouse'], label: 'Aim' },
    { keys: ['LMB'], label: 'Fire' },
    { keys: ['X'], label: 'Flight assist' },
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
    this.optionGroups = [...document.querySelectorAll('[data-options-group]')]
    this._onDifficultyPick = null
    this._onSoundToggle = null
    this._onFlightAssistToggle = null
    this._onAimAssistToggle = null
    this._onSensitivityChange = null
    this._onProjSpeedChange = null
    this._buildDifficultyControls()
    this._buildControls()
    this._buildPowerupGuide()
    this._buildSoundToggle()
    this._buildOptions()
  }

  /**
   * Flight-assist / aim-assist toggles and a sensitivity slider, rendered onto
   * both the title screen and the pause menu. Same shared-builder reasoning as
   * the sound toggle: one source of truth so the two screens cannot disagree.
   */
  _buildOptions() {
    for (const group of this.optionGroups) {
      group.append(
        this._toggleButton('flight', 'FLIGHT ASSIST', () => this._onFlightAssistToggle?.()),
        this._toggleButton('aim', 'AIM ASSIST', () => this._onAimAssistToggle?.()),
        this._slider('sens', 'SENSITIVITY', SENS_MIN, SENS_MAX, 0.05, (v) =>
          this._onSensitivityChange?.(v)
        ),
        this._slider('proj', 'SHOT SPEED', PROJ_MIN, PROJ_MAX, 0.05, (v) =>
          this._onProjSpeedChange?.(v)
        )
      )
    }
  }

  _slider(key, label, min, max, step, onInput) {
    const wrap = document.createElement('label')
    wrap.className = 'opt-slider'
    wrap.dataset.slider = key
    const cap = document.createElement('span')
    cap.className = 'opt-cap'
    cap.textContent = label
    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'opt-input'
    input.min = min
    input.max = max
    input.step = step
    const val = document.createElement('span')
    val.className = 'opt-val'
    input.addEventListener('input', (e) => onInput(parseFloat(e.target.value)))
    wrap.append(cap, input, val)
    return wrap
  }

  _toggleButton(opt, label, onClick) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'opt-btn'
    btn.dataset.opt = opt
    btn.dataset.base = label
    const dot = document.createElement('span')
    dot.className = 'opt-dot'
    const text = document.createElement('span')
    text.className = 'opt-label'
    text.textContent = label
    btn.append(dot, text)
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur()
      onClick()
    })
    return btn
  }

  onFlightAssistToggle(fn) {
    this._onFlightAssistToggle = fn
  }

  onAimAssistToggle(fn) {
    this._onAimAssistToggle = fn
  }

  onSensitivityChange(fn) {
    this._onSensitivityChange = fn
  }

  onProjSpeedChange(fn) {
    this._onProjSpeedChange = fn
  }

  _setToggle(opt, on) {
    for (const group of this.optionGroups) {
      const btn = group.querySelector(`.opt-btn[data-opt="${opt}"]`)
      if (!btn) continue
      btn.classList.toggle('on', on)
      btn.querySelector('.opt-label').textContent = `${btn.dataset.base}: ${on ? 'ON' : 'OFF'}`
    }
  }

  setFlightAssist(on) {
    this._setToggle('flight', on)
  }

  setAimAssist(on) {
    this._setToggle('aim', on)
  }

  _setSlider(key, mul) {
    for (const group of this.optionGroups) {
      const wrap = group.querySelector(`.opt-slider[data-slider="${key}"]`)
      if (!wrap) continue
      wrap.querySelector('.opt-input').value = mul
      wrap.querySelector('.opt-val').textContent = `${mul.toFixed(2)}×`
    }
  }

  setSensitivity(mul) {
    this._setSlider('sens', mul)
  }

  setProjSpeed(mul) {
    this._setSlider('proj', mul)
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
