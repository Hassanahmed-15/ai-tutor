/**
 * `/anime-lab` — the morph harness under its accurate name.
 *
 * Deliberately a re-export rather than a copy. The engine swap happened INSIDE
 * lib/anim/timeline.ts, so GsapSketch (and therefore the existing lab route) already renders
 * through anime.js; duplicating those 168 lines would produce two pages that always agree and
 * would drift apart the moment one is edited.
 *
 * NOTE: this means /gsap-lab and /anime-lab are the same page, and neither runs GSAP any more.
 * A true A/B needs the commented-out GSAP engine at the bottom of lib/anim/timeline.ts restored
 * into a second module — the comment block there explains what that involves.
 *
 * Useful query params (both handled by the underlying page):
 *   ?p=0.6            jump straight to a progress point, for a headless screenshot
 *   ?p=0.95&back=0.25 run forward then scrub BACK, which is what separates a real timeline
 *                     from CSS keyframes
 */
export { default } from "../gsap-lab/page";
