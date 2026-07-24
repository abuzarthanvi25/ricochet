/**
 * Difficulty presets.
 *
 * The dominant lever is `maxAttackers`, not accuracy: four bots focus-firing a
 * single target is what actually made the old default brutal, far more than
 * their aim cone. Capping how many may shoot at once keeps every bot fully
 * mobile and alive-looking while making the fight survivable. The others still
 * manoeuvre and reposition -- they just hold fire.
 *
 * The easy tiers also move four levers the harder ones leave alone, because the
 * old floor (RECRUIT) still only eased enemy OUTPUT:
 *   - `botHp`      how many player hits kill a bot (34 dmg/hit, so 50 => 2 hits)
 *   - `playerHp`   your own health pool -- a survivability buffer, not shared
 *   - `playerRegen hp/s once you have gone `CFG.player.regenDelay` without a hit
 *   - `aimAssist`  0-1 bullet magnetism toward the enemy nearest your aim ray
 * All four are 0/off on SOLDIER and VETERAN, so those play exactly as before.
 */

const STORAGE_KEY = 'ricochet.difficulty'

export const DIFFICULTIES = {
  cadet: {
    id: 'cadet',
    label: 'CADET',
    blurb: 'One bot fires at a time. You are tougher, hit harder, and regenerate.',
    maxAttackers: 1,
    fireCooldown: 3.0,
    fireCooldownJitter: 1.2,
    aimJitterDeg: 15,
    maxSpeed: 10,
    accel: 26,
    engageRange: 30,
    damageScale: 0.4,
    evadeCooldown: 1.8,
    reactionDelay: 0.8,
    botHp: 50,
    playerHp: 150,
    playerRegen: 8,
    aimAssist: 0.6,
  },
  recruit: {
    id: 'recruit',
    label: 'RECRUIT',
    blurb: 'Two bots engage at a time. Slow, wide shots. Some aim help.',
    maxAttackers: 2,
    fireCooldown: 2.4,
    fireCooldownJitter: 1.0,
    aimJitterDeg: 11,
    maxSpeed: 12,
    accel: 30,
    engageRange: 34,
    damageScale: 0.55,
    evadeCooldown: 1.4,
    reactionDelay: 0.55,
    botHp: 65,
    playerHp: 120,
    playerRegen: 4,
    aimAssist: 0.35,
  },
  soldier: {
    id: 'soldier',
    label: 'SOLDIER',
    blurb: 'Three bots engage. Balanced fight.',
    maxAttackers: 3,
    fireCooldown: 1.9,
    fireCooldownJitter: 0.8,
    aimJitterDeg: 8,
    maxSpeed: 14,
    accel: 34,
    engageRange: 40,
    damageScale: 0.8,
    evadeCooldown: 0.9,
    reactionDelay: 0.3,
    botHp: 100,
    playerHp: 100,
    playerRegen: 0,
    aimAssist: 0,
  },
  veteran: {
    id: 'veteran',
    label: 'VETERAN',
    blurb: 'All four hunt you. Full damage, tight aim.',
    maxAttackers: 4,
    fireCooldown: 1.5,
    fireCooldownJitter: 0.7,
    aimJitterDeg: 5.5,
    maxSpeed: 16,
    accel: 38,
    engageRange: 45,
    damageScale: 1.0,
    evadeCooldown: 0.7,
    reactionDelay: 0.12,
    botHp: 100,
    playerHp: 100,
    playerRegen: 0,
    aimAssist: 0,
  },
}

export const DEFAULT_DIFFICULTY = 'cadet'

export function loadDifficulty() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && DIFFICULTIES[saved]) return saved
  } catch {
    // localStorage can throw in private mode; the default is fine.
  }
  return DEFAULT_DIFFICULTY
}

export function saveDifficulty(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* non-fatal */
  }
}

export const getDifficulty = (id) => DIFFICULTIES[id] || DIFFICULTIES[DEFAULT_DIFFICULTY]
