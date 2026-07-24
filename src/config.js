// Every tunable number in the game lives here. Nothing else should hardcode a
// gameplay constant -- tuning the feel must never mean hunting through modules.

export const CFG = {
  arena: {
    w: 60,
    h: 40,
    d: 60,
    fogNear: 20,
    fogFar: 95,
  },

  debris: {
    count: 25,
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
    maxSpeed: 22,
    drag: 0.12, // vel *= pow(drag, dt)  -- frame-rate independent
    boostImpulse: 18,
    boostCooldown: 1.2,
    fireCooldown: 0.28,
    bodyTurnRate: 9, // how fast the body catches up to the camera aim
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
    nameplateMaxDist: 55,
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
    lightIntensity: 14,
    lightDistance: 18,
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
