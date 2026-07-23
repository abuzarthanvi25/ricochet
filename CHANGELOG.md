# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Currently on the `perf/optimization` branch, not yet merged to `main`.

### Added

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

### Fixed

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

- **Projectiles render in two draw calls** instead of roughly two *per
  projectile* — one `InstancedMesh` for the heads, one `LineSegments` holding
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

### Performance

Held load, update and render timed separately:

| Metric | Before | After |
| --- | --- | --- |
| Worst frame on a light-count change | 177ms | 6.5ms |
| 45 live projectiles, frame p50 | 12.5ms | 7.2ms (~139 fps) |
| 90 live projectiles, frame p50 | — | 7.9ms (~127 fps) |
| Draw calls @ 45 projectiles | 179 | 79 |
| Draw calls @ 90 projectiles | — | 73 (flat) |
| Shader recompiles per match | — | 0 |

Gameplay verified unchanged: full-match soaks land at 15–10 stationary and 15–2
dodging on SOLDIER, with no projectile escapes, no NaN, and exact pool
accounting.

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

[Unreleased]: https://github.com/abuzarthanvi25/ricochet/compare/main...perf/optimization
[0.1.0]: https://github.com/abuzarthanvi25/ricochet/releases/tag/v0.1.0
