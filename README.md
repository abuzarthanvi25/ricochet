# RICOCHET

A zero-gravity arena shooter for the browser, built on one rule:

> **Every projectile bounces. After its first bounce, your own shot will kill you.**

Wall-spam in an enclosed box is suicide. Deliberate bank shots around cover are
the skill. The six-direction flight exists to serve that — you need it to dodge
the shot you fired ten seconds ago.

Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/). No
game engine, no physics library — collision is ~150 lines of analytic sweeps.

---

## Running it

Requires **Node 18+** (developed on 24.12).

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script            | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR                           |
| `npm run build`   | Production bundle into `dist/`                     |
| `npm run preview` | Serve the built bundle                             |
| `npm test`        | Headless checks for the collision and arming rules |

---

## Controls

| Input              | Action                                                            |
| ------------------ | ----------------------------------------------------------------- |
| `W` `A` `S` `D`    | Thrust, relative to where you're looking                          |
| `Space`            | Ascend (**world** up, always)                                     |
| `Shift`            | Descend (**world** down, always)                                  |
| `Q` or right mouse | Boost dash — 1.2s cooldown                                        |
| Mouse              | Aim                                                               |
| Left mouse         | Fire                                                              |
| `Esc`              | Release the pointer (pauses)                                      |
| `F2`               | Powerup debug — with it on, `1`–`4` grant any powerup, `0` clears |
| `F3`               | Debug overlay — with it on, `1`–`5` play each animation clip solo |
| `F4`               | Performance overlay (also via `?perf` in the URL)                 |

`F2` exists to test a powerup without waiting for one of the four a match gets.
Grants do not consume the match budget and re-pressing a key refreshes the timer,
so you can sit on one for as long as you need. It claims the digit keys while
active, so the `F3` clip inspector is unavailable until you switch it back off —
which also drops whatever you were holding.

The key legend appears on both the title screen and the pause menu, and the
powerup legend on the title screen. Both are built once in `ui/overlays.js` and
injected into every screen that asks for them, so they cannot drift apart.

Ascend/descend stay locked to world axes on purpose. That single decision is
what keeps 6-DOF flight readable instead of nauseating — "up" never rotates out
from under you, no matter where the camera is pointing.

Boost is `Q`/RMB rather than `Ctrl`, because Chrome's `Ctrl+W` fires straight
through pointer lock. Holding boost while thrusting forward would close the tab.

---

## The mechanic

A shot travels at **45 u/s**, lives **3 seconds**, and loses **no speed** when it
bounces — so bank-shot timing stays predictable.

The arming rule is universal and applies to every bot equally:

- `bounces === 0` — ignores **only** its owner.
- `bounces >= 1` — live against **everyone**, the shooter included.

So enemy ricochets kill other enemies, and yours kill you. Two cues tell you
when a shot has turned on you:

- **Colour** jumps cyan → orange on the first bounce, then ramps to yellow. The
  0→1 transition is a hard cut, not a gradient, because it marks a state change.
- **Bounce pitch** climbs with each impact. You often hear a ricochet returning
  before you see it.

An `INCOMING RICOCHET` warning fires when a bounced shot is bearing down on you.

Detonation — on impact or at the 3s fuse — does **34** direct damage and a
**30**-damage blast within 4 units, with falloff and knockback. Difficulty scales
enemy damage only; your own ricochet always comes back at full strength.

---

## Match rules

Deathmatch to **15** against **4** bots that respawn 3s after death.

| Event                       | Score                                    |
| --------------------------- | ---------------------------------------- |
| You kill a bot              | You +1                                   |
| A bot kills you             | Bots +1                                  |
| Your own ricochet kills you | You −1 (floor 0)                         |
| A bot kills another bot     | No score — but it shows in the kill feed |

## Powerups

**Four spawn in an entire match.** Not four at a time — four, total, one of each
type in a shuffled order. Everyone contests them: you and all four bots. One
slot each and no swapping, so while you are holding something you fly straight
through pickups and leave them for somebody else. Everything expires on the same
8-second clock, shown bottom-left as a glyph inside a draining ring.

| Powerup        | Effect                                                    | What the ricochet rule does to it                                                     |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **SHIELD**     | 2.4-unit bubble; shots reflect off you instead of hitting | A reflection is a bounce — the shot comes off **armed against the bot that fired it** |
| **PERMABOOST** | Everything speeds up — see below                          | Bots get the same deal: their evade stops having a cooldown                           |
| **FROSTILES**  | Direct hits drop the target to 0.4× speed for 2.5s        | Your own returning ricochet freezes **you**                                           |
| **ROCKETILES** | Magenta cones that hunt the nearest bot within 22 units   | Once bounced, the nearest bot might be you                                            |

**Permaboost is a whole-loadout buff**, not just a cooldown removal:

|                      | Multiplier |
| -------------------- | ---------- |
| Thrust and top speed | **1.45×**  |
| Projectile speed     | **1.35×**  |
| Dash impulse         | **1.5×**   |
| Dash cooldown        | removed    |

It also holds the camera at 82° FOV for its duration, so the speed reads on
screen rather than only in the numbers. Faster shots mean less lead to give and
less time for a bot to dodge — but they also come back off the wall sooner.

The **frostile** slow is a separate multiplier from permaboost's, so the two
stack: frozen while permaboosted leaves you at 1.45 × 0.4 = **0.58×**, slow but
not helpless. Taking a frostile puts a blue rime around the screen edge and a
`SYSTEMS FROZEN` readout above the crosshair — deliberately blue and
edge-weighted so it is never confused with the red damage vignette.

The shield is a convex mirror, not a retro-reflector — an off-centre hit
scatters. It saves you reliably; it kills the shooter only when they hit you
square on.

Bots break off to grab a pickup within 22 units and their nameplate shows what
they are carrying. Die and you drop it.

## Difficulty

Selectable from the title screen **and** the pause menu, applied live without a
restart, saved to `localStorage`. Default is **SOLDIER**.

|                     | RECRUIT | SOLDIER | VETERAN |
| ------------------- | ------- | ------- | ------- |
| Bots firing at once | 2       | 3       | 4       |
| Fire cooldown       | 2.4s    | 1.9s    | 1.5s    |
| Aim cone            | 11°     | 8°      | 5.5°    |
| Damage scale        | 0.55    | 0.8     | 1.0     |

The dominant lever is **how many bots may fire at once**, not their accuracy.
Four bots focus-firing one target is what makes a fight unsurvivable; capping it
keeps every bot mobile and alive-looking while the fight stays winnable. The
ones holding fire still fly and reposition.

Measured across full matches with a scripted player:

| Player behaviour | RECRUIT  | SOLDIER   | VETERAN       |
| ---------------- | -------- | --------- | ------------- |
| Never moves      | won 15–5 | won 15–10 | **lost 5–15** |
| Dodges           | won 15–1 | won 15–2  | won 15–3      |

Movement is the whole game. A stationary player loses on VETERAN; the same
player dodging wins on all three.

---

## Layout

```
src/
  main.js          bootstrap, render loop, post-processing
  config.js        every gameplay constant lives here
  core/
    game.js        match state, scoring, kill attribution
    arena.js       wall box + drifting debris
    collision.js   analytic sweeps (arena, ray/sphere, resolution)
    camera.js      third-person rig, occlusion, aim ray
    assets.js      GLB load, clip retiming, per-bot model factory
    difficulty.js  presets and persistence
    powerups.js    registry + the pickups floating in the arena
    input.js       pointer lock, keys, mouse deltas
    util.js        math helpers
  entities/        Bot (shared) -> Player, Enemy
  weapons/         projectiles.js — stepping, bouncing, arming, homing
  fx/              explosions, shared light pool, synthesised audio
  ui/              hud, overlays, world-space nameplates
  dev/perf.js      stats-gl + lil-gui, lazy-loaded
test/mechanics.mjs headless rule checks
```

`src/config.js` holds every tunable number. Changing the feel should never mean
hunting through modules.

---

## Notes worth knowing before you touch the code

**The GLB's clips share one timeline.** All five animations are baked onto a
single track — `Idle` at 0.03–9.99s, `Shoot` at 10.03–10.37s, and so on.
three.js derives `clip.duration` from the largest track time, so playing `Shoot`
untouched holds frame zero for ten seconds and then plays 0.33s of motion.
`retimeClip()` in `core/assets.js` shifts each clip back to its own start.

**The model faces +Z**, while three.js treats −Z as forward, hence
`CFG.bot.yawOffset = Math.PI`. The GLB origin also sits _below_ the floating
body, so each instance is re-centred at load.

**Collision is fully analytic** — exact per-axis solves against the arena box,
ray/sphere for debris and bots. There is no substepping, so projectile speed
cannot cause tunnelling. `npm test` fires 200 shots at 400 u/s to prove it.

**Rocketile homing steers once per frame, before the sweep.** That is what lets
a guided projectile keep the analytic guarantee: within any single frame its
path is still a straight segment. Move the steering into the bounce loop and it
will tunnel — `npm test` fires 200 homing rocketiles at 400 u/s for exactly this
reason.

**Bots clamp, projectiles bounce.** Bouncing the thing you are steering feels
like losing control, so bots only have their inward velocity cancelled.

**Never toggle `PointLight.visible`.** three.js bakes the visible light count
into its shader program cache key; changing it recompiles every material
mid-frame. See `fx/lights.js` — this caused 177ms freezes before it was fixed.

---

## Performance

Press `F4` (or load `?perf`) for stats-gl (FPS / CPU ms / GPU ms) and a lil-gui
panel with live counters and stress-test buttons. The tooling is a lazy chunk,
so it stays out of the main bundle.

`shader programs` is on that panel deliberately. **If that number climbs while
you play, something is recompiling** — that is the single most likely cause of
stutter in this scene.

Current numbers under held load, update and render timed separately:

|                     |                                          |
| ------------------- | ---------------------------------------- |
| 45 live projectiles | 7.2ms/frame (~139 fps)                   |
| 90 live projectiles | 7.9ms/frame (~127 fps)                   |
| Draw calls          | ~75, flat regardless of projectile count |

All projectiles render in two draw calls — one `InstancedMesh` for the heads,
one `LineSegments` for every trail.

---

## Credits

Model: [**Shooter Bot** by Aurantiko](https://sketchfab.com/3d-models/shooter-bot-7fa3447a3a3147d9a69049aec48d8f88),
licensed **CC-BY-4.0**. Attribution is required and is shown on the title and
end screens — please keep it there.

Code is otherwise the project author's.
