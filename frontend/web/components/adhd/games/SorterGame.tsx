"use client";

import { useEffect, useRef, useState } from "react";
import type { GameSpec } from "@/lib/adhd/games/spec";
import {
  initialSorter, applySorter, comboMultiplier, fallSpeed, sorterPassed,
  type SorterState,
} from "@/lib/adhd/games/sorterRules";
import { useReducedMotion } from "@/lib/anim/useReducedMotion";

/**
 * Sorting Run — steer the falling term into the right bin.
 *
 * PHASER IS LOADED DYNAMICALLY, on purpose. It is ~1MB, and a learner who never presses the games
 * button should never download it — so the import lives inside the effect rather than at module
 * scope. That also keeps it out of the server bundle: Phaser touches `window` on import and would
 * break SSR.
 *
 * THE RULES ARE NOT IN HERE. Scoring, combo, lives and the speed ramp all live in
 * `lib/adhd/games/sorterRules.ts` as a pure reducer; this file only turns events into pixels. That
 * split is what let this whole file be rewritten for looks without touching a single rule, and the
 * existing unit tests stood as the regression guard while it happened.
 *
 * WHY THE TILE IS STEERED AND NOT A PADDLE. A paddle turns this into a reaction test: you catch what
 * falls and the thinking is incidental. Steering the tile gives the learner the whole fall to read
 * the term and decide, so the difficulty is the sorting rather than the reflex.
 *
 * ART. Four CC0 sprites from `public/game` (see the licence there) plus one generated backdrop per
 * lesson. The sprites are vendored rather than fetched so the game cannot look broken because a CDN
 * was unreachable; the backdrop is decoration and its absence is invisible.
 */
export function SorterGame({
  spec,
  topic,
  onDone,
}: {
  spec: GameSpec;
  /** Lesson topic, used only to fetch a backdrop. Absent is fine — the game plays without one. */
  topic?: string;
  /** Called when the run ends, with whether it counts as passed. */
  onDone: (passed: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [hud, setHud] = useState<SorterState>(initialSorter);
  const [ended, setEnded] = useState<SorterState | null>(null);
  // Read from inside the Phaser scene, which outlives any single render.
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  /**
   * The backdrop arrives WHENEVER it arrives, and the game never waits for it.
   *
   * The first version gated the Phaser start on this fetch so the texture could be preloaded, and
   * that was wrong in a way a test caught immediately: generating the image takes ten to twenty
   * seconds, and for all of it the learner sat looking at an empty box. Decoration must never block
   * play.
   *
   * So the canvas is transparent and the backdrop is a CSS background on the wrapper behind it. It
   * fades in late, or never, and neither case touches the running scene.
   */
  const [bg, setBg] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!topic) { setBg(null); return; }
    fetch("/api/game-art", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    })
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((d) => { if (live) setBg(typeof d.url === "string" ? d.url : null); })
      .catch(() => { if (live) setBg(null); });
    return () => { live = false; };
  }, [topic]);

  useEffect(() => {
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    let cancelled = false;

    void (async () => {
      const Phaser = (await import("phaser")).default;
      if (cancelled || !hostRef.current) return;

      const W = 960;
      const H = 600;
      const BIN_H = 108;
      const FLOOR = H - BIN_H;
      const TINTS = [0x2dd4bf, 0xa78bfa];

      class Run extends Phaser.Scene {
        // Named `run`, not `state`: a class field called `state` makes ESLint's
        // react/no-direct-mutation-state treat this Phaser Scene as a React component and reject
        // every assignment. It is also plainly clearer — this is the run, not React state.
        run: SorterState = initialSorter();
        queue = [...spec.items];
        tile?: Phaser.GameObjects.Container;
        tileBin = 0;
        aim = W / 2;
        started = false;
        hudText?: Phaser.GameObjects.Text;
        comboText?: Phaser.GameObjects.Text;
        hero?: Phaser.GameObjects.Container;
        heroFace?: Phaser.GameObjects.Text;
        binFill: Phaser.GameObjects.Rectangle[] = [];

        preload() {
          this.load.image("tile", "/game/tile.png");
          this.load.image("binA", "/game/bin-a.png");
          this.load.image("binB", "/game/bin-b.png");
          this.load.image("spark", "/game/spark.png");
        }

        create() {
          // Transparent: the backdrop is a CSS layer behind this canvas, so it can arrive late
          // without the scene being rebuilt. The vignette keeps the play column calm and the tile
          // text readable over whatever the model painted.
          this.add.rectangle(W / 2, H / 2, W * 0.58, H, 0x060912, 0.6).setDepth(1);

          /* ── bins ─────────────────────────────────────────────────────────── */
          spec.bins.forEach((label, i) => {
            const cx = i === 0 ? W / 4 : (W * 3) / 4;
            const bin = this.add.image(cx, FLOOR + BIN_H / 2, i === 0 ? "binA" : "binB");
            bin.setDisplaySize(W / 2 - 16, BIN_H - 12).setDepth(2).setAlpha(0.92);
            // Fills upward as items land in it — the only running feedback that is not a number.
            const fill = this.add
              .rectangle(cx, FLOOR + BIN_H - 6, W / 2 - 40, 0, TINTS[i], 0.5)
              .setOrigin(0.5, 1)
              .setDepth(3);
            this.binFill.push(fill);
            this.add.text(cx, FLOOR + BIN_H / 2, label, {
              fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#f8fafc",
              align: "center", wordWrap: { width: W / 2 - 60 },
            }).setOrigin(0.5).setDepth(4).setShadow(0, 2, "#000000", 4);
          });
          this.add.rectangle(W / 2, 0, 2, FLOOR, 0xffffff, 0.1).setOrigin(0.5, 0).setDepth(2);

          /* ── the hero: a face that reacts, so a miss lands on someone ─────── */
          const body = this.add.circle(0, 0, 26, 0x1e293b).setStrokeStyle(3, 0x64748b);
          this.heroFace = this.add.text(0, 0, ":)", {
            fontFamily: "ui-monospace, monospace", fontSize: "22px", color: "#e2e8f0",
          }).setOrigin(0.5);
          this.hero = this.add.container(W / 2, FLOOR - 34, [body, this.heroFace]).setDepth(5);

          /* ── hud ──────────────────────────────────────────────────────────── */
          this.hudText = this.add.text(18, 16, "", {
            fontFamily: "ui-monospace, monospace", fontSize: "18px", color: "#cbd5e1",
          }).setDepth(6).setShadow(0, 2, "#000000", 4);
          this.comboText = this.add.text(W / 2, 92, "", {
            fontFamily: "system-ui, sans-serif", fontSize: "34px", color: "#2dd4bf",
          }).setOrigin(0.5).setDepth(6).setAlpha(0);

          this.input.on("pointermove", (p: Phaser.Input.Pointer) => { this.aim = p.x; });
          this.input.keyboard?.on("keydown-LEFT", () => { this.aim = Math.max(80, this.aim - 110); });
          this.input.keyboard?.on("keydown-RIGHT", () => { this.aim = Math.min(W - 80, this.aim + 110); });

          this.showStartCard();
          this.refreshHud();
        }

        /**
         * A start card, because the round is unplayable without one: the bins have to be read before
         * anything falls, and the first tile used to arrive while the learner was still working out
         * what the two sides meant.
         */
        showStartCard() {
          const veil = this.add.rectangle(W / 2, H / 2, W, H, 0x050810, 0.82).setDepth(20);
          const title = this.add.text(W / 2, H / 2 - 70, spec.title, {
            fontFamily: "system-ui, sans-serif", fontSize: "30px", color: "#f8fafc",
            align: "center", wordWrap: { width: W - 160 },
          }).setOrigin(0.5).setDepth(21);
          const how = this.add.text(W / 2, H / 2 + 4,
            `Steer each one into ${spec.bins[0]}  or  ${spec.bins[1]}\nmouse or arrow keys · ${spec.items.length} to sort · 3 lives`, {
            fontFamily: "system-ui, sans-serif", fontSize: "17px", color: "#94a3b8", align: "center",
            lineSpacing: 8,
          }).setOrigin(0.5).setDepth(21);
          const go = this.add.text(W / 2, H / 2 + 86, "click to start", {
            fontFamily: "system-ui, sans-serif", fontSize: "19px", color: "#2dd4bf",
          }).setOrigin(0.5).setDepth(21);

          if (!reduced) this.tweens.add({ targets: go, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

          this.input.once("pointerdown", () => {
            [veil, title, how, go].forEach((o) => o.destroy());
            this.started = true;
            this.spawn();
          });
        }

        refreshHud() {
          const s = this.run;
          const hearts = s.lives > 0 ? "<3 ".repeat(s.lives).trim() : "--";
          this.hudText?.setText(
            "SCORE " + s.score + "     LIVES " + hearts + "     " + s.resolved + "/" + spec.items.length,
          );
          setHud(s);
        }

        spawn() {
          const item = this.queue.shift();
          if (!item) {
            this.finish(applySorter(this.run, { type: "cleared" }));
            return;
          }
          this.tileBin = item.bin;

          const label = this.add.text(0, 0, item.text, {
            fontFamily: "system-ui, sans-serif", fontSize: "19px", color: "#0f172a",
            align: "center", wordWrap: { width: 260 },
          }).setOrigin(0.5);
          // NineSlice, not a stretched image: a rounded panel scaled to a wide tile smears its
          // corners, which is the single most obvious "programmer art" tell.
          const w = Math.max(150, label.width + 46);
          const h = Math.max(58, label.height + 30);
          const panel = this.add.nineslice(0, 0, "tile", undefined, w, h, 18, 18, 18, 22);
          const tile = this.add.container(W / 2, -50, [panel, label]).setDepth(10);
          this.tile = tile;
          this.aim = W / 2;

          if (!reduced) {
            tile.setScale(0.7);
            this.tweens.add({ targets: tile, scale: 1, duration: 220, ease: "Back.easeOut" });
          }
        }

        update(_t: number, dms: number) {
          const tile = this.tile;
          if (!this.started || !tile || this.run.over) return;
          const dt = Math.min(dms, 50) / 1000;

          tile.y += fallSpeed(this.run) * dt;
          // Ease toward the aim rather than snapping: a tile that teleports reads as a cursor, and
          // the lateral travel time is what makes a late change of mind cost something.
          const target = Phaser.Math.Clamp(this.aim, 80, W - 80);
          tile.x += (target - tile.x) * Math.min(1, dt * 9);
          // Bank into the turn. Pure decoration, and it is most of what makes the tile feel physical.
          tile.setRotation(Phaser.Math.Clamp((target - tile.x) * 0.0012, -0.18, 0.18));

          // The hero tracks the tile, so there is something on screen anticipating the landing.
          if (this.hero) this.hero.x += (tile.x - this.hero.x) * Math.min(1, dt * 6);

          if (tile.y >= FLOOR - 26) {
            const landedIn = tile.x < W / 2 ? 0 : 1;
            this.resolve(landedIn === this.tileBin, tile.x);
          }
        }

        resolve(right: boolean, x: number) {
          const tile = this.tile;
          this.tile = undefined;

          if (tile) {
            if (reduced) tile.destroy();
            else {
              this.tweens.add({
                targets: tile, y: FLOOR + 30, scale: 0.5, alpha: 0,
                duration: 260, ease: "Quad.easeIn", onComplete: () => tile.destroy(),
              });
            }
          }

          const next = applySorter(this.run, { type: "catch", right });
          this.run = next;

          // Bin fill: the running record of how much of the round is done, without a number.
          const idx = x < W / 2 ? 0 : 1;
          const fill = this.binFill[idx];
          if (fill) {
            const h = Math.min(BIN_H - 16, fill.height + (BIN_H - 16) / Math.max(1, spec.items.length / 2));
            if (reduced) fill.height = h;
            else this.tweens.add({ targets: fill, height: h, duration: 260, ease: "Quad.easeOut" });
          }

          this.heroFace?.setText(right ? ":D" : ":(");
          this.time.delayedCall(700, () => this.heroFace?.setText(":)"));

          if (!reduced) {
            if (right) {
              const burst = this.add.particles(x, FLOOR - 20, "spark", {
                speed: { min: 90, max: 260 }, lifespan: 520, quantity: 12, angle: { min: 200, max: 340 },
                scale: { start: 0.5, end: 0 }, tint: TINTS[idx], gravityY: 320,
              }).setDepth(12);
              this.time.delayedCall(560, () => burst.destroy());
              if (next.combo >= 2 && this.comboText) {
                this.comboText.setText(`${next.combo}x  ${comboMultiplier(next).toFixed(1)}×`);
                this.comboText.setAlpha(1).setScale(0.7);
                this.tweens.add({ targets: this.comboText, scale: 1.15, alpha: 0, duration: 620, ease: "Quad.easeOut" });
              }
            } else {
              this.cameras.main.shake(200, 0.008);
            }
          }
          this.cameras.main.flash(110, right ? 20 : 110, right ? 110 : 20, 60);

          this.refreshHud();
          if (next.over) {
            this.finish(next);
            return;
          }
          this.time.delayedCall(reduced ? 140 : 300, () => this.spawn());
        }

        finish(final: SorterState) {
          this.run = final;
          this.refreshHud();
          setEnded(final);
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: W,
        height: H,
        parent: hostRef.current,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: Run,
        transparent: true,
        audio: { noAudio: true },
      });
    })();

    return () => {
      cancelled = true;
      // `true` removes the canvas too. Without it a remount stacks a second canvas on the first and
      // both keep running their loops.
      game?.destroy(true);
    };
  }, [spec, reduced]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#080d1a]" data-sorter-game={spec.beatId}>
      {/* Behind the transparent canvas, so it can fade in whenever generation finishes. */}
      <div
        data-sorter-backdrop={bg ? "on" : "off"}
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
        style={{ backgroundImage: bg ? `url(${bg})` : undefined, opacity: bg ? 0.42 : 0 }}
      />
      <div ref={hostRef} className="relative h-full w-full" data-sorter-canvas />

      {/* Mirrored into the DOM because neither a test nor a screen reader can see anything drawn on
          a canvas. This is the only handle either of them gets on the run. */}
      <span className="sr-only" data-sorter-state aria-live="polite">
        {ended
          ? `finished, ${ended.correct} right, ${ended.wrong + ended.missed} not`
          : `${hud.resolved} of ${spec.items.length} sorted`}
      </span>

      {ended && (
        <div className="absolute inset-0 grid place-items-center bg-black/75 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <p className={`text-3xl font-black ${sorterPassed(ended) ? "text-emerald-300" : "text-amber-300"}`}>
              {sorterPassed(ended) ? "Sorted!" : "Out of lives"}
            </p>
            <p className="text-sm text-white/70">
              {ended.score} points · best combo {ended.bestCombo} · {ended.correct} right,{" "}
              {ended.wrong + ended.missed} not
            </p>
            <button
              data-sorter-continue
              onClick={() => doneRef.current(sorterPassed(ended))}
              className="rounded-full bg-teal-400/15 px-6 py-2.5 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition hover:bg-teal-400/25"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
