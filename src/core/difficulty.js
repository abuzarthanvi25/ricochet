/**
 * Difficulty presets.
 *
 * The dominant lever is `maxAttackers`, not accuracy: four bots focus-firing a
 * single target is what actually made the old default brutal, far more than
 * their aim cone. Capping how many may shoot at once keeps every bot fully
 * mobile and alive-looking while making the fight survivable. The others still
 * manoeuvre and reposition -- they just hold fire.
 */

const STORAGE_KEY = 'ricochet.difficulty'

export const DIFFICULTIES = {
  recruit: {
    id: 'recruit',
    label: 'RECRUIT',
    blurb: 'Two bots engage at a time. Slow, wide shots.',
    maxAttackers: 2,
    fireCooldown: 2.4,
    fireCooldownJitter: 1.0,
    aimJitterDeg: 11,
    maxSpeed: 12,
    accel: 30,
    engageRange: 34,
    damageScale: 0.55,
    evadeCooldown: 1.2,
    reactionDelay: 0.55,
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
  },
}

export const DEFAULT_DIFFICULTY = 'soldier'

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
