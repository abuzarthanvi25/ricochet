/**
 * Synthesised SFX -- no audio files to ship or source.
 *
 * The bounce sound deliberately rises in pitch with the bounce count: it is the
 * audio half of the "your own shot is armed now" tell, and you often hear a
 * ricochet coming before you see it.
 */

const STORAGE_KEY = 'ricochet.muted'
const VOLUME = 0.35

let ctx = null
let master = null
let enabled = true
let muted = false

export function initAudio() {
  muted = loadMuted()
  if (ctx) return
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) {
    enabled = false
    return
  }
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : VOLUME
  master.connect(ctx.destination)
}

function loadMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // localStorage throws in private mode; unmuted is the right default.
    return false
  }
}

export const isMuted = () => muted

/**
 * Muting zeroes the master gain AND short-circuits every voice before it is
 * built. The gain alone would silence the game while still allocating an
 * oscillator, a gain node and an envelope per bounce -- during a busy fight
 * that is dozens of nodes a second of pure waste.
 */
export function setMuted(on) {
  muted = !!on
  if (master) master.gain.value = muted ? 0 : VOLUME
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0')
  } catch {
    /* non-fatal */
  }
  return muted
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume()
}

export function setVolume(v) {
  if (master) master.gain.value = v
}

function envGain(attack, decay, peak = 1) {
  const g = ctx.createGain()
  const t = ctx.currentTime
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(master)
  return { node: g, stopAt: t + attack + decay + 0.02 }
}

function tone({ type = 'sine', from, to, attack = 0.005, decay = 0.15, peak = 0.6, detune = 0 }) {
  if (!ctx || !enabled || muted) return
  const osc = ctx.createOscillator()
  osc.type = type
  osc.detune.value = detune
  const t = ctx.currentTime
  osc.frequency.setValueAtTime(from, t)
  if (to !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + attack + decay)

  const env = envGain(attack, decay, peak)
  osc.connect(env.node)
  osc.start(t)
  osc.stop(env.stopAt)
}

let noiseBuffer = null
function noise({
  attack = 0.002,
  decay = 0.3,
  peak = 0.6,
  filterFrom = 4000,
  filterTo = 200,
  q = 1,
}) {
  if (!ctx || !enabled || muted) return
  if (!noiseBuffer) {
    const len = ctx.sampleRate * 1.0
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = q
  const t = ctx.currentTime
  filter.frequency.setValueAtTime(filterFrom, t)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t + attack + decay)

  const env = envGain(attack, decay, peak)
  src.connect(filter)
  filter.connect(env.node)
  src.start(t)
  src.stop(env.stopAt)
}

/** Distance attenuation, applied by the caller before triggering. */
function gainFor(dist, falloff = 45) {
  return Math.max(0, 1 - dist / falloff)
}

/**
 * Voice cap. Every call here builds fresh oscillator/gain nodes, and a chaotic
 * fight can produce dozens of bounces a second across 40+ live projectiles.
 * Past a handful of simultaneous voices the extras are inaudible anyway, so
 * budget them per short window rather than letting node churn hit the main
 * thread.
 */
const VOICE_WINDOW_MS = 60
const voiceBudget = new Map()

function takeVoice(kind, max) {
  if (!ctx) return false
  const now = ctx.currentTime * 1000
  let slot = voiceBudget.get(kind)
  if (!slot || now - slot.start > VOICE_WINDOW_MS) {
    slot = { start: now, used: 0 }
    voiceBudget.set(kind, slot)
  }
  if (slot.used >= max) return false
  slot.used++
  return true
}

export const sfx = {
  fire(dist = 0) {
    const g = gainFor(dist, 60)
    if (g <= 0.02) return
    if (!takeVoice('fire', 4)) return
    tone({ type: 'square', from: 780, to: 190, attack: 0.004, decay: 0.09, peak: 0.28 * g })
    tone({ type: 'sawtooth', from: 320, to: 90, attack: 0.004, decay: 0.13, peak: 0.16 * g })
  },

  bounce(bounces, dist = 0) {
    const g = gainFor(dist, 55)
    if (g <= 0.02) return
    if (!takeVoice('bounce', 4)) return
    // Pitch climbs with each bounce -- the audible "this is armed" cue.
    const base = 520 * Math.pow(1.28, Math.min(bounces, 6))
    tone({
      type: 'triangle',
      from: base,
      to: base * 0.55,
      attack: 0.002,
      decay: 0.075,
      peak: 0.3 * g,
    })
  },

  explode(dist = 0) {
    const g = gainFor(dist, 70)
    if (g <= 0.02) return
    if (!takeVoice('explode', 3)) return
    noise({ attack: 0.004, decay: 0.42, peak: 0.75 * g, filterFrom: 2600, filterTo: 90 })
    tone({ type: 'sine', from: 160, to: 34, attack: 0.006, decay: 0.36, peak: 0.5 * g })
  },

  hurt() {
    tone({ type: 'square', from: 210, to: 70, attack: 0.004, decay: 0.2, peak: 0.34 })
    noise({ attack: 0.003, decay: 0.14, peak: 0.22, filterFrom: 1400, filterTo: 220 })
  },

  death(dist = 0) {
    const g = gainFor(dist, 70)
    if (g <= 0.02) return
    tone({ type: 'sawtooth', from: 380, to: 42, attack: 0.01, decay: 0.85, peak: 0.4 * g })
    noise({ attack: 0.01, decay: 0.7, peak: 0.35 * g, filterFrom: 1800, filterTo: 60 })
  },

  kill() {
    tone({ type: 'square', from: 880, to: 1320, attack: 0.004, decay: 0.1, peak: 0.24 })
    tone({ type: 'square', from: 1320, to: 1760, attack: 0.06, decay: 0.12, peak: 0.18 })
  },

  boost() {
    tone({ type: 'sawtooth', from: 140, to: 620, attack: 0.02, decay: 0.22, peak: 0.22 })
  },

  /** Shot deflected by a shield. Deliberately metallic and unlike a wall bounce. */
  shieldHit(dist = 0) {
    const g = gainFor(dist, 55)
    if (g <= 0.02) return
    if (!takeVoice('shield', 3)) return
    tone({ type: 'sine', from: 1500, to: 900, attack: 0.002, decay: 0.14, peak: 0.26 * g })
    tone({ type: 'triangle', from: 2300, to: 1700, attack: 0.002, decay: 0.09, peak: 0.14 * g })
  },

  powerUp() {
    ;[660, 880, 1320].forEach((f, i) => {
      setTimeout(
        () =>
          tone({ type: 'square', from: f, to: f * 1.02, attack: 0.008, decay: 0.16, peak: 0.2 }),
        i * 70
      )
    })
  },

  /** A bot took one. Quieter and lower -- you should notice, not celebrate. */
  powerUpRemote(dist = 0) {
    const g = gainFor(dist, 70)
    if (g <= 0.02) return
    tone({ type: 'triangle', from: 440, to: 660, attack: 0.01, decay: 0.22, peak: 0.16 * g })
  },

  powerDown() {
    tone({ type: 'square', from: 880, to: 300, attack: 0.006, decay: 0.28, peak: 0.18 })
  },

  /** Frostile landed on you. Descending and brittle -- the opposite of powerUp. */
  freeze() {
    tone({ type: 'triangle', from: 1800, to: 420, attack: 0.004, decay: 0.45, peak: 0.24 })
    noise({ attack: 0.002, decay: 0.3, peak: 0.16, filterFrom: 7000, filterTo: 2200, q: 4 })
  },

  warn() {
    tone({ type: 'triangle', from: 1200, to: 1200, attack: 0.01, decay: 0.09, peak: 0.16 })
  },

  win() {
    ;[523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(
        () => tone({ type: 'square', from: f, to: f, attack: 0.01, decay: 0.3, peak: 0.25 }),
        i * 110
      )
    })
  },

  lose() {
    ;[392, 330, 262, 196].forEach((f, i) => {
      setTimeout(
        () =>
          tone({ type: 'sawtooth', from: f, to: f * 0.9, attack: 0.02, decay: 0.4, peak: 0.28 }),
        i * 150
      )
    })
  },
}
