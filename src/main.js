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
import { initAudio, resumeAudio } from './fx/audio.js'

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
scene.add(new THREE.AmbientLight(0x4a6a88, 0.55))
const key = new THREE.DirectionalLight(0x9fd8ff, 1.1)
key.position.set(0.4, 1, 0.3)
scene.add(key)
const rim = new THREE.DirectionalLight(0xff6688, 0.4)
rim.position.set(-0.6, -0.4, -0.7)
scene.add(rim)

// ---------------------------------------------------------------- post fx

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
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
  bloom.setSize(w, h)
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
  window.RICOCHET = { game, scene, camera, renderer, composer, THREE, CFG, STATE, hud, overlays }

  if (new URLSearchParams(location.search).has('perf')) await enablePerf()
}

// ------------------------------------------------------------------- loop

const mouse = { x: 0, y: 0 }
let last = performance.now()
let fps = 60
let debugOn = CFG.debug

window.addEventListener('keydown', async (e) => {
  if (e.code === 'F3') {
    e.preventDefault()
    debugOn = !debugOn
    if (!debugOn) hud.setDebug(null)
  }
  if (e.code === 'F4' && game) {
    e.preventDefault()
    await enablePerf()
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
