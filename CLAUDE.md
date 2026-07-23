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
```

Node 18+ (developed on 24.12). `?perf` or `F4` in-game opens stats-gl + lil-gui.

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

For perf work, watch `renderer.info.programs.length`. If it climbs during play,
something is recompiling shaders — that is the top suspect for any stutter here.
Note `renderer.info.autoReset` is `false` and reset manually each frame, because
EffectComposer runs several passes and the default counter would only report the
final blit.

## Asset licensing

The bot model is **CC-BY-4.0** by Aurantiko (Sketchfab). Attribution is shown on
the title and end screens and **must stay there**. Any new asset needs its
licence checked and recorded in the README credits.
