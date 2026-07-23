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
    lights: 6,
  },

  fx: {
    bloomStrength: 0.85,
    bloomRadius: 0.5,
    bloomThreshold: 0.35,
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
