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
 * split is the only reason any of it is testable — a rule buried in an `update()` loop can be
 * checked by playing the game and squinting, which means it never gets checked again.
 *
 * WHY THE TILE IS STEERED AND NOT A PADDLE. A paddle turns this into a reaction test: you catch what
 * falls and the thinking is incidental. Steering the tile gives the learner the whole fall to read
 * the term and decide, so the difficulty is the sorting rather than the reflex. The time pressure is
 * still there, it just applies to the decision.
 */
export function SorterGame({
  spec,
  onDone,
}: {
  spec: GameSpec;
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

  useEffect(() => {
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    let cancelled = false;

    void (async () => {
      const Phaser = (await import("phaser")).default;
      if (cancelled || !hostRef.current) return;

      const W = 900;
      const H = 560;
      const BIN_H = 92;

      class Run extends Phaser.Scene {
        // Named `run`, not `state`: a class field called `state` makes ESLint's
        // react/no-direct-mutation-state treat this Phaser Scene as a React component and reject
        // every assignment. It is also plainly clearer — this is the run, not React state.
        run: SorterState = initialSorter();
        queue = [...spec.items];
        tile?: Phaser.GameObjects.Container;
        tileBin = 0;
        aim = W / 2;
        hudText?: Phaser.GameObjects.Text;

        create() {
          this.cameras.main.setBackgroundColor("#0b1220");

          // Colour is what tells the two bins apart at a glance while a tile is falling, so it
          // carries the same information as the label rather than decorating it.
          const colours = [0x0d9488, 0x7c3aed];
          spec.bins.forEach((label, i) => {
            const x = i === 0 ? 0 : W / 2;
            this.add.rectangle(x, H - BIN_H, W / 2, BIN_H, colours[i], 0.22).setOrigin(0, 0);
            this.add.rectangle(x + 2, H - BIN_H, W / 2 - 4, 4, colours[i], 0.9).setOrigin(0, 0);
            this.add.text(x + W / 4, H - BIN_H / 2, label, {
              fontFamily: "system-ui, sans-serif", fontSize: "21px", color: "#e2e8f0",
              align: "center", wordWrap: { width: W / 2 - 40 },
            }).setOrigin(0.5);
          });
          // Without a divider the boundary between the bins is guesswork mid-fall.
          this.add.rectangle(W / 2, 0, 2, H - BIN_H, 0xffffff, 0.12).setOrigin(0.5, 0);

          this.hudText = this.add.text(16, 14, "", {
            fontFamily: "ui-monospace, monospace", fontSize: "17px", color: "#94a3b8",
          });

          this.input.on("pointermove", (p: Phaser.Input.Pointer) => { this.aim = p.x; });
          this.input.keyboard?.on("keydown-LEFT", () => { this.aim = Math.max(70, this.aim - 100); });
          this.input.keyboard?.on("keydown-RIGHT", () => { this.aim = Math.min(W - 70, this.aim + 100); });

          this.spawn();
          this.refreshHud();
        }

        refreshHud() {
          const s = this.run;
          const hearts = s.lives > 0 ? "*".repeat(s.lives) : "-";
          this.hudText?.setText(
            "SCORE " + s.score +
            "    COMBO " + s.combo + (s.combo > 0 ? " (" + comboMultiplier(s).toFixed(1) + "x)" : "") +
            "    LIVES " + hearts +
            "    " + s.resolved + "/" + spec.items.length,
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
            align: "center", wordWrap: { width: 250 },
          }).setOrigin(0.5);
          const pad = 16;
          const bg = this.add
            .rectangle(0, 0, label.width + pad * 2, label.height + pad, 0xf8fafc, 1)
            .setStrokeStyle(2, 0xcbd5e1);
          this.tile = this.add.container(W / 2, -40, [bg, label]);
          this.aim = W / 2;
        }

        update(_t: number, dms: number) {
          const tile = this.tile;
          if (!tile || this.run.over) return;
          const dt = dms / 1000;

          tile.y += fallSpeed(this.run) * dt;
          // Ease toward the aim rather than snapping: a tile that teleports reads as a cursor, and
          // the lateral travel time is what makes a late change of mind cost something.
          tile.x += (Phaser.Math.Clamp(this.aim, 70, W - 70) - tile.x) * Math.min(1, dt * 9);

          if (tile.y >= H - BIN_H - 18) {
            const landedIn = tile.x < W / 2 ? 0 : 1;
            this.resolve(landedIn === this.tileBin, tile.x, tile.y);
          }
        }

        resolve(right: boolean, x: number, y: number) {
          this.tile?.destroy();
          this.tile = undefined;

          if (!reduced) {
            // Juice, and only when motion is welcome. Falling objects, screen shake and bursting
            // particles are precisely what `useReducedMotion` exists to suppress.
            if (right) {
              const burst = this.add.particles(x, y, "__WHITE", {
                speed: { min: 60, max: 220 }, lifespan: 450, quantity: 14,
                scale: { start: 1.1, end: 0 }, tint: 0x2dd4bf,
              });
              this.time.delayedCall(500, () => burst.destroy());
            } else {
              this.cameras.main.shake(180, 0.006);
            }
          }
          this.cameras.main.flash(120, right ? 20 : 90, right ? 90 : 20, 60);

          const next = applySorter(this.run, { type: "catch", right });
          this.run = next;
          this.refreshHud();
          if (next.over) {
            this.finish(next);
            return;
          }
          this.time.delayedCall(reduced ? 120 : 220, () => this.spawn());
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
    <div className="relative h-full w-full bg-[#0b1220]" data-sorter-game={spec.beatId}>
      <div ref={hostRef} className="h-full w-full" data-sorter-canvas />

      {/* Mirrored into the DOM because neither a test nor a screen reader can see anything drawn on
          a canvas. This is the only handle either of them gets on the run. */}
      <span className="sr-only" data-sorter-state aria-live="polite">
        {ended
          ? `finished, ${ended.correct} right, ${ended.wrong + ended.missed} not`
          : `${hud.resolved} of ${spec.items.length} sorted`}
      </span>

      {ended && (
        <div className="absolute inset-0 grid place-items-center bg-black/72 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <p className={`text-2xl font-black ${sorterPassed(ended) ? "text-emerald-300" : "text-amber-300"}`}>
              {sorterPassed(ended) ? "Sorted!" : "Out of lives"}
            </p>
            <p className="text-sm text-white/70">
              {ended.score} points · best combo {ended.bestCombo} · {ended.correct} right,{" "}
              {ended.wrong + ended.missed} not
            </p>
            <button
              data-sorter-continue
              onClick={() => doneRef.current(sorterPassed(ended))}
              className="rounded-full bg-teal-400/15 px-5 py-2 text-sm font-bold text-teal-200 ring-1 ring-teal-400/30 transition hover:bg-teal-400/25"
            >
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
