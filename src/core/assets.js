import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { CFG } from '../config.js'
import botUrl from '../../assets/models/shooter_bot.glb?url'

export const CLIP = {
  IDLE: 'Idle',
  SHOOT: 'Shoot',
  MOVE: 'Move',
  HURT: 'Hurt',
  DEATH: 'Death',
}

let template = null
let clips = null

/**
 * The GLB's five clips are all baked onto ONE shared timeline:
 *
 *   Idle  0.033 -  9.992      Shoot 10.033 - 10.367
 *   Move 10.450 - 11.617      Hurt  11.700 - 12.658
 *   Death 12.700 - 14.000
 *
 * three.js derives clip.duration from the largest track time, so playing
 * `Shoot` untouched holds frame zero for ten seconds and then plays 0.33s of
 * animation. Shifting every track back to its own start fixes all five.
 */
function retimeClip(clip) {
  let t0 = Infinity
  for (const track of clip.tracks) {
    if (track.times.length) t0 = Math.min(t0, track.times[0])
  }
  if (!Number.isFinite(t0) || t0 <= 0) return clip

  for (const track of clip.tracks) {
    const times = track.times
    for (let i = 0; i < times.length; i++) times[i] -= t0
  }
  clip.resetDuration()
  return clip
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(botUrl, onProgress)

  clips = gltf.animations.map(retimeClip)
  template = gltf.scene

  if (CFG.debug) {
    // Debug-gated: this is how you verify the shared-timeline retiming took.
    // eslint-disable-next-line no-console
    for (const c of clips) console.log(`[clip] ${c.name} -> ${c.duration.toFixed(3)}s`)
  }
  return { clips }
}

export function getClipDurations() {
  const out = {}
  for (const c of clips) out[c.name] = c.duration
  return out
}

/**
 * Build one bot instance: a skeleton-safe clone, recentred on its group origin,
 * scaled to gameplay size, turned to face -Z, with per-instance materials so a
 * single bot can flash on hit without every other bot flashing with it.
 */
export function createBotModel(teamColor, bodyTint) {
  const model = cloneSkinned(template)

  // Order matters: rotate + scale first, THEN measure, so the box we recentre
  // against is in the group's space.
  model.rotation.y = CFG.bot.yawOffset
  model.scale.setScalar(CFG.bot.modelScale)
  model.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  // The GLB's origin sits below the floating body (y 1.47 -> 3.62 at scale 1).
  model.position.sub(center)

  const materials = []
  const tint = new THREE.Color(teamColor)
  model.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    // Skinned bounds are unreliable once the pose swings; culling causes pops.
    o.frustumCulled = false
    o.castShadow = false
    o.receiveShadow = false
    const mat = o.material.clone()
    mat.emissive = tint.clone()
    mat.emissiveIntensity = 1.35
    if (bodyTint !== undefined) mat.color = new THREE.Color(bodyTint)
    mat.transparent = true // needed for the death fade
    mat.depthWrite = true
    materials.push(mat)
    o.material = mat
  })

  const muzzle = model.getObjectByName(CFG.bot.muzzleBone)
  if (!muzzle && CFG.debug) console.warn(`muzzle bone ${CFG.bot.muzzleBone} not found`)

  const clipMap = {}
  for (const c of clips) clipMap[c.name] = c

  return { model, materials, muzzle, clips: clipMap, size, baseTint: tint }
}
