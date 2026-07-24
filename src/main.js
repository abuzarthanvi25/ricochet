import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import './style.css'
import { CFG } from './config.js'
import { loadAssets, CLIP } from './core/assets.js'
import {
  initInput,
  consumeMouse,
  onLockChange,
  onLockError,
  requestLock,
  releaseLock,
  isLocked,
} from './core/input.js'
import { Game, STATE } from './core/game.js'
import { Hud } from './ui/hud.js'
import { Overlays } from './ui/overlays.js'
import { initAudio, resumeAudio, isMuted, setMuted } from './fx/audio.js'
import {
  loadFlightAssist,
  saveFlightAssist,
  loadAimAssist,
  saveAimAssist,
  loadSensitivity,
  saveSensitivity,
  getProjSpeedMul,
  setProjSpeedMul,
  loadBloom,
  saveBloom,
} from './core/settings.js'

// Styles are applied by the time this module runs, so drop the anti-FOUC guard
// (see index.html) and reveal the fully-styled page.
document.documentElement.classList.remove('preload')

const canvas = document.getElementById('scene')

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
// EffectComposer runs several passes per frame and info auto-resets on each
// one, so the default counter only ever reports the final blit. Reset manually
// to get a real per-frame total in the debug overlay.
renderer.info.autoReset = false

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x04070c)
scene.fog = new THREE.Fog(0x04070c, CFG.arena.fogNear, CFG.arena.fogFar)

const camera = new THREE.PerspectiveCamera(
  CFG.camera.fov,
  window.innerWidth / window.innerHeight,
  CFG.camera.near,
  CFG.camera.far
)

// Ambient fill plus two cool rim lights; the dynamic light pool does the rest.
// Ambient + key nudged up with the larger arena: these are constant lights whose
// intensity is a plain uniform, so brightening them costs nothing and does not
// touch the visible light count the shader program key is baked from.
scene.add(new THREE.AmbientLight(0x4a6a88, 0.7))
const key = new THREE.DirectionalLight(0x9fd8ff, 1.3)
key.position.set(0.4, 1, 0.3)
scene.add(key)
const rim = new THREE.DirectionalLight(0xff6688, 0.4)
rim.position.set(-0.6, -0.4, -0.7)
scene.add(rim)

// ---------------------------------------------------------------- post fx

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const BLOOM = CFG.fx.bloomScale
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth * BLOOM, window.innerHeight * BLOOM),
  CFG.fx.bloomStrength,
  CFG.fx.bloomRadius,
  CFG.fx.bloomThreshold
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  // Bloom keeps its own reduced internal resolution -- see CFG.fx.bloomScale.
  bloom.setSize(w * BLOOM, h * BLOOM)
  // Nameplates project into CSS pixels, so they need the logical size.
  if (game) game.viewport = { width: w, height: h }
}
window.addEventListener('resize', resize)

// ------------------------------------------------------------------- boot

const hud = new Hud()
const overlays = new Overlays()
initInput(canvas)
initAudio()

let game = null
let pendingStart = false
let perf = null

// Mute persists across sessions, so it is wired before the first screen shows.
function applyMute(on) {
  setMuted(on)
  overlays.setMuted(isMuted())
}
overlays.onSoundToggle(() => applyMute(!isMuted()))
applyMute(isMuted())

// Flight assist, aim assist and sensitivity persist across sessions. The cached
// values below are the source of truth for the option controls before `game`
// exists; boot() copies them onto the game once it is built.
let flightAssistOn = loadFlightAssist()
let aimAssistOn = loadAimAssist()
let sensitivity = loadSensitivity()

function applyFlightAssist(on) {
  flightAssistOn = on
  if (game) game.player.flightAssist = on
  saveFlightAssist(on)
  overlays.setFlightAssist(on)
}
function applyAimAssist(on) {
  aimAssistOn = on
  if (game) game.aimAssistEnabled = on
  saveAimAssist(on)
  overlays.setAimAssist(on)
}
function applySensitivity(mul) {
  sensitivity = mul
  if (game) game.rig.sensitivityMul = mul
  saveSensitivity(mul)
  overlays.setSensitivity(mul)
}
// Projectile speed lives entirely in settings.js (Bot.projSpeed reads it), so
// it needs no `game` reference and can apply before boot.
function applyProjSpeed(mul) {
  overlays.setProjSpeed(setProjSpeedMul(mul))
}
// Bloom is a composer pass -- `enabled = false` skips it (no material recompile,
// so toggling is free and safe). Big GPU saver on low-end machines.
let bloomOn = loadBloom()
function applyBloom(on) {
  bloomOn = on
  bloom.enabled = on
  saveBloom(on)
  overlays.setBloom(on)
}
overlays.onFlightAssistToggle(() => applyFlightAssist(!flightAssistOn))
overlays.onAimAssistToggle(() => applyAimAssist(!aimAssistOn))
overlays.onSensitivityChange((m) => applySensitivity(m))
overlays.onProjSpeedChange((m) => applyProjSpeed(m))
overlays.onBloomToggle(() => applyBloom(!bloomOn))
applyFlightAssist(flightAssistOn)
applyAimAssist(aimAssistOn)
applySensitivity(sensitivity)
applyProjSpeed(getProjSpeedMul())
applyBloom(bloomOn)

overlays.bind({
  onPlay: () => beginMatch(true),
  onRetry: () => beginMatch(true),
  onResume: () => {
    pendingStart = false
    requestLock()
  },
})

function beginMatch(fresh) {
  if (!game) return
  resumeAudio()
  if (fresh) game.reset()
  pendingStart = true
  requestLock()
}

onLockChange((locked) => {
  if (!game) return

  if (locked) {
    if (pendingStart) {
      pendingStart = false
      game.start()
    } else {
      game.resume()
    }
    overlays.hide()
    hud.show()
    return
  }

  // Lock lost. If the match is still live that is a pause, not a loss.
  if (game.state === STATE.PLAYING) {
    game.pause()
    hud.hide()
    overlays.showPaused()
  }
})

onLockError(() => {
  pendingStart = false
  overlays.notice('Click the page first — the browser blocked mouse capture.')
})

/**
 * stats-gl and lil-gui are debug-only, so they load on demand as a separate
 * chunk rather than riding along in the main bundle for every player.
 */
async function enablePerf() {
  if (perf) {
    perf.setVisible(!perf.enabled)
    return
  }
  const { Perf, stressTest } = await import('./dev/perf.js')
  perf = new Perf(renderer, game)
  await perf.mount()
  window.RICOCHET.perf = perf
  window.RICOCHET.stressTest = stressTest
}

/**
 * renderer.compile() only walks *visible* objects, so the pooled projectile and
 * explosion meshes -- which start hidden -- would otherwise compile on the
 * first shot fired. Reveal them for the compile, then hide them again.
 */
async function warmUpShaders() {
  const hidden = []
  scene.traverse((o) => {
    if ((o.isMesh || o.isLine || o.isPoints || o.isInstancedMesh) && !o.visible) {
      hidden.push(o)
      o.visible = true
    }
  })
  try {
    await renderer.compileAsync(scene, camera)
  } catch {
    renderer.compile(scene, camera)
  }
  for (const o of hidden) o.visible = false
}

async function boot() {
  try {
    await loadAssets()
  } catch (err) {
    console.error(err)
    overlays.failed('failed to load shooter_bot.glb')
    return
  }

  game = new Game({ scene, camera, hud, overlays })
  // Copy the stored options onto the freshly built game.
  game.player.flightAssist = flightAssistOn
  game.aimAssistEnabled = aimAssistOn
  game.rig.sensitivityMul = sensitivity
  game.onMatchEnd = (result, score) => {
    releaseLock()
    hud.hide()
    if (result === 'win') overlays.showWin(score.you, score.them)
    else overlays.showGameOver('The bots hit fifteen first.', score.you, score.them)
  }

  game.viewport = { width: window.innerWidth, height: window.innerHeight }

  // Compile every material up front, while the title screen is still up. The
  // light count is now fixed, so whatever compiles here stays cached for the
  // whole session instead of stalling a frame mid-fight.
  await warmUpShaders()

  // Difficulty is live: changing it from the pause menu re-tunes the bots in
  // place, no restart needed.
  overlays.onDifficultyPick((id) => {
    game.setDifficulty(id)
    overlays.setDifficulty(id)
  })
  overlays.setDifficulty(game.difficultyId)

  game.reset()
  game.state = STATE.IDLE
  overlays.ready()
  overlays.showTitle()

  // Dev hook: drive the game from the console without pointer lock.
  window.RICOCHET = {
    game,
    scene,
    camera,
    renderer,
    composer,
    THREE,
    CFG,
    STATE,
    hud,
    overlays,
    powerups: game.powerups,
    // Bound to THIS module's audio instance. A console `import()` of audio.js
    // resolves to a separate Vite module copy with its own `muted` flag, so
    // probing that one reports the wrong answer.
    audio: { isMuted, setMuted: applyMute },
    options: {
      setFlightAssist: applyFlightAssist,
      setAimAssist: applyAimAssist,
      setSensitivity: applySensitivity,
      setProjSpeed: applyProjSpeed,
      setBloom: applyBloom,
    },
  }

  if (new URLSearchParams(location.search).has('perf')) await enablePerf()
}

// ------------------------------------------------------------------- loop

const mouse = { x: 0, y: 0 }
let last = performance.now()
let fps = 60
let debugOn = CFG.debug
let powerupDebug = false

// Powerup debug (F2). Grants come straight from Game.grantPowerup, so they do
// not consume the match budget -- you can sit on one powerup for as long as it
// takes to test it. Digits are shared with the clip inspector below, so this
// claims them first and returns.
const POWERUP_KEYS = {
  Digit1: 'shield',
  Digit2: 'permaboost',
  Digit3: 'frostiles',
  Digit4: 'rocketiles',
}

window.addEventListener('keydown', async (e) => {
  // M works mid-match too -- the overlays are only reachable once you have
  // already released the pointer.
  if (e.code === 'KeyM') applyMute(!isMuted())
  // X toggles flight assist mid-flight; the HUD flashes the new state.
  if (e.code === 'KeyX') {
    applyFlightAssist(!flightAssistOn)
    hud.flashAssist(flightAssistOn)
  }
  if (e.code === 'F3') {
    e.preventDefault()
    debugOn = !debugOn
    if (!debugOn) hud.setDebug(null)
  }
  if (e.code === 'F4' && game) {
    e.preventDefault()
    await enablePerf()
  }
  if (e.code === 'F2' && game) {
    e.preventDefault()
    powerupDebug = !powerupDebug
    hud.setPowerupDebug(powerupDebug)
    if (!powerupDebug) game.player.clearPowerup()
    return
  }

  if (powerupDebug && game) {
    if (e.code === 'Digit0') {
      game.player.clearPowerup()
      return
    }
    const id = POWERUP_KEYS[e.code]
    if (id) {
      game.grantPowerup(id)
      return
    }
  }

  // Clip inspector: with debug on, 1-5 force-play each animation solo. This is
  // the check that the shared-timeline retiming actually took -- every clip
  // must start moving immediately, with no dead pause at the front.
  if (debugOn && game && game.player.alive) {
    const map = {
      Digit1: CLIP.IDLE,
      Digit2: CLIP.SHOOT,
      Digit3: CLIP.MOVE,
      Digit4: CLIP.HURT,
      Digit5: CLIP.DEATH,
    }
    const clip = map[e.code]
    if (clip) {
      game.player.override = null
      game.player.playOverride(clip)
      // eslint-disable-next-line no-console -- clip inspector output is the point
      console.log(`[clip] ${clip} -> ${game.player.actions[clip].getClip().duration.toFixed(3)}s`)
    }
  }
})

function frame(now) {
  requestAnimationFrame(frame)
  if (perf) perf.begin()

  let dt = (now - last) / 1000
  last = now
  // Clamp so an alt-tab cannot hand us a one-second step.
  dt = Math.min(dt, 1 / 30)
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08

  renderer.info.reset()

  if (game) {
    if (isLocked()) {
      consumeMouse(mouse)
      game.rig.applyMouse(mouse.x, mouse.y)
    }
    game.update(dt)

    if (debugOn) {
      game._drawCalls = renderer.info.render.calls
      hud.setDebug(game.debugText(fps))
    }
  }

  composer.render()
  if (perf) perf.end()
}

boot()
requestAnimationFrame(frame)
