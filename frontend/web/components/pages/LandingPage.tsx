"use client";

import { ArrowRight, FileUp, Mic, PenLine, Play } from "lucide-react";
import { HudPage, type PageName } from "@/components/hud/HudKit";
import { DEMO_HARDCODED } from "@/lib/demo/demoLecture";

/**
 * The home page.
 *
 * The previous pass reduced this to a dimmed headline on black with two thirds of the viewport
 * empty. It was minimal in the wrong sense — nothing to look at, nothing to understand, and no
 * sign of the actual product. Minimal should mean "nothing unnecessary", not "nothing".
 *
 * This version keeps the restraint (one accent, no gradients, no glow, short copy) but earns its
 * space: the topic input is on the page rather than a click away, and a miniature of the classroom
 * shows what the thing produces. A student can start a lesson without scrolling or navigating.
 */
const CAPABILITIES = [
  { icon: Mic, title: "Speak to interrupt", body: "Talk over it mid-sentence. The audio stops and it answers you." },
  { icon: PenLine, title: "Drawn as it explains", body: "Diagrams, charts and equations appear in time with the voice." },
  { icon: FileUp, title: "Bring your own source", body: "Upload a PDF or deck; the lesson is built from its actual pages." },
];

export function LandingPage({ go, onStart }: { go: (p: PageName) => void; onStart: () => void }) {
  return (
    <HudPage current="landing" go={go} onStart={onStart}>
      {/* HERO — headline, the real entry input, and a preview of the output. */}
      <section className="mx-auto grid max-w-6xl gap-14 px-6 pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-20">
        <div>
          <h1 className="hud-materialize font-display text-[2.9rem] leading-[1.02] tracking-[-0.03em] text-[var(--hud-text)] sm:text-[3.9rem]">
            A private tutor that
            <br />
            teaches it <span className="italic">live.</span>
          </h1>

          <p
            className="hud-materialize mt-6 max-w-md text-[1.02rem] leading-[1.65] text-[var(--hud-text-dim)]"
            style={{ animationDelay: "0.08s" }}
          >
            Name any subject. Aria plans the lesson, draws it on a board, and talks you through —
            stopping the moment you have a question.
          </p>

          {/* The actual entry point, on the page. A student can start here rather than hunting for
              a call to action. */}
          <form
            className="hud-materialize mt-9 flex flex-col gap-2.5 sm:flex-row"
            style={{ animationDelay: "0.16s" }}
            onSubmit={(e) => {
              e.preventDefault();
              go("learn");
            }}
          >
            <label htmlFor="landing-topic" className="sr-only">
              What do you want to learn?
            </label>
            <input
              id="landing-topic"
              placeholder="Explain the Krebs cycle…"
              className="min-w-0 flex-1 rounded-[var(--radius)] border px-4 py-3 text-[0.95rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--listening)]"
              style={{
                background: "var(--hud-surface)",
                borderColor: "var(--hud-line)",
                transitionDuration: "var(--motion-fast)",
              }}
            />
            <button
              type="submit"
              className="hud-btn-primary inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-3 text-[0.95rem]"
            >
              Start <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          </form>

          <div className="hud-materialize mt-5 flex flex-wrap items-center gap-x-5 gap-y-2" style={{ animationDelay: "0.22s" }}>
            <button
              onClick={onStart}
              className="inline-flex items-center gap-1.5 text-[0.85rem] text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              <Play aria-hidden="true" size={13} strokeWidth={2} /> Watch a finished lesson
            </button>
            <span className="text-[0.8rem] text-[var(--hud-text-faint)]">Around four minutes to compose</span>
            {process.env.NODE_ENV !== "production" && DEMO_HARDCODED && (
              <button
                onClick={() => go("demo")}
                className="text-[0.8rem] text-[var(--hud-text-faint)] transition-colors hover:text-[var(--hud-text)]"
              >
                Dev · free demo
              </button>
            )}
          </div>
        </div>

        {/* A real lesson plan, not an abstract mock.
            The previous version drew grey bars pretending to be a chart, which read as a broken
            placeholder rather than a preview — meaningless shapes tell a visitor nothing. This
            shows the actual artefact the product puts in front of you before it teaches: named
            parts, a current position, and the fact that you approve it. Static content, so it is
            hidden from assistive tech; the same information is in the copy beside it. */}
        <div
          className="hud-materialize overflow-hidden rounded-[var(--radius-lg)] border"
          style={{ borderColor: "var(--hud-line)", background: "var(--hud-bg-2)", animationDelay: "0.28s" }}
          aria-hidden="true"
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--hud-line)" }}
          >
            <span className="text-[0.78rem] font-medium text-[var(--hud-text)]">Cellular respiration</span>
            <span className="text-[0.7rem] text-[var(--hud-text-faint)]">9 parts · 24 min</span>
          </div>

          <ol className="divide-y" style={{ borderColor: "var(--hud-line)" }}>
            {[
              ["01", "Why cells need ATP at all", "done"],
              ["02", "Glycolysis, step by step", "done"],
              ["03", "The link reaction", "now"],
              ["04", "Krebs cycle", "next"],
              ["05", "The electron transport chain", "next"],
            ].map(([n, label, state]) => (
              <li key={n} className="flex items-center gap-3 px-4 py-2.5" style={{ borderColor: "var(--hud-line)" }}>
                <span
                  className="text-[0.68rem] tabular-nums"
                  style={{ color: state === "now" ? "var(--hud-cyan-bright)" : "var(--hud-text-faint)" }}
                >
                  {n}
                </span>
                <span
                  className="flex-1 truncate text-[0.82rem]"
                  style={{
                    color:
                      state === "now"
                        ? "var(--hud-text)"
                        : state === "done"
                          ? "var(--hud-text-dim)"
                          : "var(--hud-text-faint)",
                  }}
                >
                  {label}
                </span>
                {state === "now" && (
                  <span
                    className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[0.62rem] font-medium"
                    style={{ background: "var(--hud-cyan-glow)", color: "var(--hud-cyan-bright)" }}
                  >
                    teaching
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div
            className="flex items-center gap-2 border-t px-4 py-3"
            style={{ borderColor: "var(--hud-line)" }}
          >
            <Mic aria-hidden="true" size={12} strokeWidth={2} style={{ color: "var(--hud-cyan-bright)" }} />
            <span className="text-[0.72rem] text-[var(--hud-text-dim)]">
              Speaking — interrupt any time
            </span>
          </div>
        </div>
      </section>

      {/* CAPABILITIES */}
      <section className="mx-auto mt-24 max-w-6xl px-6">
        <div className="grid gap-8 border-t pt-10 sm:grid-cols-3" style={{ borderColor: "var(--hud-line)" }}>
          {CAPABILITIES.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="hud-materialize" style={{ animationDelay: `${0.06 * i}s` }}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} className="text-[var(--hud-text-faint)]" />
              <h2 className="mt-3.5 text-[0.98rem] font-medium text-[var(--hud-text)]">{title}</h2>
              <p className="mt-1.5 text-[0.88rem] leading-[1.65] text-[var(--hud-text-dim)]">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </HudPage>
  );
}
