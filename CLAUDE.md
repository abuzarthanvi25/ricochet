# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

RICOCHET — a browser zero-g arena shooter built on one rule: **every projectile
bounces, and after its first bounce it will kill its own shooter.** three.js +
Vite, no game engine, no physics library. Collision is hand-written analytic
sweeps.

## Commands

```bash
npm run dev       # Vite dev server, localhost:5173
npm test          # headless rule checks — must stay green
npm run build     # production bundle
npm run check     # lint + format:check + test — run this before saying done
npm run lint:fix  # eslint --fix
npm run format    # prettier --write
```

Node 18+ (developed on 24.12). `?perf` or `F4` in-game opens stats-gl + lil-gui.
`F2` is powerup debug: `1`–`4` grant any powerup, `0` clears. Grants bypass the
4-per-match budget. It claims the digits, so the `F3` clip inspector is off while
it is on.

Formatting is Prettier's (no semicolons, single quotes, 100 cols); ESLint covers
correctness only, with every stylistic rule disabled by `eslint-config-prettier`.
Do not hand-format — run `npm run format`.

## Branching

`develop` is the integration branch. Branch from `develop` and target it with
PRs — never commit straight to `main` or `develop`, and never open a PR against
`main`. `main` only receives `release/*` and `hotfix/*` merges.

```bash
git checkout develop && git pull
git checkout -b feat/thing
gh pr create --base develop
```

Conventional-commit prefixes (`feat:` `fix:` `perf:` `docs:` `chore:`). Put
before/after numbers in the body for anything behavioural, and update
`CHANGELOG.md` under `[Unreleased]` for anything a player would notice.

## Architecture

`src/config.js` holds **every** gameplay constant. Never hardcode a tunable in a
module.

```
main.js        bootstrap, render loop, post-processing
core/
  game.js      match state, scoring, kill attribution, detonation
  collision.js analytic sweeps — sweepArena, raySphere, segmentClear
  assets.js    GLB load, clip retiming, per-bot model factory
  camera.js    chase rig, occlusion, crosshair aim ray
  arena.js     wall box + drifting debris
  difficulty.js presets + localStorage
  powerups.js  registry + the pickups floating in the arena
  mines.js     finite floating sea-mines (destructible hazards)
  settings.js  persisted options: flight/aim assist, sensitivity, shot speed
entities/      Bot (shared base) -> Player, Enemy
weapons/projectiles.js   stepping, bouncing, arming — the core mechanic
fx/            explosions, shared light pool, synthesised audio
ui/            hud, overlays, world-space nameplates
dev/perf.js    stats-gl + lil-gui, lazy-loaded chunk
```

## Invariants — do not break these

Each one has already caused a real bug in this repo.

**Never toggle `PointLight.visible`.** three.js bakes the visible light count
into its shader program cache key. Changing it recompiles every material in the
scene mid-frame — measured at 97–177ms freezes. `fx/lights.js` keeps a fixed set
permanently visible and parks unused ones at `intensity = 0`. The same applies to
adding/removing lights, or toggling `transparent`/`vertexColors`/defines at
runtime.

**The GLB's five clips share one timeline.** `Idle` 0.03–9.99s, `Shoot`
10.03–10.37s, `Move` 10.45–11.62s, `Hurt` 11.70–12.66s, `Death` 12.70–14.00s.
three.js derives `duration` from the max track time, so untouched `Shoot` holds
frame zero for 10s then plays 0.33s. `retimeClip()` in `core/assets.js` fixes it.

**Collision must stay analytic.** Exact per-axis solves for the arena box,
ray/sphere for everything else. Do not replace with per-frame position sampling —
projectiles move 45 u/s and would tunnel, which breaks the whole premise.
`npm test` fires 200 shots at 400 u/s to guard this.

**The arming rule is universal:**

```js
if (bot.id === p.ownerId && p.bounces === 0) continue
```

Ignores only the owner, only before the first bounce. Identical for player and
bots — that is why enemy ricochets kill other enemies. Do not special-case the
player. Difficulty scales enemy damage only; your own ricochet is always full
strength.

**Call `game.setDamageContext(p)` before `takeDamage`.** A lethal hit runs
`onBotKilled` synchronously and the kill feed reads the bounce count from there.

**Forward is −Z.** `Object3D.lookAt()` aims **+Z** for non-cameras — the
opposite. Use `orientToDirection()` from `core/util.js`. The model itself faces
+Z, hence `CFG.bot.yawOffset = Math.PI`.

**Bots clamp, projectiles bounce.** Bouncing the thing the player steers feels
like losing control; bots only get inward velocity cancelled.

**Rocketile homing runs once per frame, BEFORE the sweep — never inside it.**
That is the entire reason the analytic guarantee survives a guided projectile:
within any one frame the path is still a straight segment. `npm test` fires 200
homing rocketiles at 400 u/s with the seeker pulling hard and asserts none
escape. If you move the steering into the bounce loop, that test is what catches
it.

**The shield only reflects from outside.** `raySphere` returns the _exit_ point
when the origin is inside a sphere, so reflecting there on an outward normal
fires the shot back in and traps it forever. A projectile caught inside a bubble
must fall through to the body — `weapons/projectiles.js` guards this explicitly.

**Projectile speed lives on the projectile, not in `CFG.proj.speed`.** Permaboost
multiplies it, so `p.speed` is captured at spawn and used by both the sweep and
the homing steer. `Enemy._tryFire` must solve the intercept with `this.projSpeed()`
or a permaboosted bot over-leads every shot.

**Frostile slow and permaboost are separate multipliers** (`speedMul` and
`powerMul`) that multiply in `integrate()`. Collapsing them into one field means
whichever effect landed last silently cancels the other.

**Set `InstancedMesh.count` to what is actually live.** Parking dead instances
off-screen still submits them: the projectile pools were drawing 14,592
triangles of nothing every frame. `count` is a draw-call argument, not part of
the program key, so writing it per frame is free. Debris instances have
`frustumCulled = false` because three.js caches an `InstancedMesh` bounding
sphere on first cull and never recomputes it — the instances drift, so a stale
sphere makes them vanish.

**Additive + `toneMapped: false` feeds bloom directly.** Opacities that look
sane on paper blow out to solid white: the shield started at 0.1/0.45 and hid
the bot entirely. Shield and pickup materials sit at 0.03–0.28 for that reason.

**`maxHp` is a per-instance field, and `spawnAt` resets from it.** Difficulty
scales bot HP (`Enemy.applyDifficulty`) and the player has its own pool
(`Game.setDifficulty`). `Bot.spawnAt` sets `this.hp = this.maxHp`, never
`CFG.bot.maxHp` — the constant reset is the bug that silently reverts a scaled
bot to 100 on every respawn. HUD and nameplate fractions divide by `bot.maxHp`
too, not the constant.

**Aim assist bends only the initial fire direction, before spawn.** `aimAssist()`
in `core/util.js` runs in `Player.think` on a fresh shot's direction and nothing
else. It never touches a projectile mid-flight, so the analytic sweep and the
arming rule are untouched — a magnetised shot bounces and arms like any other.
Strength is `diff.aimAssist` gated by `game.aimAssistEnabled`; both are 0/off on
SOLDIER and VETERAN, which must stay bit-for-bit unchanged.

**Fog range is what darkens a bigger arena, not lighting.** Fog is applied after
lighting/emissive, so a wall past `fogFar` renders near-black however it is lit.
Relight a resized box by pushing `fogNear/fogFar`, the static ambient/key
_intensity_, wall `emissiveIntensity` and the point pool's `distance` — all
uniforms. Never raise `CFG.pools.lights` or add a light to brighten the room:
that changes the visible light count and recompiles every material (see above).

**Flight assist is a player-only drag swap.** `Bot.integrate` uses
`CFG.player.assistDrag` in place of `this.drag` when `this._assistBraking` is set,
and only `Player.think` ever sets that flag (no thrust held, no dash in flight).
Bots must keep their normal drag — their coasting drift is part of how they read.

**The radar is DOM/canvas, never three.js.** `ui/radar.js` draws to a 2D canvas,
so it adds zero shader-program surface. Keep it that way; a WebGL radar would be
new program-key surface on the hottest path. The blip projection is the pure
`computeBlip()` (unit-tested headless); the class only does the canvas drawing.

**Mines are analytic spheres in the projectile sweep.** `weapons/projectiles.js`
tests `game.mines.mines` with `raySphere` exactly like debris, so a fast shot
cannot tunnel one. A hit routes through `game.onProjectileHitMine`, which fires
the mine's blast (credited to the shot's owner) and consumes the shot — no
separate projectile detonation, or the damage double-counts. The mine blast is
**neutral and NOT difficulty-scaled** (`Game.detonateMine`), and it sets
`damageContext.source = 'mine'` so the kill feed reads MINE; `attackerId === -1`
means a contact kill scored for no one. All three mine materials are flat-shaded
Lambert, so they share the arena-debris program — mines add no new program key.

**Shot-vs-shot ricochet runs once per frame, AFTER the sweeps.**
`ProjectileSystem._resolveCollisions` compares each pair's swept segment
(`prevPos → pos`) by closest approach, so a crossing is caught even at full speed
without tunnelling. It deflects both velocities about the contact normal and
increments `bounces` on both — a mid-air collision arms both shots. It must stay
after the per-projectile sweeps: those keep the exact wall/debris/bot guarantee,
and this pass only reads their finished positions. `prevPos` is snapshotted at
the top of `update()` before anything moves.

**Projectile speed has a global multiplier in `core/settings.js`.** `Bot.projSpeed`
multiplies `CFG.proj.speed` by `getProjSpeedMul()`, so the options slider scales
spawned shots AND the enemy lead-aim solver together — never scale one without
the other, or bots mislead every shot.

## Conventions

- Frame-rate independent: `Math.pow(k, dt)` for damping, `1 - Math.exp(-rate*dt)`
  for easing. Never `v *= 0.92` per frame.
- No allocation in per-frame paths — use module-scope scratch vectors.
- Pool anything spawned in bulk (projectiles, explosions, lights) with O(1) free
  lists.
- Comments explain **why**, not what: the three.js quirk, the reason a number is
  that number, the bug a line prevents.

## Testing

`test/mechanics.mjs` runs headless under plain Node — no browser. Mock `scene` as
`{ add() {} }` and `game` as a plain object; follow the existing projectile
section. Add cases for anything rule-shaped.

Rendering and feel are verified by playing. No snapshot suite.

## Driving the game from a browser session

`window.RICOCHET` exposes `{ game, scene, camera, renderer, composer, THREE, CFG,
STATE, hud, overlays }` (plus `perf`, `stressTest` once perf is loaded).

Two traps that will waste your time:

- **`requestAnimationFrame` is suspended in a backgrounded tab.** `game.time`
  will not advance and nothing renders. Drive it manually instead:
  `for (let i=0;i<N;i++) game.update(1/60)`, then `composer.render()`. This is
  also more deterministic for measurement.
- **Monkeypatches survive `game.reset()`.** Setting `e.canFire = () => false` on
  an enemy creates an own-property that `reset()` does not clear. Reload the page
  between scenarios, or results will silently be wrong.

**GPU timing in a driven tab is noisy.** Wall-clock drifts several ms between
runs, and `performance.now()` around `composer.render()` measures CPU submission,
not GPU work. Use `EXT_disjoint_timer_query_webgl2`, issue the queries in one
`evaluate` call and read them in the next (they need an event-loop turn to
retire), and **interleave A/B frame-by-frame** so drift hits both arms equally.
Absolute cross-run comparisons are not trustworthy here; interleaved deltas are.

For perf work, watch `renderer.info.programs.length`. If it climbs during play,
something is recompiling shaders — that is the top suspect for any stutter here.
Note `renderer.info.autoReset` is `false` and reset manually each frame, because
EffectComposer runs several passes and the default counter would only report the
final blit.

## Asset licensing

The bot model is **CC-BY-4.0** by Aurantiko (Sketchfab). Attribution is shown on
the title and end screens and **must stay there**. Any new asset needs its
licence checked and recorded in the README credits.
