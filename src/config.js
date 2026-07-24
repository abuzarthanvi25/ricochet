// Every tunable number in the game lives here. Nothing else should hardcode a
// gameplay constant -- tuning the feel must never mean hunting through modules.

export const CFG = {
  arena: {
    // Enlarged ~1.4x from the original 60x40x60 for more room to fly. Fog range
    // scales WITH the box: the corner-to-corner diagonal is now ~130, and fog is
    // applied after lighting/emissive in the shader, so a wall past fogFar reads
    // near-black no matter how it is lit. fogFar sits just beyond the diagonal so
    // the far wall stays visible. See fx.lightDistance and main.js's static
    // lights, both nudged up to match -- none of which changes the light COUNT.
    w: 84,
    h: 52,
    d: 84,
    fogNear: 28,
    fogFar: 135,
  },

  debris: {
    // Scaled up with the arena so the field keeps roughly the same density.
    count: 40,
    minR: 1.5,
    maxR: 5.0,
    driftMax: 1.2, // units/sec
    spinMax: 0.6, // rad/sec
    minGapFromCenter: 10, // keep the middle of the arena open for spawns
  },

  bot: {
    // GLB body is ~2.15 units tall at scale 1 (see plan). 0.75 -> ~1.6 units.
    modelScale: 0.75,
    radius: 1.0,
    maxHp: 100,
    // Model's cannon points +Z; three.js treats -Z as forward.
    yawOffset: Math.PI,
    muzzleBone: 'Canon_Pipe_J_04',
    hurtFlashTime: 0.18,
    deathSinkTime: 2.2,
  },

  player: {
    accel: 55,
    maxSpeed: 24, // slightly up with the larger arena so travel isn't tedious
    drag: 0.12, // vel *= pow(drag, dt)  -- frame-rate independent
    // Flight assist: when the player is holding no thrust key and not boosting,
    // integrate() swaps this in for `drag`. Time constant ~0.17s, so the ship
    // sheds most of its speed almost at once and settles to a near-stop in about
    // half a second -- roughly three times snappier than the base drag's drift.
    // Toggleable (X); default on. Bots never brake this way; their drift reads.
    assistDrag: 0.003,
    boostImpulse: 18,
    boostCooldown: 1.2,
    fireCooldown: 0.28,
    bodyTurnRate: 9, // how fast the body catches up to the camera aim
    // Seconds without taking damage before the player starts regenerating, on
    // difficulties whose playerRegen is > 0 (easy tiers only).
    regenDelay: 3.0,
  },

  enemy: {
    count: 4,
    respawnDelay: 3.0,
    accel: 38,
    maxSpeed: 16,
    drag: 0.15,
    engageRange: 45,
    preferMin: 18,
    preferMax: 28,
    // Tuned against a soak run: 4 bots with lead-aim and a 3deg cone killed a
    // stationary player in ~1.2s, which leaves no room to react at all.
    fireCooldown: 1.5,
    fireCooldownJitter: 0.7,
    aimJitterDeg: 5.5,
    evadeRadius: 12,
    evadeDot: 0.9, // projectile must be heading roughly at us
    evadeImpulse: 16,
    evadeCooldown: 0.7,
    staggerTime: 0.4,
    waypointReach: 4,
    avoidLookahead: 8,
    avoidStrength: 45,
  },

  proj: {
    speed: 45,
    lifetime: 3.0,
    radius: 0.35,
    maxStep: 0.5, // swept substep length -- keeps fast shots from tunneling
    maxBouncesPerFrame: 6,
    directDamage: 34,
    blastRadius: 4.0,
    blastDamage: 30,
    blastKnock: 22,
    // emissive colour lerps fresh -> armed as the bounce count climbs
    colorFresh: 0x35e8ff,
    colorArmed: 0xff5a12,
    colorFullyArmed: 0xffd000,
    bouncesToFullHeat: 4,
    // Two shots that cross within this distance ricochet off each other and both
    // arm. Detection is a swept closest-approach over each frame's segment, so it
    // cannot tunnel; see weapons/projectiles.js _resolveCollisions.
    crossRadius: 0.7, // ~2 * radius
  },

  // Finite floating sea-mines. A fixed number are placed at match start and do
  // not move or respawn -- destructible hazards you can bait bots into. Anything
  // that touches one, or any projectile that hits one, sets it off; the blast
  // damages everyone in radius, and a shot-triggered blast is credited to whoever
  // fired the shot (a bot flying into one is an environmental kill, no score).
  mines: {
    count: 5,
    radius: 1.3, // collision sphere (body + spikes)
    bodyRadius: 0.85, // visual body sphere
    spikeLen: 0.7,
    blastRadius: 6.5,
    blastDamage: 55, // NOT difficulty-scaled -- a hazard is a hazard
    blastKnock: 30,
    color: 0xff5a2a, // body emissive + explosion tint
  },

  powerups: {
    // Every type expires on the same clock -- one timer to read, one ring on
    // the HUD, no per-type mental math mid-fight.
    duration: 8.0,
    // Hard budget for a WHOLE match, not a concurrent cap. Once the fourth has
    // been taken nobody gets another, which is what makes contesting one worth
    // breaking off a fight for.
    budgetPerMatch: 4,
    firstSpawnDelay: 12,
    spawnInterval: 22,
    pickupRadius: 1.6,
    bobAmp: 0.35,
    bobRate: 1.4,
    spinRate: 0.8,
    // How far a bot will break off to go and grab one. Measured over 4-minute
    // matches against a player beelining for every pickup: at 30 the bots took
    // 11 of 16 even then, and a real player who has to *spot* one first got
    // none at all. At 22 the player wins 12/16 with perfect play, which leaves
    // a real, distracted player one or two a match. It also sits right on
    // arena.findSpawn's 22-unit bot clearance, so a pickup always lands just
    // outside the nearest bot's awareness and somebody has to commit to it.
    seekRadius: 22,

    // Four clearly separated hues. Distinct shapes alone were not enough --
    // additive glow washes shapes out at range, and colour is what actually
    // carries across the arena. Avoid near-white: it blows out under bloom and
    // stops reading as any colour at all.
    shield: {
      radius: 2.4,
      color: 0x35e8ff, // cyan
    },
    permaboost: {
      color: 0xffc23d, // gold
      // Not just "boost has no cooldown" -- the whole loadout speeds up.
      // speedMul multiplies thrust AND the speed cap, and is kept separate from
      // the frostile slow so the two stack multiplicatively instead of whichever
      // landed last winning outright.
      speedMul: 1.45,
      projSpeedMul: 1.35,
      boostMul: 1.5,
      // Held FOV while active, so the extra speed is felt and not just measured.
      // Sits between the resting 75 and the boost kick at 88.
      fov: 82,
    },
    frost: {
      color: 0x7ab8ff, // periwinkle -- deliberately off cyan, see above
      slowDuration: 2.5,
      speedMul: 0.4,
      tint: 0x2b7fd4,
    },
    rocket: {
      color: 0xff45d0,
      // Straight flight before it starts hunting, so a point-blank shot still
      // goes where you pointed it.
      armDelay: 0.35,
      seekRadius: 22,
      turnRate: 3.2, // rad/sec
      length: 1.1,
    },
  },

  camera: {
    offset: [0.8, 1.15, 6.2],
    stiffness: 12,
    pitchClampDeg: 85,
    mouseSensitivity: 0.0022,
    fov: 75,
    fovBoost: 88,
    fovLerp: 6,
    near: 0.1,
    far: 400,
    collideRadius: 0.5,
  },

  match: {
    killsToWin: 15,
    playerRespawnDelay: 2.5,
  },

  ui: {
    nameplateHeight: 1.15, // world units above the bot's centre (bot is ~1.66 tall)
    nameplateMaxDist: 78, // up with the larger arena so plates show across it
  },

  // Bullet magnetism for the player only. A fresh player shot bends toward the
  // enemy nearest the aim ray, by a fraction that comes from the difficulty
  // (diff.aimAssist, 0 on SOLDIER/VETERAN). It nudges only the INITIAL fire
  // direction before spawn -- the analytic sweep and the ricochet arming rule are
  // untouched, so a magnetised shot still bounces and can still come back to kill
  // you. Never targets a dead bot or the shooter.
  assist: {
    coneDeg: 7, // an enemy must sit within this half-angle of the raw aim ray
    maxDist: 60, // ...and no farther than this, or magnetism does nothing
  },

  // Radar disc (ui/radar.js). Drawn to a 2D canvas, not three.js -- zero shader
  // program surface. You sit at the centre, screen-up is your heading, so an
  // enemy behind you reads as a blip below centre.
  radar: {
    size: 168, // canvas square, px
    range: 70, // world units mapped to the disc radius; farther clamps to the rim
    blip: 4.5, // blip radius, px
  },

  pools: {
    projectiles: 96,
    explosions: 24,
    // Always-on count (never toggled -- see fx/lights.js). Every one of these
    // is paid for on every lit pixel every frame, so 4 rather than 6.
    lights: 4,
  },

  fx: {
    bloomStrength: 0.85,
    bloomRadius: 0.5,
    bloomThreshold: 0.35,
    // Bloom runs at half the canvas resolution. It is five separable blur mips
    // over a full-screen buffer -- the single most expensive thing in the frame
    // at 1:1 (measured 6.3ms of a ~22ms frame). The output is blurred by
    // definition, so halving the internal buffer is very close to free
    // visually: an interleaved A/B put it at -29% GPU time with no visible
    // difference in the glow.
    bloomScale: 0.5,
    trailLength: 14,
    // Reach widened with the larger arena. distance/intensity on a PointLight are
    // uniforms, so this is free of the recompile that changing the light COUNT
    // would trigger (see fx/lights.js).
    lightIntensity: 16,
    lightDistance: 26,
  },

  teams: {
    // Emissive tint (glowing panels/eyes) and a body multiplier over the base
    // texture. Both bots share one gold texture, so without the body tint
    // friend and foe are near-indistinguishable at range.
    // Player keeps the model's natural gold: it is always in the same spot on
    // screen, so it needs no marking, and tinting it just muddies the texture.
    player: 0x35e8ff,
    playerBody: 0xffffff,
    enemy: 0xff3355,
    enemyBody: 0xff7a5c,
  },

  debug: false,
}

export const HALF = {
  x: CFG.arena.w / 2,
  y: CFG.arena.h / 2,
  z: CFG.arena.d / 2,
}
