# Contributing to RICOCHET

Thanks for taking a look. This is a small, dependency-light project — three.js,
Vite, and hand-written game code. That's deliberate, and worth preserving.

## Getting set up

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # must stay green
```

Node 18+. Developed on 24.12.

## Code style

Formatting is Prettier's job, not yours — no semicolons, single quotes, 100
columns. ESLint only enforces correctness rules; every stylistic rule is turned
off by `eslint-config-prettier` so the two never disagree.

```bash
npm run lint         # eslint
npm run lint:fix     # eslint --fix
npm run format       # prettier --write
npm run format:check # prettier --check
npm run check        # lint + format:check + test, all three
```

Editor setup: point it at `.prettierrc.json` and enable format-on-save. There is
no pre-commit hook — `npm run check` is the gate.

## Before you open a PR

1. `npm run check` passes (lint, formatting, tests).
2. `npm run build` succeeds.
3. You actually played it. Load the page, fly around, fire into a wall, get
   killed by your own ricochet. Most regressions in this codebase are things a
   unit test cannot see.
4. Press `F4` and confirm **`shader programs` is not climbing** while you play.
   See "The rules that are easy to break" below.

---

## The rules that are easy to break

These are load-bearing. Each one has already caused a real bug here.

### Never toggle `PointLight.visible`

three.js bakes the number of _visible_ lights into its shader program cache key.
Changing that count recompiles **every material in the scene**, on that frame.
Measured cost here was **97–177ms** — a hard, visible freeze.

`fx/lights.js` keeps a fixed set of lights permanently visible and parks unused
ones at `intensity = 0`. Keep it that way. The same trap applies to adding or
removing lights at runtime.

If you add a material that can change its program key mid-game (toggling
`transparent`, `vertexColors`, fog, or a define), make sure it happens during
loading, not during a fight.

### The GLB's animation clips must be retimed

All five clips are baked onto one shared timeline. `retimeClip()` in
`core/assets.js` shifts each back to its own start. Without it `Shoot` holds
frame zero for ten seconds before playing 0.33s of motion.

If you swap the model, check the clip durations at runtime before assuming
anything works.

### Collision is analytic, not sampled

`core/collision.js` solves exact per-axis contacts against the arena box and
uses ray/sphere for everything else. **Do not replace this with per-frame
position sampling** — projectiles travel 45 u/s and would tunnel through walls,
which breaks the entire premise of the game.

`npm test` fires 200 shots at 400 u/s and asserts none escape the box. If you
touch the stepping loop, that test is your safety net.

### The arming rule is universal

```js
if (bot.id === p.ownerId && p.bounces === 0) continue
```

A projectile ignores **only** its owner, and **only** before its first bounce.
It applies identically to the player and to every bot — that is why enemy
ricochets kill other enemies. Please don't special-case the player.

Difficulty scales enemy damage only. A player's own ricochet always returns at
full strength; that rule never gets easier.

### Set the damage context before dealing damage

A lethal hit runs `onBotKilled` synchronously, and the kill feed reads the
bounce count from `game.damageContext`. Call `game.setDamageContext(p)` _before_
`takeDamage`, or the feed reports a stale value.

---

## Conventions

**All tunable numbers go in `src/config.js`.** If you find yourself typing a
gameplay constant into a module, it belongs in the config instead. Tuning the
feel should never mean grepping through source.

**Frame-rate independence.** Use `Math.pow(k, dt)` for damping and
`1 - Math.exp(-rate * dt)` for easing. Never `value *= 0.92` per frame.

**No allocation in per-frame paths.** Use module-scope scratch vectors
(`const _tmp = new THREE.Vector3()`) rather than allocating inside `update`.
This codebase already had two per-frame allocations removed for this reason.

**Forward is −Z.** The camera convention. `Object3D.lookAt()` aims **+Z** for
non-cameras, which is the opposite — use `orientToDirection()` from
`core/util.js` instead.

**Pool anything spawned in bulk.** Projectiles, explosions and lights are all
pooled with O(1) free lists. Follow the pattern rather than constructing
per-shot.

**Comments explain _why_.** The code says what it does. Reserve comments for the
non-obvious constraint — the three.js quirk, the reason a number is what it is,
the bug that a line prevents.

---

## Testing

`test/mechanics.mjs` runs headless under plain Node and covers the rules the
game stands on: the analytic sweeps, clip retiming, and the arming rule
including a full self-kill.

Add cases there for anything rule-shaped. It has no browser dependency — mock
`scene` as `{ add() {} }` and drive `game` as a plain object; see the existing
projectile section for the pattern.

Rendering and feel are verified by playing. There is no snapshot suite, and
adding one is probably not worth it at this size.

---

## Commits and PRs

Conventional-commit prefixes: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`,
`test:`, `chore:`.

For anything behavioural, **put the numbers in the commit body**. "Reduced
stutter" is not reviewable; a before/after measurement is. The existing history
follows this — `git log` is a reasonable reference.

Update `CHANGELOG.md` under `[Unreleased]` for anything a player would notice.

## Versioning & releases ([SemVer](https://semver.org/))

`MAJOR.MINOR.PATCH` — breaking / feature / fix.

1. `release/x.y.z` off `develop`; bump version, update `CHANGELOG.md`.
2. Merge `release/x.y.z` → `main`; tag `vX.Y.Z`; push tags.
3. Merge `release/x.y.z` back → `develop`.

---

## Asset licensing

The bot model is **CC-BY-4.0** by
[Aurantiko](https://sketchfab.com/3d-models/shooter-bot-7fa3447a3a3147d9a69049aec48d8f88).
Attribution appears on the title and end screens and **must stay there**. If you
add assets, confirm the licence permits redistribution and record it in the
README credits.
