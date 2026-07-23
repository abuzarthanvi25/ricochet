import { DIFFICULTIES } from '../core/difficulty.js'

const $ = (id) => document.getElementById(id)

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
    this._onDifficultyPick = null
    this._buildDifficultyControls()
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
