import * as THREE from 'three'
import { CFG } from '../config.js'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Project a world-space offset `rel` (enemy - player) into radar-disc coordinates.
 *
 * `fwd` and `right` are the player's HORIZONTAL heading basis (both y = 0, so the
 * disc is a stable top-down slice that does not tip when you look up or down).
 * Screen-up is forward, so an enemy behind you (rel pointing opposite `fwd`) lands
 * below centre -- which is the whole point of the radar. Returns normalised disc
 * coordinates in [-1, 1] with the vertical world offset carried through as `vy`
 * for the above/below stalk; a blip past `range` is clamped to the rim (a
 * direction arrow) with `clamped = true`.
 *
 * Pure and allocation-free apart from the returned literal, so it unit-tests
 * headless with no canvas.
 */
export function computeBlip(rel, fwd, right, range) {
  const bx = rel.x * right.x + rel.y * right.y + rel.z * right.z
  const bz = rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z
  let nx = bx / range
  let ny = bz / range
  const m = Math.hypot(nx, ny)
  let clamped = false
  if (m > 1) {
    nx /= m
    ny /= m
    clamped = true
  }
  return { x: nx, y: ny, vy: rel.y, clamped, dist: Math.hypot(bx, bz) }
}

/**
 * Elite-style radar disc, drawn to a 2D canvas -- deliberately NOT three.js, so
 * it adds zero shader-program surface (the recompile trap this codebase guards).
 * You sit at the centre; hostiles are red blips with a short vertical stalk that
 * reads as above/below. Driven straight from Game.update, like the nameplates.
 */
export class Radar {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.s = CFG.radar.size

    // Back the canvas at device resolution so the rings stay crisp, then scale
    // the drawing context so all coordinates below are in CSS pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = this.s * dpr
    canvas.height = this.s * dpr
    canvas.style.width = `${this.s}px`
    canvas.style.height = `${this.s}px`
    this.ctx.scale(dpr, dpr)

    this._fwd = new THREE.Vector3()
    this._rel = new THREE.Vector3()
  }

  clear() {
    this.ctx.clearRect(0, 0, this.s, this.s)
  }

  update(rig, playerPos, enemies) {
    const ctx = this.ctx
    const s = this.s
    const cx = s / 2
    const cy = s / 2
    const R = s / 2 - 6

    ctx.clearRect(0, 0, s, s)

    // --- disc, rings and cross-lines -------------------------------------
    ctx.strokeStyle = 'rgba(53, 232, 255, 0.22)'
    ctx.fillStyle = 'rgba(6, 20, 30, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - R, cy)
    ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R)
    ctx.lineTo(cx, cy + R)
    ctx.stroke()

    // --- player marker: a triangle at the centre, pointing "up" (forward) --
    ctx.fillStyle = '#35e8ff'
    ctx.beginPath()
    ctx.moveTo(cx, cy - 6)
    ctx.lineTo(cx - 4.5, cy + 4)
    ctx.lineTo(cx + 4.5, cy + 4)
    ctx.closePath()
    ctx.fill()

    // Flatten the heading to a horizontal top-down basis. Looking straight up or
    // down collapses forward to zero, so fall back to the strafe basis then.
    this._fwd.copy(rig.forward)
    this._fwd.y = 0
    if (this._fwd.lengthSq() < 1e-6) this._fwd.crossVectors(rig.right, UP)
    this._fwd.normalize()
    const right = rig.right

    for (const e of enemies) {
      if (!e.alive || e.dying) continue
      this._rel.subVectors(e.pos, playerPos)
      const b = computeBlip(this._rel, this._fwd, right, CFG.radar.range)
      const px = cx + b.x * R
      const py = cy - b.y * R // canvas y is down; forward maps to up

      // Vertical stalk: length by altitude difference, capped, with a cap tick.
      // Up for an enemy above you, down for below -- the Elite convention.
      const stalk = THREE.MathUtils.clamp(b.vy / CFG.radar.range, -1, 1) * (R * 0.5)
      ctx.strokeStyle = 'rgba(255, 70, 90, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px, py - stalk)
      ctx.stroke()

      ctx.fillStyle = b.clamped ? 'rgba(255, 70, 90, 0.75)' : '#ff465a'
      ctx.beginPath()
      ctx.arc(px, py - stalk, CFG.radar.blip, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
