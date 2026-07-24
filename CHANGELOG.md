# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

A newcomer-experience pass — softening the landing for a first-time player who
found the game too punishing even on the old easiest tier — plus a set of new
combat mechanics: floating mines, shots that ricochet off each other, and a
projectile-speed option.

### Added

- **Floating mines** — a fixed number of spiked sea-mines are placed at match
  start and stay put; they do not respawn. Touch one, or hit one with any shot,
  and it detonates for heavy damage across a wide radius — enough to bait a bot
  into. A mine you set off with your own shot is **credited to you**; a bot that
  flies into one dies environmental, scored for no one. Neutral and **not**
  difficulty-scaled — a hazard is a hazard. Shots test them as analytic spheres,
  so a fast shot cannot tunnel through one.
- **Shots ricochet off each other.** Two projectiles that cross in mid-air
  deflect, and each crossing counts as a bounce — so **both arm** against their
  own shooters. Deliberately knocking a shot off course (or banking one back into
  yourself) becomes a real tactic. Detection is a swept closest-approach over each
  frame, so a crossing is caught even at full speed and never tunnels; it runs
  after the wall/debris/bot sweeps, so it cannot disturb their exact guarantee.
- **Projectile-speed slider** in the options — scales every shot from 0.6× to
  1.6×, persisted. It flows through the same value the enemy lead-aim solver
  reads, so faster shots are still led correctly.

- **CADET difficulty** — a new easiest tier below RECRUIT, and the default. One
  bot fires at a time, with a wide aim cone, slow cadence and low damage.
- **The easy tiers now ease more than enemy output.** CADET and RECRUIT make bots
  **less tanky** (two clean hits instead of three), give **you a larger HP pool
  that regenerates** after a few seconds without being hit, and turn on **aim
  assist**. SOLDIER and VETERAN are deliberately untouched — bot HP 100, your HP
  100, no regen, no aim help — so they play exactly as before.
- **Aim assist (bullet magnetism)** — a fresh player shot bends toward the enemy
  nearest your crosshair, within a narrow cone, by a strength that comes from the
  difficulty. It nudges only the initial direction before the shot spawns, so the
  ricochet arming rule and the analytic no-tunnelling guarantee are untouched — a
  magnetised shot still bounces and can still come back to kill you. There is a
  global on/off toggle independent of difficulty.
- **Flight assist (`X`, on by default)** — auto-brakes the instant you release
  thrust, so the ship settles to a near-stop in about half a second instead of
  drifting on. Toggleable so veterans keep the full Newtonian coast; the HUD
  flashes the new state when you press `X`.
- **Radar disc** (bottom-right) — you at the centre, red blips for the bots,
  screen-up is your heading, so an enemy behind you reads as a blip below centre,
  with a short stalk for above/below. Drawn to a 2D canvas, not three.js, so it
  adds no shader-program surface. Answers the "where did that shot come from"
  problem that 6-DOF makes acute.
- **Options on the title screen and pause menu** — flight-assist and aim-assist
  toggles plus mouse-sensitivity and shot-speed sliders, built once and injected
  into both screens (the same shared-builder pattern as the sound toggle), and
  persisted to `localStorage`.

### Changed

- **The arena is ~1.4× larger** — 84 × 52 × 84, up from 60 × 40 × 60 — for more
  room to fly. Fog range, ambient/key light intensity, wall emissive and the
  point-light pool's reach all scale with it, because **fog, not lighting, is
  what darkened a bigger box**: fog is applied after lighting, so a wall past
  `fogFar` renders near-black however it is lit. None of this changes the visible
  light **count**, so no shaders recompile. Debris count and nameplate range grew
  to match; base movement speed is up slightly so travel isn't tedious.
- **Boost is `Q` only.** It used to double up on the right mouse button, which
  dashed newcomers into a wall on the natural "aim" reflex; RMB is now unbound.

## [0.2.0] — 2026-07-24

### Added

- **Powerups** — four of them, and **only four spawn in an entire match**. One of
  each type, in a shuffled order, first at 12s then every 22s. Everybody
  contests them: the player and all four bots. One slot each, no swapping — you
  fly straight through a pickup while you are already holding something.
  Everything expires on the same 8s clock, shown as a circular glyph with a
  draining progress ring that pulses over the last two seconds.
  - **SHIELD** — a bubble at 2.4 units. Shots reflect off it instead of hitting
    you, and a reflection is a bounce in every sense, so the shot comes off
    **armed against whoever fired it**. It is a convex mirror, not a retro
    reflector: an off-centre hit scatters, so the shield reliably saves you but
    only sometimes kills the shooter. You can still fire out through your own
    bubble — the arming rule gates the shield exactly as it gates damage.
  - **PERMABOOST** — a whole-loadout buff, not just a cooldown removal: **1.45×**
    thrust and top speed, **1.35×** projectile speed, **1.5×** dash impulse, and
    no dash cooldown. Holds an 82° FOV for its duration so the speed reads on
    screen. Still edge-triggered, so holding `Q` does not chain-dash. Bots get
    the equivalent: their evade has no cooldown, so they break away from every
    incoming shot instead of one every ~0.9s.
    - Projectile speed became per-shot rather than a global constant. The enemy
      lead-aim solver reads the firing bot's own muzzle velocity, or a
      permaboosted bot would consistently over-lead its target.
  - **FROSTILES** — direct hits drop the target to 0.4× thrust and speed for
    2.5s and tint it frost-blue. Your own returning ricochet freezes you too.
    - Taking one puts a blue rime around the screen edge that thaws as you
      recover, a `SYSTEMS FROZEN` readout above the crosshair, a brittle
      descending cue and a short camera shake. Blue and edge-weighted on purpose
      — the red damage vignette owns the same screen area and the two must never
      be mistaken for one another.
    - The slow is a separate multiplier from permaboost's, so the two stack:
      frozen while permaboosted leaves you at 1.45 × 0.4 = 0.58×, slow but not
      helpless. Neither effect can cancel the other by landing last.
  - **ROCKETILES** — magenta cones that fly straight for 0.35s, then hunt the
    nearest entity within 22 units at 3.2 rad/s. Target selection runs the same
    arming predicate as damage, so a bounced rocketile will come around and hunt
    the player who fired it.
  - Bots break off to contest a pickup within 22 units (`AI.COLLECT`), and their
    nameplate shows what they are holding. A bot's powerup is lost on death.
- **Controls are now on the pause menu too**, and the title screen carries a
  powerup legend. Both are built once in `ui/overlays.js` and injected into every
  screen that asks for them (`[data-controls-group]` / `[data-powerup-group]`),
  following the existing difficulty-selector pattern — two copies of the key
  legend in the HTML is how they end up disagreeing after a rebind. The legend
  reads its rows straight off the `POWERUPS` registry, so it cannot go stale.
  `Esc` is now listed as well; it was never documented in-game.
  - The fuller title screen stacked to ~800px, which pushed CLICK TO ENGAGE
    below the fold on a 768p laptop. A `max-height: 860px` media query compacts
    it to 642px; `.screen` also gained `max-height: 100vh; overflow-y: auto` as a
    backstop for anything shorter still.
- **Sound toggle** on the title screen and the pause menu, plus `M` in-game.
  Persists to `localStorage`. Muting zeroes the master gain _and_ short-circuits
  voice construction, so a muted fight stops allocating oscillator, gain and
  filter nodes entirely rather than building and silencing them.
- **Powerup debug mode (`F2`)** — grants any powerup on `1`–`4`, clears on `0`,
  so a powerup can be tested without waiting for one of the four a match gets.
  Grants bypass the match budget entirely and re-pressing a key refreshes the
  timer. It claims the digit keys while active, so the `F3` clip inspector is
  unavailable until it is switched back off — which also drops what you held.
- **Difficulty presets** — RECRUIT / SOLDIER / VETERAN, selectable from both the
  title screen and the pause menu. Applied live without restarting a match and
  persisted to `localStorage`. Default is SOLDIER.
  - The main lever is how many bots may fire simultaneously (2 / 3 / 4) rather
    than their accuracy — four bots focus-firing one target was what made
    fights unsurvivable. Bots holding fire still fly and reposition.
  - Each tier also scales fire rate, aim cone, movement speed, damage
    (0.55 / 0.8 / 1.0) and adds a reaction delay before a bot that has just
    spotted you opens fire.
- **Enemy nameplates** — name and health bar floating above each bot, drawn as
  DOM so text stays crisp and costs no draw calls. Bar runs red → amber → white
  as health drops; both shrink and fade with distance. Hidden when the bot is
  dead, behind the camera, past 55 units, or occluded by debris.
- **Performance overlay** — stats-gl (FPS / CPU ms / GPU ms) plus a lil-gui
  panel with live counters and stress-test buttons, behind `?perf` or `F4`.
  Loaded as a lazy chunk so it stays out of the main bundle.
  - `shader programs` is on the panel deliberately: if it climbs during play,
    something is recompiling.

- **ESLint 9 flat config and Prettier**, wired to match the existing style (no
  semicolons, single quotes, 100 columns) so adopting them was a formatting pass
  rather than a rewrite. `eslint-config-prettier` disables every stylistic rule
  so the two never disagree. New scripts: `lint`, `lint:fix`, `format`,
  `format:check`, and `check` (all three at once).

### Fixed

- Dead code surfaced by the first lint run: an unused `pick` import, an unused
  `WORLD_UP` constant, a dead `dist` assignment in `resolveSphere`, an unused
  `orient(dt)` parameter, and four unused bindings in the test file.
- **Mid-fight stutter** caused by shader recompilation, not by load. `LightPool`
  toggled `PointLight.visible` as projectiles came and went; three.js bakes the
  visible light count into its program cache key, so every material in the scene
  recompiled on the frame that count changed.
  - Measured by cycling live projectile count 0 → 8 → 0:
    `programs 43→47, render 177.0ms` and `programs 47→51, render 97.1ms`.
  - Each distinct light count only stalled the first time it occurred, which is
    why the hitching felt random and eased the longer you played.
  - Lights are now created visible and never toggled; unused ones park at
    `intensity 0` outside the arena. Pool trimmed 6 → 4.
  - Materials are additionally warmed with `compileAsync()` behind the title
    screen, so nothing compiles during a fight.
- Enemy count was left at `1` in config from earlier debugging; restored to `4`.
- Nameplates were offset 48px left of their bots — `margin-left` and
  `translate(-50%)` were both centring them.

### Changed

- **Projectiles render in two draw calls** instead of roughly two _per
  projectile_ — one `InstancedMesh` for the heads, one `LineSegments` holding
  every trail.
  - Note: three's `color_fragment` chunk only applies `vColor` under
    `USE_COLOR`, so `instanceColor` alone never reaches the fragment shader. The
    head geometry carries an all-white colour attribute with `vertexColors`
    enabled to open that path.
- Projectile pool uses an O(1) free list rather than a linear scan per shot, and
  trails upload only the range actually written.
- Synthesised audio voices are capped per 60ms window; a busy fight was building
  oscillator and gain nodes for dozens of bounces per second.
- Removed two per-frame allocations — the enemy line-of-sight `bots.filter(...)`
  and the explosion light-collection closure.
- Camera pulled back from 4.6 to 6.2 units for better visibility.

### Performance — second pass

The first pass fixed CPU-side stalls. This one profiled the GPU with
`EXT_disjoint_timer_query_webgl2` and found the frame was **entirely GPU-bound**:
game logic totalled 0.82ms/frame against ~7ms of GPU time, so nothing in
`update()` was worth touching.

Wall-clock GPU numbers drift several ms between runs on this machine, so every
change below was measured by **interleaving A and B frame-by-frame inside one
run** — drift then hits both arms equally. Medians and means agree to ~0.01ms.

| Change                                  | GPU delta   |
| --------------------------------------- | ----------- |
| Bloom at half internal resolution       | **−6.34ms** |
| Arena + debris `MeshStandard`→`Lambert` | **−2.21ms** |
| Projectile instance compaction          | **−0.84ms** |
| Debris instancing (25 draws → 7)        | −0.36ms     |

- **Instanced pools were drawing at full size every frame.** `InstancedMesh.count`
  stayed at the pool capacity and dead slots were parked off-screen, so 96 heads
  and 96 cones — 14,592 triangles — were submitted with zero projectiles in the
  air. That was **74% of the scene's entire triangle count** while idle. Live
  projectiles now pack into contiguous instance slots and `count` is set to how
  many exist. `count` is a draw-call argument, not part of the program key, so
  changing it per frame cannot trigger a recompile.
  - Idle triangles **19,766 → 5,054**.
  - The render slot is deliberately no longer the pool slot, so instance colour
    moved from `_applyHeat` into the per-frame write.
- **Bloom ran at full canvas resolution** — five separable blur mips over a
  full-screen buffer, the single most expensive item in the frame. Its output is
  blurred by definition, so half-res is visually near-free.
- **The walls are the most overdrawn surface in the game** — a `BackSide` box the
  camera sits inside, covering essentially every pixel. At roughness 0.85 /
  metalness 0.15 the PBR BRDF bought almost nothing over plain diffuse. They
  still light up from passing projectiles.
- **Debris are one `InstancedMesh` per shape** instead of 25 separate meshes.
  They already shared one material, so the split bought nothing but draw calls.
  Frustum culling is disabled on them deliberately: three.js caches an
  `InstancedMesh` bounding sphere on first cull and never recomputes it, and
  these instances drift every frame — a stale sphere would pop debris out of
  existence.

**Rejected:** converting the bot material to Lambert measured only −0.45ms. The
bots' cost is vertex/skinning, not shading, and that is not worth changing how
the hero asset looks.

Recompiles across idle → 60 projectiles → 90 rocketiles → idle: **0**.

---

### Performance — first pass

Held load, update and render timed separately:

| Metric                              | Before | After            |
| ----------------------------------- | ------ | ---------------- |
| Worst frame on a light-count change | 177ms  | 6.5ms            |
| 45 live projectiles, frame p50      | 12.5ms | 7.2ms (~139 fps) |
| 90 live projectiles, frame p50      | —      | 7.9ms (~127 fps) |
| Draw calls @ 45 projectiles         | 179    | 79               |
| Draw calls @ 90 projectiles         | —      | 73 (flat)        |
| Shader recompiles per match         | —      | 0                |

Gameplay verified unchanged: full-match soaks land at 15–10 stationary and 15–2
dodging on SOLDIER, with no projectile escapes, no NaN, and exact pool
accounting.

Powerups added no measurable cost. Same 15s soak with a shot fired every frame,
budget 4 vs budget 0: frame p50 9.9ms vs 9.4ms, p99 27.0ms vs 27.9ms — inside
run-to-run noise. **Shader recompiles across a 200s match with every powerup in
play: 0** (programs held at 29). Two new constant draw calls: one `InstancedMesh`
for rocketile cones, and up to one per visible pickup.

`powerups.seekRadius` was tuned by measurement, not feel. Over 4-minute matches
against a player beelining for every pickup with perfect knowledge:

| `seekRadius` | pickups the player won |
| ------------ | ---------------------- |
| 30           | 5 / 16                 |
| 22           | 12 / 16                |
| 14           | 13 / 16                |
| 10           | 16 / 16                |

At 30 the bots took nearly everything even against a perfect player, and an
ordinary player who has to _spot_ a pickup first got none at all. Shipped at 22,
which also sits exactly on `arena.findSpawn`'s 22-unit bot clearance — a pickup
always lands just outside the nearest bot's awareness, so somebody has to commit.

---

## [0.1.0] — 2026-07-23

Initial playable build.

### Added

- **Core mechanic** — every projectile bounces off walls and debris, and arms
  against its own shooter after the first bounce. Wall-spam in an enclosed space
  kills you; bank shots around cover are the skill.
  - 45 u/s, 3s fuse, no speed loss on bounce so timing stays predictable.
  - Colour cuts cyan → orange on the first bounce then ramps to yellow; bounce
    SFX pitch climbs with the count. You often hear a ricochet before you see it.
  - The arming rule is universal — enemy ricochets kill other enemies too.
- **Zero-g flight** — camera-relative WASD with momentum, world-axis
  ascend/descend so "up" never rotates out from under you, and a boost dash on
  `Q` / right mouse.
  - Boost is not `Ctrl`: Chrome's `Ctrl+W` fires through pointer lock and would
    close the tab while thrusting forward.
- **Third-person chase camera** with spring damping, occlusion pull-in, FOV kick
  on boost, and a crosshair ray so muzzle-fired shots converge on the reticle.
- **Enemy AI** — patrol / engage / evade with intercept-solved lead aim,
  obstacle and wall avoidance, and projectile dodging.
- **Deathmatch to 15** against 4 respawning bots. Killing yourself with your own
  ricochet costs a point; bots killing each other scores for nobody but appears
  in the kill feed.
- **Arena** — 60 × 40 × 60 box with 25 slow-drifting indestructible debris that
  block movement and reflect shots.
- **HUD** — crosshair with cooldown ring, integrity and boost bars, scoreboard,
  hit markers, damage vignette, kill feed, and an `INCOMING RICOCHET` warning.
- **Synthesised audio** — no asset files; oscillator-based fire, bounce,
  explosion, hurt, death and kill cues.
- **Post-processing** — ACES tone mapping and bloom, which the model's emissive
  map and the projectile trails both feed.
- **Headless test suite** (`npm test`) covering the analytic sweeps, clip
  retiming and the arming rule, including a 200-shot no-tunnelling check at
  400 u/s.

### Notes

Three asset quirks handled at load, documented in `core/assets.js`:

- The GLB's five clips are baked onto one shared timeline (`Shoot` lives at
  10.03–10.37s), so three.js derives a 10.4s duration and plays a dead hold
  before any motion. Every clip is retimed to its own start.
- The model faces **+Z** while three.js treats **−Z** as forward, hence the
  `Math.PI` yaw offset.
- The GLB origin sits below the floating body, so each instance is re-centred.

Model: **Shooter Bot** by Aurantiko, CC-BY-4.0, via Sketchfab.

[Unreleased]: https://github.com/abuzarthanvi25/ricochet/compare/v0.2.0...develop
[0.2.0]: https://github.com/abuzarthanvi25/ricochet/releases/tag/v0.2.0
[0.1.0]: https://github.com/abuzarthanvi25/ricochet/releases/tag/v0.1.0
