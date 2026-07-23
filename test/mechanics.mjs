// Headless regression tests for the rules the game stands on: analytic sweeps,
// clip retiming, and the arming rule that makes your own ricochet lethal.
// Run with: npm test
import * as THREE from 'three'
import fs from 'node:fs'
import { CFG, HALF } from '../src/config.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps

console.log('\n== config ==')
ok('arena half extents', HALF.x === 30 && HALF.y === 20 && HALF.z === 30)

// ---------------------------------------------------------------- collision
const { sweepArena, raySphere, clampToArena, resolveSphere, segmentClear } =
  await import('../src/core/collision.js')

console.log('\n== sweepArena ==')
{
  const n = new THREE.Vector3()
  const p = new THREE.Vector3(0, 0, 0)
  const r = CFG.proj.radius

  let t = sweepArena(p, new THREE.Vector3(1, 0, 0), 1000, r, n)
  ok('+X wall distance', near(t, HALF.x - r), `got ${t}`)
  ok('+X wall normal points -X', n.x === -1 && n.y === 0 && n.z === 0, n.toArray())

  t = sweepArena(p, new THREE.Vector3(0, -1, 0), 1000, r, n)
  ok('-Y wall distance', near(t, HALF.y - r), `got ${t}`)
  ok('-Y wall normal points +Y', n.y === 1)

  t = sweepArena(p, new THREE.Vector3(1, 0, 0), 5, r, n)
  ok('no hit inside short sweep', t === -1, `got ${t}`)

  // corner-ish: nearest axis must win
  t = sweepArena(new THREE.Vector3(0, 19, 0), new THREE.Vector3(0.1, 1, 0).normalize(), 1000, r, n)
  ok('nearest axis wins near ceiling', n.y === -1, n.toArray())

  // already outside -> immediate contact, still reflects inward
  t = sweepArena(new THREE.Vector3(31, 0, 0), new THREE.Vector3(1, 0, 0), 1000, r, n)
  ok('outside clamps to t=0', t === 0 && n.x === -1, `t=${t}`)
}

console.log('\n== raySphere ==')
{
  const o = new THREE.Vector3(0, 0, 0)
  const c = new THREE.Vector3(10, 0, 0)
  let t = raySphere(o, new THREE.Vector3(1, 0, 0), 100, c, 2)
  ok('head-on hit', near(t, 8), `got ${t}`)
  t = raySphere(o, new THREE.Vector3(-1, 0, 0), 100, c, 2)
  ok('facing away misses', t === -1)
  t = raySphere(o, new THREE.Vector3(1, 0, 0), 5, c, 2)
  ok('beyond maxT misses', t === -1)
  t = raySphere(o, new THREE.Vector3(0, 1, 0), 100, c, 2)
  ok('perpendicular misses', t === -1)
  // origin inside -> returns exit point, so nothing gets stuck
  t = raySphere(new THREE.Vector3(10, 0, 0), new THREE.Vector3(1, 0, 0), 100, c, 2)
  ok('origin inside returns exit', near(t, 2), `got ${t}`)
}

console.log('\n== bot vs arena ==')
{
  const p = new THREE.Vector3(100, 0, 0)
  const v = new THREE.Vector3(10, 0, 3)
  clampToArena(p, v, 1)
  ok('clamped to wall', near(p.x, HALF.x - 1), `got ${p.x}`)
  ok('inward velocity killed', v.x === 0)
  ok('tangential velocity kept', v.z === 3)

  const bp = new THREE.Vector3(0.5, 0, 0)
  const bv = new THREE.Vector3(-5, 0, 0)
  resolveSphere(bp, bv, 1, new THREE.Vector3(0, 0, 0), 3)
  ok('pushed out of debris', near(bp.length(), 4), `got ${bp.length()}`)
  ok('inward vel removed', bv.x >= -1e-6, `got ${bv.x}`)
}

// ------------------------------------------------------------------- util
const { interceptTime, orientToDirection, jitterDirection } =
  await import('../src/core/util.js')

console.log('\n== intercept ==')
{
  // target 45 units ahead moving +X at 10; projectile 45 u/s
  const t = interceptTime(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -45), new THREE.Vector3(10, 0, 0), 45)
  ok('positive solution', t > 0, `got ${t}`)
  const aim = new THREE.Vector3(0, 0, -45).addScaledVector(new THREE.Vector3(10, 0, 0), t)
  ok('lead point reachable in t', near(aim.length() / 45, t, 1e-3), `dist/speed=${aim.length() / 45} t=${t}`)

  const stat = interceptTime(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -45), new THREE.Vector3(0, 0, 0), 45)
  ok('stationary target -> t = d/s', near(stat, 1), `got ${stat}`)
}

console.log('\n== orientation ==')
{
  const o = new THREE.Object3D()
  const dir = new THREE.Vector3(1, 0, 0)
  orientToDirection(o, dir)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion)
  ok('local -Z maps to dir', fwd.distanceTo(dir) < 1e-6, fwd.toArray())

  const down = new THREE.Vector3(0, -1, 0)
  orientToDirection(o, down)
  const fwd2 = new THREE.Vector3(0, 0, -1).applyQuaternion(o.quaternion)
  ok('straight down does not degenerate', fwd2.distanceTo(down) < 1e-3, fwd2.toArray())
}

// ------------------------------------------------------- clip retiming
console.log('\n== clip retiming (real GLB track times) ==')
{
  // Rebuild the exact shared-timeline situation the GLB ships with.
  const ranges = {
    Idle: [0.033, 9.992], Shoot: [10.033, 10.367], Move: [10.45, 11.617],
    Hurt: [11.7, 12.658], Death: [12.7, 14.0],
  }
  const expected = { Idle: 9.959, Shoot: 0.334, Move: 1.167, Hurt: 0.958, Death: 1.3 }

  function retimeClip(clip) {
    let t0 = Infinity
    for (const track of clip.tracks) if (track.times.length) t0 = Math.min(t0, track.times[0])
    if (!Number.isFinite(t0) || t0 <= 0) return clip
    for (const track of clip.tracks) {
      const times = track.times
      for (let i = 0; i < times.length; i++) times[i] -= t0
    }
    clip.resetDuration()
    return clip
  }

  for (const [name, [a, b]] of Object.entries(ranges)) {
    const times = new Float32Array([a, (a + b) / 2, b])
    const values = new Float32Array(9)
    const track = new THREE.VectorKeyframeTrack('.position', times, values)
    const clip = new THREE.AnimationClip(name, -1, [track])
    const before = clip.duration
    retimeClip(clip)
    ok(`${name}: ${before.toFixed(3)}s -> ${clip.duration.toFixed(3)}s`,
       near(clip.duration, expected[name], 2e-3) && near(clip.tracks[0].times[0], 0),
       `expected ${expected[name]}`)
  }
}

// --------------------------------------------- projectile: the core mechanic
console.log('\n== projectile stepping / arming ==')
{
  const { ProjectileSystem } = await import('../src/weapons/projectiles.js')
  const fakeScene = { add() {} }
  const sys = new ProjectileSystem(fakeScene)

  const bounceLog = []
  const detonations = []
  const damage = []

  const owner = {
    id: 1, alive: true, radius: CFG.bot.radius,
    pos: new THREE.Vector3(0, 0, 0),
    takeDamage(amt, by) { damage.push({ who: 'owner', amt, by }) },
  }
  const target = {
    id: 2, alive: true, radius: CFG.bot.radius,
    pos: new THREE.Vector3(0, 0, -20),
    takeDamage(amt, by) { damage.push({ who: 'target', amt, by }) },
  }

  const game = {
    arena: { debris: [] },
    bots: [owner, target],
    damageContext: { bounces: 0, ownerId: -1 },
    setDamageContext(p) { this.damageContext.bounces = p.bounces; this.damageContext.ownerId = p.ownerId },
    detonate(p, hit) { detonations.push({ pos: p.pos.clone(), bounces: p.bounces, hit: hit ? hit.id : null }) },
    onProjectileBounce(p) { bounceLog.push(p.bounces) },
  }

  // --- 1. direct hit on an enemy, no bounce
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 60 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('direct shot hits the enemy', damage.some((d) => d.who === 'target'), JSON.stringify(damage))
  ok('direct hit had 0 bounces', detonations[0] && detonations[0].bounces === 0)

  // --- 2. owner is immune before the first bounce
  damage.length = 0; detonations.length = 0; sys.clear()
  const p2 = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  sys.update(1 / 600, game) // tiny step: still overlapping the owner sphere
  ok('owner not hit pre-bounce', !damage.some((d) => d.who === 'owner'), JSON.stringify(damage))

  // --- 3. THE mechanic: fire at a wall point-blank, get killed by the return
  damage.length = 0; detonations.length = 0; bounceLog.length = 0; sys.clear()
  owner.pos.set(0, 0, HALF.z - 6)
  target.pos.set(0, 0, -200) // far out of the way
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, HALF.z - 5), new THREE.Vector3(0, 0, 1))
  let frames = 0
  while (sys.active.length && frames++ < 300) sys.update(1 / 60, game)
  ok('projectile bounced off the wall', bounceLog.length >= 1, `bounces ${bounceLog}`)
  ok('own ricochet damaged the shooter', damage.some((d) => d.who === 'owner' && d.by === 1), JSON.stringify(damage))

  // --- 4. lifetime detonation, and it must expire on time
  damage.length = 0; detonations.length = 0; sys.clear()
  owner.pos.set(0, 0, 200); target.pos.set(0, 0, -200)
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0.3, 0.2).normalize())
  let t = 0
  while (sys.active.length && t < 10) { sys.update(1 / 60, game); t += 1 / 60 }
  ok('detonated at lifetime', Math.abs(t - CFG.proj.lifetime) < 0.05, `t=${t.toFixed(3)} want ${CFG.proj.lifetime}`)
  ok('bounced several times first', detonations[0] && detonations[0].bounces >= 2, `bounces ${detonations[0]?.bounces}`)

  // --- 5. no tunnelling at absurd speed
  const realSpeed = CFG.proj.speed
  CFG.proj.speed = 400
  let escaped = 0
  for (let trial = 0; trial < 200; trial++) {
    sys.clear()
    const d = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
    const p = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), d)
    for (let i = 0; i < 180 && sys.active.length; i++) {
      sys.update(1 / 60, game)
      if (Math.abs(p.pos.x) > HALF.x + 0.5 || Math.abs(p.pos.y) > HALF.y + 0.5 || Math.abs(p.pos.z) > HALF.z + 0.5) {
        escaped++
        break
      }
    }
  }
  CFG.proj.speed = realSpeed
  ok('200 shots at 400 u/s, none escaped the box', escaped === 0, `${escaped} escaped`)

  // --- 6. debris reflect too
  damage.length = 0; detonations.length = 0; bounceLog.length = 0; sys.clear()
  game.arena.debris = [{ pos: new THREE.Vector3(0, 0, -10), radius: 4 }]
  owner.pos.set(0, 0, 200); target.pos.set(0, 0, -300)
  const p6 = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 12 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('debris reflects the shot', bounceLog.length >= 1 && p6.vel.z > 0, `vel.z=${p6.vel.z}`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
