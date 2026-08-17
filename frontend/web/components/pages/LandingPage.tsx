"use client";

import { useRef, useState } from "react";
import { ArrowRight, FileUp, Paperclip, X } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { setPendingBrief } from "@/lib/pendingBrief";

/**
 * The front page. One panel, centred, and nothing else.
 *
 * Everything else has been removed on purpose: no masthead, no navigation, no feature columns, no
 * preview, no footer. Previous versions of this page carried all of that and the result was either
 * empty-looking or busy — the actual product does one thing, so the door to it should offer one
 * thing.
 *
 * What is left is the wordmark and the way in: type a subject, or attach a PDF or deck. The
 * handoff to LearnPage carries whatever was provided via sessionStorage, because the router only
 * passes a page name and this page has no other channel to it. LearnPage owns the parsing pipeline
 * and keeps owning it — nothing about upload handling is duplicated here.
 */
export function LandingPage({ go }: { go: (p: PageName) => void; onStart: () => void }) {
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canStart = topic.trim().length > 0 || file !== null;

  function start() {
    if (!canStart) return;
    // The file itself is handed over, not just its name — the student chose it here and must not
    // be asked to choose it again on the next screen.
    setPendingBrief({ topic: topic.trim(), file });
    go("learn");
  }

  return (
    <main className="hud-canvas hud-grain relative flex min-h-screen items-center justify-center px-6">
      <div className="relative z-10 w-full max-w-xl text-center">
        <h1 className="hud-materialize font-display text-[3.6rem] leading-none tracking-[-0.04em] text-[var(--hud-text)] sm:text-[4.6rem]">
          Aria
        </h1>
        <p
          className="hud-materialize mt-3 text-[0.95rem] text-[var(--hud-text-dim)]"
          style={{ animationDelay: "0.08s" }}
        >
          Teach me anything.
        </p>

        <form
          className="hud-materialize mt-10"
          style={{ animationDelay: "0.16s" }}
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          {/* One composed field: the text input and the attach control share a border so they read
              as a single place to begin, rather than two competing entry points. */}
          <div
            className="flex items-center gap-2 rounded-[var(--radius-lg)] border px-2 py-2 transition-colors focus-within:border-[var(--hud-line-strong)]"
            style={{
              background: "var(--hud-surface)",
              borderColor: "var(--hud-line)",
              transitionDuration: "var(--motion-fast)",
            }}
          >
            <label htmlFor="brief" className="sr-only">
              What should Aria teach?
            </label>
            {/* A textarea, not an input, so a long brief stays visible.
                A single-line input scrolls the beginning of the text out of sight the moment it
                overflows — a student writing a real question could not read back what they had
                written. This grows to a cap and then scrolls. Enter still submits (Shift+Enter for
                a newline), so the quick path is unchanged. */}
            <textarea
              id="brief"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start();
                }
              }}
              rows={1}
              placeholder="Explain the Krebs cycle…"
              autoFocus
              className="min-w-0 flex-1 resize-none self-center bg-transparent px-3 py-2 text-[0.98rem] leading-relaxed text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none"
            />

            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.pptx,.ppt,.docx,.doc,.json"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-label="Attach a PDF, slide deck, or document"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a PDF, slide deck, or document"
              className="grid size-9 shrink-0 place-items-center rounded-[var(--radius)] text-[var(--hud-text-faint)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)]"
              style={{ transitionDuration: "var(--motion-fast)" }}
            >
              <Paperclip aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>

            <button
              type="submit"
              disabled={!canStart}
              aria-label="Start the lesson"
              className="hud-btn-primary grid size-9 shrink-0 place-items-center disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowRight aria-hidden="true" size={17} strokeWidth={2.2} />
            </button>
          </div>

          {/* An explicit drop zone.
              The paperclip alone was too quiet for something that is half the product — a student
              who has a lecture PDF in hand should see that this accepts it without hunting for an
              icon. Drag-and-drop AND a click target, because both are expected of an upload area,
              and it collapses once a file is chosen so it never competes with the field above. */}
          {!file && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              onClick={() => fileRef.current?.click()}
              className="mt-3 cursor-pointer rounded-[var(--radius-lg)] border border-dashed px-4 py-5 text-center transition-colors"
              style={{
                borderColor: dragging ? "var(--hud-cyan)" : "var(--hud-line)",
                background: dragging ? "var(--hud-surface-2)" : "transparent",
                transitionDuration: "var(--motion-fast)",
              }}
            >
              <div className="flex items-center justify-center gap-2 text-[var(--hud-text-dim)]">
                <FileUp aria-hidden="true" size={16} strokeWidth={1.8} />
                <span className="text-[0.86rem]">
                  Drop a PDF or slide deck, or <span className="text-[var(--hud-cyan-bright)]">browse</span>
                </span>
              </div>
              <p className="mt-1.5 text-[0.72rem] text-[var(--hud-text-faint)]">
                PDF · PPTX · DOCX — the lesson is built from its pages
              </p>
            </div>
          )}

          {/* The attached file, once chosen. Replaces the drop zone rather than adding to it. */}
          {file && (
            <div className="mt-3 flex items-center justify-center">
              <span
                className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius)] border px-3 py-1.5"
                style={{ borderColor: "var(--hud-line)", background: "var(--hud-surface)" }}
              >
                <Paperclip aria-hidden="true" size={12} className="shrink-0 text-[var(--hud-text-faint)]" />
                <span className="truncate text-[0.8rem] text-[var(--hud-text-dim)]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--hud-text-faint)] transition-colors hover:text-[var(--hud-text)]"
                >
                  <X aria-hidden="true" size={13} />
                </button>
              </span>
            </div>
          )}
        </form>

      </div>
    </main>
  );
}
