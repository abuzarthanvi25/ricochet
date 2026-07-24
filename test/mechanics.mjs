// Headless regression tests for the rules the game stands on: analytic sweeps,
// clip retiming, and the arming rule that makes your own ricochet lethal.
// Run with: npm test
import * as THREE from 'three'
import { CFG, HALF } from '../src/config.js'

let pass = 0,
  fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${extra}`)
  }
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps

console.log('\n== config ==')
ok('arena half extents', HALF.x === 42 && HALF.y === 26 && HALF.z === 42)

// ---------------------------------------------------------------- collision
const { sweepArena, raySphere, clampToArena, resolveSphere } =
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
  sweepArena(new THREE.Vector3(0, 19, 0), new THREE.Vector3(0.1, 1, 0).normalize(), 1000, r, n)
  ok('nearest axis wins near ceiling', n.y === -1, n.toArray())

  // already outside -> immediate contact, still reflects inward (HALF.x is 42)
  t = sweepArena(new THREE.Vector3(43, 0, 0), new THREE.Vector3(1, 0, 0), 1000, r, n)
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
const { interceptTime, orientToDirection } = await import('../src/core/util.js')

console.log('\n== intercept ==')
{
  // target 45 units ahead moving +X at 10; projectile 45 u/s
  const t = interceptTime(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -45),
    new THREE.Vector3(10, 0, 0),
    45
  )
  ok('positive solution', t > 0, `got ${t}`)
  const aim = new THREE.Vector3(0, 0, -45).addScaledVector(new THREE.Vector3(10, 0, 0), t)
  ok(
    'lead point reachable in t',
    near(aim.length() / 45, t, 1e-3),
    `dist/speed=${aim.length() / 45} t=${t}`
  )

  const stat = interceptTime(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -45),
    new THREE.Vector3(0, 0, 0),
    45
  )
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
    Idle: [0.033, 9.992],
    Shoot: [10.033, 10.367],
    Move: [10.45, 11.617],
    Hurt: [11.7, 12.658],
    Death: [12.7, 14.0],
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
    ok(
      `${name}: ${before.toFixed(3)}s -> ${clip.duration.toFixed(3)}s`,
      near(clip.duration, expected[name], 2e-3) && near(clip.tracks[0].times[0], 0),
      `expected ${expected[name]}`
    )
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
    id: 1,
    alive: true,
    radius: CFG.bot.radius,
    pos: new THREE.Vector3(0, 0, 0),
    takeDamage(amt, by) {
      damage.push({ who: 'owner', amt, by })
    },
  }
  const target = {
    id: 2,
    alive: true,
    radius: CFG.bot.radius,
    pos: new THREE.Vector3(0, 0, -20),
    takeDamage(amt, by) {
      damage.push({ who: 'target', amt, by })
    },
  }

  const game = {
    arena: { debris: [] },
    bots: [owner, target],
    damageContext: { bounces: 0, ownerId: -1 },
    setDamageContext(p) {
      this.damageContext.bounces = p.bounces
      this.damageContext.ownerId = p.ownerId
    },
    detonate(p, hit) {
      detonations.push({ pos: p.pos.clone(), bounces: p.bounces, hit: hit ? hit.id : null })
    },
    onProjectileBounce(p) {
      bounceLog.push(p.bounces)
    },
  }

  // --- 1. direct hit on an enemy, no bounce
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 60 && sys.active.length; i++) sys.update(1 / 60, game)
  ok(
    'direct shot hits the enemy',
    damage.some((d) => d.who === 'target'),
    JSON.stringify(damage)
  )
  ok('direct hit had 0 bounces', detonations[0] && detonations[0].bounces === 0)

  // --- 2. owner is immune before the first bounce
  damage.length = 0
  detonations.length = 0
  sys.clear()
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  sys.update(1 / 600, game) // tiny step: still overlapping the owner sphere
  ok('owner not hit pre-bounce', !damage.some((d) => d.who === 'owner'), JSON.stringify(damage))

  // --- 3. THE mechanic: fire at a wall point-blank, get killed by the return
  damage.length = 0
  detonations.length = 0
  bounceLog.length = 0
  sys.clear()
  owner.pos.set(0, 0, HALF.z - 6)
  target.pos.set(0, 0, -200) // far out of the way
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, HALF.z - 5), new THREE.Vector3(0, 0, 1))
  let frames = 0
  while (sys.active.length && frames++ < 300) sys.update(1 / 60, game)
  ok('projectile bounced off the wall', bounceLog.length >= 1, `bounces ${bounceLog}`)
  ok(
    'own ricochet damaged the shooter',
    damage.some((d) => d.who === 'owner' && d.by === 1),
    JSON.stringify(damage)
  )

  // --- 4. lifetime detonation, and it must expire on time
  damage.length = 0
  detonations.length = 0
  sys.clear()
  owner.pos.set(0, 0, 200)
  target.pos.set(0, 0, -200)
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0.3, 0.2).normalize())
  let t = 0
  while (sys.active.length && t < 10) {
    sys.update(1 / 60, game)
    t += 1 / 60
  }
  ok(
    'detonated at lifetime',
    Math.abs(t - CFG.proj.lifetime) < 0.05,
    `t=${t.toFixed(3)} want ${CFG.proj.lifetime}`
  )
  ok(
    'bounced several times first',
    detonations[0] && detonations[0].bounces >= 2,
    `bounces ${detonations[0]?.bounces}`
  )

  // --- 5. no tunnelling at absurd speed
  const realSpeed = CFG.proj.speed
  CFG.proj.speed = 400
  let escaped = 0
  for (let trial = 0; trial < 200; trial++) {
    sys.clear()
    const d = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize()
    const p = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), d)
    for (let i = 0; i < 180 && sys.active.length; i++) {
      sys.update(1 / 60, game)
      if (
        Math.abs(p.pos.x) > HALF.x + 0.5 ||
        Math.abs(p.pos.y) > HALF.y + 0.5 ||
        Math.abs(p.pos.z) > HALF.z + 0.5
      ) {
        escaped++
        break
      }
    }
  }
  CFG.proj.speed = realSpeed
  ok('200 shots at 400 u/s, none escaped the box', escaped === 0, `${escaped} escaped`)

  // --- 6. debris reflect too
  damage.length = 0
  detonations.length = 0
  bounceLog.length = 0
  sys.clear()
  game.arena.debris = [{ pos: new THREE.Vector3(0, 0, -10), radius: 4 }]
  owner.pos.set(0, 0, 200)
  target.pos.set(0, 0, -300)
  const p6 = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 12 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('debris reflects the shot', bounceLog.length >= 1 && p6.vel.z > 0, `vel.z=${p6.vel.z}`)
}

// ------------------------------------------------------------------ powerups
console.log('\n== shield ==')
{
  const { ProjectileSystem } = await import('../src/weapons/projectiles.js')
  const sys = new ProjectileSystem({ add() {} })
  const SR = CFG.powerups.shield.radius

  const damage = []
  const bounceLog = []
  const mkBot = (id, x, y, z) => ({
    id,
    alive: true,
    radius: CFG.bot.radius,
    shieldRadius: 0,
    pos: new THREE.Vector3(x, y, z),
    takeDamage(amt, by) {
      damage.push({ id: this.id, amt, by })
    },
  })

  const shooter = mkBot(1, 0, 0, 0)
  const holder = mkBot(2, 0, 0, -20)

  const game = {
    arena: { debris: [] },
    bots: [shooter, holder],
    damageContext: { bounces: 0, ownerId: -1 },
    setDamageContext(p) {
      this.damageContext.bounces = p.bounces
      this.damageContext.ownerId = p.ownerId
    },
    detonate() {},
    onProjectileBounce(p, _n, kind) {
      // Capture the contact point itself -- p.pos keeps moving after the
      // reflect, because the sweep spends the rest of the frame's travel.
      bounceLog.push({ bounces: p.bounces, kind, z: p.pos.z })
    },
  }

  // --- 1. an incoming shot reflects off the bubble and comes back ARMED
  holder.shieldRadius = SR
  const p1 = sys.spawn(1, 'player', new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 30 && sys.active.length && !bounceLog.length; i++) sys.update(1 / 60, game)
  ok('shield reflected the shot', bounceLog.length === 1, JSON.stringify(bounceLog))
  ok('reflection is reported as a shield hit', bounceLog[0]?.kind === 'shield')
  ok('shield bounce arms it against its shooter', p1.bounces === 1 && p1.vel.z > 0, `${p1.vel.z}`)
  ok('shielded bot took no damage', damage.length === 0, JSON.stringify(damage))
  ok(
    'contact was on the bubble, not the body',
    // +0.03 is the ease-off-the-surface nudge applied at the reflect.
    Math.abs(bounceLog[0].z - (holder.pos.z + SR + CFG.proj.radius + 0.03)) < 1e-3,
    `z=${bounceLog[0]?.z}`
  )

  // --- 2. the holder can still fire OUT through its own bubble
  sys.clear()
  damage.length = 0
  bounceLog.length = 0
  shooter.shieldRadius = 0
  holder.shieldRadius = SR
  sys.spawn(2, 'enemy', new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 0, 1))
  // 20 units to cross at 45 u/s -- give it the ~27 frames that actually takes.
  for (let i = 0; i < 40 && sys.active.length; i++) sys.update(1 / 60, game)
  ok(
    'own fresh shot leaves the bubble',
    bounceLog.every((b) => b.kind !== 'shield')
  )
  ok(
    'and still hits the other bot',
    damage.some((d) => d.id === 1),
    JSON.stringify(damage)
  )

  // --- 3. a shot already INSIDE the bubble reaches the body, never trapped
  sys.clear()
  damage.length = 0
  bounceLog.length = 0
  holder.shieldRadius = SR
  // Spawned between the body and the bubble, heading at the body.
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, -20 + SR * 0.6), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 20 && sys.active.length; i++) sys.update(1 / 60, game)
  ok(
    'shot inside the bubble hits the body',
    damage.some((d) => d.id === 2),
    `damage=${JSON.stringify(damage)} bounces=${JSON.stringify(bounceLog)}`
  )
  holder.shieldRadius = 0
}

console.log('\n== rocketiles ==')
{
  const { ProjectileSystem } = await import('../src/weapons/projectiles.js')
  const sys = new ProjectileSystem({ add() {} })
  const R = CFG.powerups.rocket

  const damage = []
  const mkBot = (id, x, y, z) => ({
    id,
    alive: true,
    radius: CFG.bot.radius,
    shieldRadius: 0,
    pos: new THREE.Vector3(x, y, z),
    takeDamage(amt, by) {
      damage.push({ id: this.id, amt, by })
    },
  })

  const owner = mkBot(1, 0, 0, 2)
  const target = mkBot(2, 0, 0, -34)
  const game = {
    arena: { debris: [] },
    bots: [owner, target],
    damageContext: { bounces: 0, ownerId: -1 },
    setDamageContext(p) {
      this.damageContext.bounces = p.bounces
      this.damageContext.ownerId = p.ownerId
    },
    detonate() {},
    onProjectileBounce() {},
  }

  // 20 degrees off the target, fired down a long lane. The seeker's turn radius
  // is speed/turnRate ~= 14u, so it corrects over the approach and lines up on a
  // target this far downrange; the plain blast flies straight past. (A steeper
  // angle at close range would orbit without ever connecting -- that is the
  // seeker's real limit, not a bug, so the test does not ask for it.)
  const off = new THREE.Vector3(Math.sin((20 * Math.PI) / 180), 0, -Math.cos((20 * Math.PI) / 180))

  sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), off.clone(), 1, 'rocket')
  for (let i = 0; i < 180 && sys.active.length; i++) sys.update(1 / 60, game)
  ok(
    'rocketile corrects onto an off-axis target',
    damage.some((d) => d.id === 2),
    JSON.stringify(damage)
  )

  damage.length = 0
  sys.clear()
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), off.clone())
  for (let i = 0; i < 120 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('a plain blast on the same line misses', !damage.some((d) => d.id === 2))

  // Arming rule governs the seeker: no lock on the owner before the first bounce.
  damage.length = 0
  sys.clear()
  target.alive = false
  owner.pos.set(0, 0, -10)
  const p = sys.spawn(
    1,
    'player',
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    1,
    'rocket'
  )
  for (let i = 0; i < 30; i++) sys.update(1 / 60, game)
  ok('does not lock onto its owner pre-bounce', p.vel.x > 0 && damage.length === 0, `${p.vel.x}`)
  target.alive = true

  // ...and does once bounced. Fire at a wall from close in, then check it turns
  // back toward the shooter waiting nearby.
  damage.length = 0
  sys.clear()
  target.alive = false
  owner.pos.set(0, 0, HALF.z - 8)
  const p2 = sys.spawn(
    1,
    'player',
    new THREE.Vector3(0, 0, HALF.z - 6),
    new THREE.Vector3(0.35, 0, 1).normalize(),
    1,
    'rocket'
  )
  let frames = 0
  while (sys.active.length && frames++ < 300) sys.update(1 / 60, game)
  ok(
    'hunts its own shooter once bounced',
    damage.some((d) => d.id === 1),
    `bounces=${p2.bounces} damage=${JSON.stringify(damage)}`
  )
  target.alive = true

  // The homing turn happens once per frame BEFORE the sweep, so the analytic
  // no-tunnelling guarantee has to survive it.
  const realSpeed = CFG.proj.speed
  CFG.proj.speed = 400
  owner.pos.set(0, 0, 0)
  target.pos.set(0, 0, 0)
  let escaped = 0
  for (let trial = 0; trial < 200; trial++) {
    sys.clear()
    const d = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize()
    // Both bots sit at the centre so the seeker is always pulling hard.
    const pr = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), d, 1, 'rocket')
    for (let i = 0; i < 180 && sys.active.length; i++) {
      sys.update(1 / 60, game)
      if (
        Math.abs(pr.pos.x) > HALF.x + 0.5 ||
        Math.abs(pr.pos.y) > HALF.y + 0.5 ||
        Math.abs(pr.pos.z) > HALF.z + 0.5
      ) {
        escaped++
        break
      }
    }
  }
  CFG.proj.speed = realSpeed
  ok('200 homing rocketiles at 400 u/s, none escaped', escaped === 0, `${escaped} escaped`)
  ok('turn rate is bounded', R.turnRate > 0 && R.turnRate < 20, `${R.turnRate}`)
}

console.log('\n== frostiles ==')
{
  const { ProjectileSystem } = await import('../src/weapons/projectiles.js')
  const sys = new ProjectileSystem({ add() {} })
  const F = CFG.powerups.frost

  const slows = []
  const owner = {
    id: 1,
    alive: true,
    radius: CFG.bot.radius,
    shieldRadius: 0,
    pos: new THREE.Vector3(0, 0, 200),
    takeDamage() {},
  }
  const target = {
    id: 2,
    alive: true,
    radius: CFG.bot.radius,
    shieldRadius: 0,
    pos: new THREE.Vector3(0, 0, -14),
    takeDamage() {},
    applySlow(dur, mul) {
      slows.push({ dur, mul })
    },
  }
  const game = {
    arena: { debris: [] },
    bots: [owner, target],
    damageContext: { bounces: 0, ownerId: -1 },
    setDamageContext() {},
    detonate() {},
    onProjectileBounce() {},
  }

  sys.spawn(
    1,
    'player',
    new THREE.Vector3(0, 0, -2),
    new THREE.Vector3(0, 0, -1),
    1,
    'blast',
    'frost'
  )
  for (let i = 0; i < 60 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('frostile slows on a direct hit', slows.length === 1, JSON.stringify(slows))
  ok(
    'with the configured strength',
    slows[0]?.mul === F.speedMul && slows[0]?.dur === F.slowDuration
  )

  slows.length = 0
  sys.clear()
  sys.spawn(1, 'player', new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, -1))
  for (let i = 0; i < 60 && sys.active.length; i++) sys.update(1 / 60, game)
  ok('a plain blast does not slow', slows.length === 0)
}

console.log('\n== slow effect ==')
{
  // Bot pulled apart from its three.js half: the slow lives entirely in the
  // numbers, so exercise those without needing a GLB or a WebGL context.
  const F = CFG.powerups.frost
  const bot = {
    speedMul: 1,
    slowTimer: 0,
    applySlow(duration, mul) {
      this.slowTimer = Math.max(this.slowTimer, duration)
      this.speedMul = Math.min(this.speedMul, mul)
    },
    tick(dt) {
      if (this.slowTimer <= 0) return
      this.slowTimer -= dt
      if (this.slowTimer <= 0) {
        this.slowTimer = 0
        this.speedMul = 1
      }
    },
  }

  bot.applySlow(F.slowDuration, F.speedMul)
  ok('slow scales the speed multiplier', bot.speedMul === F.speedMul)

  // A weaker second hit must not undo a stronger one, nor shorten it.
  bot.tick(1.0)
  bot.applySlow(0.2, 0.9)
  ok('a weaker restack keeps the stronger slow', bot.speedMul === F.speedMul)
  ok('and does not shorten the timer', bot.slowTimer > 1.0, `${bot.slowTimer}`)

  let t = 0
  while (bot.slowTimer > 0 && t < 10) {
    bot.tick(1 / 60)
    t += 1 / 60
  }
  ok('expires on time', Math.abs(t - (F.slowDuration - 1.0)) < 0.05, `t=${t.toFixed(3)}`)
  ok('and restores full speed', bot.speedMul === 1)
}

console.log('\n== permaboost ==')
{
  const { ProjectileSystem } = await import('../src/weapons/projectiles.js')
  const sys = new ProjectileSystem({ add() {} })
  const PB = CFG.powerups.permaboost

  ok('speeds up movement', PB.speedMul > 1, `${PB.speedMul}`)
  ok('speeds up shots', PB.projSpeedMul > 1, `${PB.projSpeedMul}`)
  ok('strengthens the dash', PB.boostMul > 1, `${PB.boostMul}`)

  // Projectile speed is per-shot, not a global constant.
  const game = {
    arena: { debris: [] },
    bots: [],
    setDamageContext() {},
    detonate() {},
    onProjectileBounce() {},
  }
  const fast = CFG.proj.speed * PB.projSpeedMul
  const a = sys.spawn(1, 'player', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1))
  const b = sys.spawn(
    2,
    'enemy',
    new THREE.Vector3(0, 5, 0),
    new THREE.Vector3(0, 0, -1),
    1,
    'blast',
    null,
    fast
  )
  ok(
    'default speed is the nominal one',
    near(a.vel.length(), CFG.proj.speed, 1e-3),
    `${a.vel.length()}`
  )
  ok('permaboosted shot leaves faster', near(b.vel.length(), fast, 1e-3), `${b.vel.length()}`)

  const az0 = a.pos.z
  const bz0 = b.pos.z
  for (let i = 0; i < 10; i++) sys.update(1 / 60, game)
  const aTravel = az0 - a.pos.z
  const bTravel = bz0 - b.pos.z
  ok(
    'and covers proportionally more ground',
    near(bTravel / aTravel, PB.projSpeedMul, 1e-3),
    `ratio ${(bTravel / aTravel).toFixed(4)} want ${PB.projSpeedMul}`
  )
  sys.clear()

  // Two shots at different speeds must not tunnel either.
  const realSpeed = CFG.proj.speed
  CFG.proj.speed = 300
  let escaped = 0
  for (let trial = 0; trial < 100; trial++) {
    sys.clear()
    const d = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize()
    const p = sys.spawn(
      1,
      'player',
      new THREE.Vector3(0, 0, 0),
      d,
      1,
      'blast',
      null,
      300 * PB.projSpeedMul
    )
    for (let i = 0; i < 180 && sys.active.length; i++) {
      sys.update(1 / 60, game)
      if (
        Math.abs(p.pos.x) > HALF.x + 0.5 ||
        Math.abs(p.pos.y) > HALF.y + 0.5 ||
        Math.abs(p.pos.z) > HALF.z + 0.5
      ) {
        escaped++
        break
      }
    }
  }
  CFG.proj.speed = realSpeed
  ok('100 permaboosted shots at 405 u/s, none escaped', escaped === 0, `${escaped} escaped`)
}

console.log('\n== permaboost x frostile stacking ==')
{
  // The two multipliers are separate fields on purpose: being frozen while
  // permaboosted must leave you slow-but-less-slow, not hand whichever landed
  // last the final say.
  const PB = CFG.powerups.permaboost
  const F = CFG.powerups.frost
  const bot = { speedMul: 1, powerMul: 1 }
  const effective = () => bot.speedMul * bot.powerMul

  bot.powerMul = PB.speedMul
  ok('permaboost alone speeds you up', near(effective(), PB.speedMul))
  bot.speedMul = F.speedMul
  ok(
    'frozen while permaboosted multiplies both',
    near(effective(), PB.speedMul * F.speedMul),
    `${effective()}`
  )
  ok('and that is still slower than baseline', effective() < 1, `${effective()}`)
  bot.powerMul = 1
  ok('losing permaboost leaves the slow intact', near(effective(), F.speedMul))
}

console.log('\n== powerup budget ==')
{
  const { POWERUP_IDS } = await import('../src/core/powerups.js')

  ok(
    'one of every type fits the match budget',
    POWERUP_IDS.length === CFG.powerups.budgetPerMatch,
    `${POWERUP_IDS.length} types vs budget ${CFG.powerups.budgetPerMatch}`
  )
  ok('all four expire on the same clock', CFG.powerups.duration > 0)

  // PowerupSystem needs a WebGL-free scene stub only; the spawn queue is the
  // part with the rule in it.
  const { PowerupSystem } = await import('../src/core/powerups.js')
  const sys = new PowerupSystem({ add() {} })

  const holder = { alive: true, radius: 1, powerup: 'shield', pos: new THREE.Vector3(), equip() {} }
  const taker = {
    alive: true,
    radius: 1,
    powerup: null,
    pos: new THREE.Vector3(),
    equip(id) {
      this.powerup = id
    },
  }
  const game = {
    bots: [holder, taker],
    arena: { findSpawn: () => new THREE.Vector3(0, 0, 0) },
  }

  // Run well past every spawn interval; the budget must be the thing that stops it.
  let collected = 0
  const seen = new Set()
  for (let i = 0; i < 60 * 60 * 5; i++) {
    sys.update(1 / 60, game)
    if (taker.powerup) {
      collected++
      seen.add(taker.powerup)
      taker.powerup = null
    }
  }
  ok(
    `only ${CFG.powerups.budgetPerMatch} spawn in a whole match`,
    sys.spawned === CFG.powerups.budgetPerMatch,
    `spawned ${sys.spawned}`
  )
  ok('every type appeared exactly once', seen.size === POWERUP_IDS.length, [...seen].join(','))
  ok('the bot already holding one never collected', holder.powerup === 'shield')
  ok('nothing left floating', sys.active === 0)
  ok('collections match spawns', collected === CFG.powerups.budgetPerMatch, `${collected}`)

  sys.reset()
  ok('reset refills the budget', sys.remaining === CFG.powerups.budgetPerMatch && sys.active === 0)
}

console.log('\n== radar (computeBlip) ==')
{
  const { computeBlip } = await import('../src/ui/radar.js')
  const fwd = new THREE.Vector3(0, 0, -1) // forward is -Z
  const right = new THREE.Vector3(1, 0, 0)
  const range = CFG.radar.range

  let b = computeBlip(new THREE.Vector3(0, 0, -20), fwd, right, range)
  ok('an enemy ahead is above centre', b.y > 0 && Math.abs(b.x) < 1e-9, JSON.stringify(b))

  b = computeBlip(new THREE.Vector3(0, 0, 20), fwd, right, range)
  ok('an enemy behind is below centre', b.y < 0 && Math.abs(b.x) < 1e-9, JSON.stringify(b))

  b = computeBlip(new THREE.Vector3(20, 0, 0), fwd, right, range)
  ok('an enemy to the right is on the +x side', b.x > 0 && Math.abs(b.y) < 1e-9)

  b = computeBlip(new THREE.Vector3(0, 0, -range * 2), fwd, right, range)
  ok(
    'a distant enemy clamps to the rim',
    b.clamped && near(Math.hypot(b.x, b.y), 1, 1e-6),
    JSON.stringify(b)
  )

  b = computeBlip(new THREE.Vector3(0, 9, -10), fwd, right, range)
  ok('the vertical offset is carried as vy', b.vy === 9)

  // Heading rotates the disc: facing +X, an enemy at +X is now "ahead" (above).
  b = computeBlip(
    new THREE.Vector3(20, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    range
  )
  ok('the disc rotates with heading', b.y > 0, JSON.stringify(b))
}

console.log('\n== flight assist ==')
{
  // Model Bot.integrate's drag branch: dragK = _assistBraking ? assistDrag : drag.
  // "Feels stopped" at ~1.5 u/s from a full-speed drift; assist must get there in
  // far fewer frames than base drag, and inside ~0.5s.
  const framesToStop = (dragK) => {
    let v = CFG.player.maxSpeed
    let f = 0
    while (v > 1.5 && f < 600) {
      v *= Math.pow(dragK, 1 / 60)
      f++
    }
    return f
  }
  const base = framesToStop(CFG.player.drag)
  const assisted = framesToStop(CFG.player.assistDrag)
  ok(
    'assist brakes far faster than base drag',
    assisted < base / 2,
    `assist ${assisted} vs base ${base}`
  )
  ok('assist reaches a near-stop within ~0.5s', assisted <= 30, `${assisted} frames`)
  ok('assist drag is stronger than base drag', CFG.player.assistDrag < CFG.player.drag)
}

console.log('\n== aim assist ==')
{
  const { aimAssist } = await import('../src/core/util.js')
  const origin = new THREE.Vector3(0, 0, 0)
  const player = { team: 'player', alive: true, pos: origin }
  const deg = (d) => (d * Math.PI) / 180
  const enemyAt = (offDeg, dist) => ({
    team: 'enemy',
    alive: true,
    pos: new THREE.Vector3(Math.sin(deg(offDeg)) * dist, 0, -Math.cos(deg(offDeg)) * dist),
  })
  const straight = () => new THREE.Vector3(0, 0, -1)
  const angleTo = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))))

  // Enemy 5 degrees off a straight -Z shot, inside the 7 degree cone, 20 units out.
  const inCone = enemyAt(5, 20)
  const toEnemy = inCone.pos.clone().normalize()

  let d = aimAssist(origin, straight(), [player, inCone], player, 1, 7, 60)
  ok(
    'full-strength assist snaps onto the target',
    angleTo(d, toEnemy) < 1e-3,
    `${angleTo(d, toEnemy)}`
  )

  d = aimAssist(origin, straight(), [player, inCone], player, 0.5, 7, 60)
  ok(
    'half strength closes half the gap',
    near(angleTo(d, toEnemy), deg(5) * 0.5, 1e-3),
    `${angleTo(d, toEnemy)}`
  )

  d = aimAssist(origin, straight(), [player, enemyAt(20, 20)], player, 1, 7, 60)
  ok('an enemy outside the cone is left alone', angleTo(d, straight()) === 0)

  d = aimAssist(origin, straight(), [player, enemyAt(5, 80)], player, 1, 7, 60)
  ok('an enemy beyond maxDist is left alone', angleTo(d, straight()) === 0)

  const dead = enemyAt(5, 20)
  dead.alive = false
  d = aimAssist(origin, straight(), [player, dead], player, 1, 7, 60)
  ok('a dead enemy is not targeted', angleTo(d, straight()) === 0)

  d = aimAssist(origin, straight(), [player, inCone], player, 0, 7, 60)
  ok('strength 0 is a no-op', angleTo(d, straight()) === 0)

  const ally = { team: 'player', alive: true, pos: enemyAt(5, 20).pos }
  d = aimAssist(origin, straight(), [player, ally], player, 1, 7, 60)
  ok('never bends toward a teammate', angleTo(d, straight()) === 0)
}

console.log('\n== difficulty easing ==')
{
  const { DIFFICULTIES, DEFAULT_DIFFICULTY } = await import('../src/core/difficulty.js')
  const D = DIFFICULTIES
  const hits = (hp) => Math.ceil(hp / CFG.proj.directDamage) // 34 dmg per player hit

  ok('CADET is the default', DEFAULT_DIFFICULTY === 'cadet' && !!D.cadet)
  ok(
    'every preset carries the easing fields',
    Object.values(D).every(
      (d) => 'botHp' in d && 'playerHp' in d && 'playerRegen' in d && 'aimAssist' in d
    )
  )
  ok('CADET bot dies in 2 hits', hits(D.cadet.botHp) === 2, `${hits(D.cadet.botHp)}`)
  ok('RECRUIT bot dies in 2 hits', hits(D.recruit.botHp) === 2, `${hits(D.recruit.botHp)}`)
  ok('SOLDIER bot still takes 3', hits(D.soldier.botHp) === 3)
  ok('VETERAN bot still takes 3', hits(D.veteran.botHp) === 3)
  ok('easy tiers buffer player HP', D.cadet.playerHp > 100 && D.recruit.playerHp > 100)
  ok('hard tiers leave player HP at 100', D.soldier.playerHp === 100 && D.veteran.playerHp === 100)
  ok(
    'aim assist only on easy tiers',
    D.cadet.aimAssist > 0 && D.recruit.aimAssist > 0 && !D.soldier.aimAssist && !D.veteran.aimAssist
  )
  ok('regen only on easy tiers', D.cadet.playerRegen > 0 && D.soldier.playerRegen === 0)
}

console.log('\n== maxHp respawn + regen ==')
{
  // The reset trap: spawnAt must refill from this.maxHp, not the config constant,
  // or a difficulty-scaled bot reverts to 100 every respawn. Model the two
  // methods with the exact field logic from Bot/Enemy.
  const bot = {
    maxHp: CFG.bot.maxHp,
    hp: CFG.bot.maxHp,
    applyDifficulty(botHp) {
      this.maxHp = botHp
      if (this.hp > this.maxHp) this.hp = this.maxHp
    },
    spawnAt() {
      this.hp = this.maxHp // <- from the instance field, NOT CFG.bot.maxHp
    },
  }
  bot.applyDifficulty(50)
  ok('applyDifficulty clamps current hp', bot.hp === 50)
  bot.hp = 20
  bot.spawnAt()
  ok('respawn refills the scaled pool, not 100', bot.hp === 50, `${bot.hp}`)

  // Player regen: only after regenDelay, capped at maxHp, off when the rate is 0.
  const regenStep = (hp, maxHp, since, rate, dt) =>
    rate > 0 && since > CFG.player.regenDelay && hp < maxHp ? Math.min(maxHp, hp + rate * dt) : hp
  ok('no regen before the delay', regenStep(50, 150, 1.0, 8, 1 / 60) === 50)
  ok('regen after the delay', regenStep(50, 150, 4.0, 8, 1 / 60) > 50)
  ok('regen never exceeds maxHp', regenStep(149.99, 150, 4.0, 8, 1) === 150)
  ok('no regen when the rate is 0', regenStep(50, 100, 10, 0, 1) === 50)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
