"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";
import type { SlideBenchCase } from "@/lib/slidebench/cases";
import type { SlideBenchModel } from "@/lib/slidebench/models";
import type { SlideBenchRun } from "@/lib/slidebench/store";

/**
 * THE BENCH, side by side.
 *
 * Every board is rendered LIVE, in the same sandbox the real lecture player uses
 * (ReactAnimationSandbox → an opaque-origin iframe), driven by one shared progress slider. That is
 * the point of the layout: scrubbing all six at once is the only way to judge "animation quality
 * and smoothness", because a still frame cannot show whether a board moves in steps or glides, and
 * a per-card play button would have them out of phase with each other.
 *
 * The numbers under each board come from the run record, not from this component, so what you read
 * here is exactly what the DOCX report will say.
 */
export default function SlideBenchPage() {
  const [models, setModels] = useState<SlideBenchModel[]>([]);
  const [cases, setCases] = useState<SlideBenchCase[]>([]);
  const [runs, setRuns] = useState<SlideBenchRun[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [busy, setBusy] = useState<string[]>([]);
  const [progress, setProgress] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [showAddCase, setShowAddCase] = useState(false);
  const [draft, setDraft] = useState({ title: "", teachingPoint: "", script: "", physical: true });

  const load = useCallback(async () => {
    const response = await fetch("/api/slide-bench");
    if (!response.ok) {
      setError("The bench API is dev-only and did not respond.");
      return;
    }
    const data = await response.json();
    setModels(data.models ?? []);
    setCases(data.cases ?? []);
    setRuns(data.runs ?? []);
    setCaseId((current) => current || data.cases?.[0]?.id || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Newest run per model for the selected case — rerunning one model replaces only its cell. */
  const grid = useMemo(() => {
    const byModel = new Map<string, SlideBenchRun>();
    for (const run of runs) {
      if (run.caseId !== caseId) continue;
      byModel.set(run.modelId, run);
    }
    return models.map((model) => ({ model, run: byModel.get(model.id) ?? null }));
  }, [runs, models, caseId]);

  /** Spread of composite scores across every historical run — "consistency", measured. */
  const consistency = useMemo(() => {
    const out = new Map<string, { runs: number; mean: number; stdDev: number | null }>();
    for (const model of models) {
      const mine = runs.filter((run) => run.modelId === model.id && !run.providerError);
      if (!mine.length) continue;
      const scores = mine.map((run) => run.composite);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const stdDev = scores.length < 2
        ? null
        : Math.sqrt(scores.reduce((sum, v) => sum + (v - mean) ** 2, 0) / scores.length);
      out.set(model.id, { runs: scores.length, mean, stdDev });
    }
    return out;
  }, [runs, models]);

  const run = useCallback(
    async (modelIds: string[], customCase?: typeof draft) => {
      setBusy((current) => [...current, ...modelIds]);
      setError(null);
      try {
        const response = await fetch("/api/slide-bench", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId,
            modelIds,
            ...(customCase
              ? { customCase: { ...customCase, id: `custom-${Date.now().toString(36)}` } }
              : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Run failed.");
        await load();
        if (customCase) setCaseId(data.runs?.[0]?.caseId ?? caseId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy((current) => current.filter((id) => !modelIds.includes(id)));
      }
    },
    [caseId, load],
  );

  const activeCase = cases.find((entry) => entry.id === caseId);
  const money = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 5 : 3)}`;

  return (
    <main className="min-h-screen bg-[#0b0c10] px-6 py-8 text-[#e7e9ee]">
      <header className="mx-auto max-w-[1600px]">
        <h1 className="font-display text-2xl">Slide model bench</h1>
        <p className="mt-1 text-sm text-white/55">
          Every model gets the identical prompt for the selected case. Boards render live in the
          production sandbox and share one clock, so they can be compared while moving.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {cases.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setCaseId(entry.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                entry.id === caseId
                  ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                  : "border-white/12 text-white/65 hover:text-white"
              }`}
            >
              {entry.title}
              {!entry.physical && <span className="ml-2 text-[0.65rem] uppercase text-white/40">abstract</span>}
            </button>
          ))}
          <button
            onClick={() => setShowAddCase((v) => !v)}
            className="rounded-full border border-dashed border-white/25 px-3 py-1.5 text-sm text-white/60 hover:text-white"
          >
            + Add a case
          </button>
        </div>

        {showAddCase && (
          <div className="mt-4 space-y-2 rounded-xl border border-white/12 bg-white/[0.03] p-4">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Slide title"
              className="w-full rounded-md border border-white/12 bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={draft.teachingPoint}
              onChange={(e) => setDraft({ ...draft, teachingPoint: e.target.value })}
              placeholder="What must this slide teach? (required)"
              rows={2}
              className="w-full rounded-md border border-white/12 bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={draft.script}
              onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              placeholder="Narration it is drawn against"
              rows={2}
              className="w-full rounded-md border border-white/12 bg-transparent px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={draft.physical}
                onChange={(e) => setDraft({ ...draft, physical: e.target.checked })}
              />
              Physical subject — only these are shown to the shape critic (it wrongly condemns abstract boards).
            </label>
            <button
              disabled={!draft.teachingPoint.trim() || busy.length > 0}
              onClick={() => void run(models.map((m) => m.id), draft)}
              className="rounded-md border border-cyan-400/50 px-3 py-1.5 text-sm text-cyan-200 disabled:opacity-40"
            >
              Run this case on all models
            </button>
          </div>
        )}

        {activeCase && (
          <p className="mt-4 max-w-3xl text-sm text-white/50">
            <span className="text-white/75">Teaching point:</span> {activeCase.teachingPoint}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            onClick={() => void run(models.map((m) => m.id))}
            disabled={busy.length > 0 || !caseId}
            className="rounded-md border border-cyan-400/50 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 disabled:opacity-40"
          >
            {busy.length > 0 ? `Running ${busy.length}…` : "Run all models"}
          </button>
          <label className="flex flex-1 items-center gap-3 text-xs text-white/55">
            <span className="shrink-0">Scrub every board together</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="w-full max-w-md"
            />
            <span className="w-10 shrink-0 tabular-nums">{progress.toFixed(2)}</span>
          </label>
          <a href="/api/slide-bench/report" className="text-sm text-cyan-300 underline">
            Download DOCX report
          </a>
        </div>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </header>

      <section className="mx-auto mt-8 grid max-w-[1600px] gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {grid.map(({ model, run: record }) => {
          const stat = consistency.get(model.id);
          return (
            <article key={model.id} className="overflow-hidden rounded-xl border border-white/12 bg-white/[0.02]">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{model.label}</p>
                  <p className="truncate text-[0.7rem] text-white/40">
                    {model.provider} · {record?.apiKeyId ?? model.apiKeyEnv}
                  </p>
                </div>
                <button
                  onClick={() => void run([model.id])}
                  disabled={busy.includes(model.id)}
                  className="shrink-0 rounded border border-white/15 px-2 py-1 text-xs text-white/70 hover:text-white disabled:opacity-40"
                >
                  {busy.includes(model.id) ? "…" : "Rerun"}
                </button>
              </div>

              {/* The board itself, live and scrubbable — a still cannot show smoothness. */}
              <div className="relative aspect-[1000/560] bg-white">
                {record?.code && record.scores.compiles ? (
                  <ReactAnimationSandbox
                    key={`${record.runId}-${record.modelId}`}
                    code={record.code}
                    progress={progress}
                    sentenceIndex={0}
                    sentenceProgress={progress}
                    sentenceTotal={1}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-black/55">
                    {busy.includes(model.id)
                      ? "Generating…"
                      : record?.providerError
                        ? `Provider error — not a bad board: ${record.providerError.slice(0, 120)}`
                        : record
                          ? `Did not compile: ${record.scores.issues[0] ?? "unknown"}`
                          : "Not run yet."}
                  </div>
                )}
              </div>

              {record && (
                <div className="space-y-2 px-4 py-3 text-xs">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/70">
                    <span className="font-medium text-white">Score {record.composite}/100</span>
                    <span>{(record.latencyMs / 1000).toFixed(1)}s</span>
                    <span>{money(record.costUsd)}</span>
                    <span>
                      {record.promptTokens}→{record.outputTokens} tok
                      {record.thinkingTokens > 0 && ` (${record.thinkingTokens} thinking)`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/45">
                    <span>vision {record.visionScore ?? "n/a"}/5</span>
                    <span>{record.scores.progressDrivenValues} animated values</span>
                    <span>{record.scores.labelCount} labels</span>
                    <span>{record.scores.shapeVariety} shape kinds</span>
                    {stat && (
                      <span title="Spread of this model's composite scores across every run">
                        consistency ±{stat.stdDev === null ? "—" : stat.stdDev.toFixed(1)} ({stat.runs} runs)
                      </span>
                    )}
                  </div>
                  {record.scores.issues.length > 0 && (
                    <p className="text-amber-300/80">{record.scores.issues.join(" · ")}</p>
                  )}
                  {record.visionNote && <p className="text-white/40">{record.visionNote}</p>}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
