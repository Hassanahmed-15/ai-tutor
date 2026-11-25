"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Smartphone, TriangleAlert, X } from "lucide-react";
import { ensureSpendTag } from "@/lib/spendTag";
import type { CapturedDocument } from "@/lib/pendingBrief";

/**
 * "USE YOUR PHONE" ON THE COMPUTER (the QR capture). A QR code the student scans; their photos appear here as they
 * take them, each read the moment it arrives; "Use these pages" (or the phone's Send) assembles them into one
 * document and hands it on — the same next step as a PDF's pages: reference or strict.
 */

type Slot = { n: number; version: number; state: "reading" | "ready" | "failed" | "held" | "deleted"; problem: string | null; error: string | null };
type Status = { status: "waiting" | "connected" | "sent" | "cancelled" | "expired"; expiresAt: number; order: number[]; slots: Slot[] };
type Created = { id: string; url: string; qrSvg: string; lan: boolean; expiresAt: number };

const PROBLEM: Record<string, string> = { blurry: "blurry", dark: "too dark", "no-page": "no page found" };

export function PhoneCapturePanel({ onClose, onDocument }: { onClose: () => void; onDocument: (doc: CapturedDocument) => void }) {
  const [created, setCreated] = useState<Created | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const doneRef = useRef(false);

  const create = useCallback(async () => {
    setError(null);
    setStatus(null);
    setCreated(null);
    try {
      ensureSpendTag();
      const res = await fetch("/api/capture", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not start the phone capture.");
      setCreated(data as Created);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Exactly one capture per panel: development runs effects twice, and a second session made the panel watch a
  // code the phone never scanned.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void create();
  }, [create]);

  const finish = useCallback(async () => {
    if (!created || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/capture/${created.id}/finish`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The pages could not be read.");
      doneRef.current = true;
      onDocument(data as CapturedDocument);
    } catch (e) {
      setError((e as Error).message);
      finishingRef.current = false;
      setFinishing(false);
    }
  }, [created, onDocument]);

  // Polled every second: the phone connecting, each photo arriving and being read, the phone's Send.
  useEffect(() => {
    if (!created) return;
    let stop = false;
    const tick = async () => {
      if (stop || doneRef.current) return;
      const res = await fetch(`/api/capture/${created.id}`, { cache: "no-store" }).catch(() => null);
      const data = res && res.ok ? ((await res.json().catch(() => null)) as Status | null) : null;
      if (!stop && data) setStatus(data);
      if (!stop) setTimeout(tick, 1000);
    };
    void tick();
    return () => { stop = true; };
  }, [created]);

  const live = (status?.slots ?? []).filter((s) => s.state !== "deleted");
  const ordered = [...live].sort((a, b) => {
    const ia = status?.order.indexOf(a.n) ?? -1;
    const ib = status?.order.indexOf(b.n) ?? -1;
    return (ia < 0 ? 99 + a.n : ia) - (ib < 0 ? 99 + b.n : ib);
  });
  const ready = live.filter((s) => s.state === "ready").length;
  const reading = live.filter((s) => s.state === "reading").length;
  const usable = ready > 0;

  // The phone pressed Send: carry on by ourselves once nothing is still being read.
  useEffect(() => {
    if (status?.status === "sent" && usable && reading === 0 && !finishingRef.current && !doneRef.current) void finish();
  }, [status?.status, usable, reading, finish]);

  const close = () => {
    if (created && !doneRef.current) void fetch(`/api/capture/${created.id}`, { method: "DELETE" }).catch(() => undefined);
    onClose();
  };

  const expired = status?.status === "expired" || status?.status === "cancelled";
  const connected = status && status.status !== "waiting";

  return (
    <div role="dialog" aria-modal="true" aria-label="Use your phone" className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={close}>
      <div className="w-full max-w-[560px] rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 shadow-[var(--elev-2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[1.35rem] text-[var(--hud-text)]"><Smartphone size={20} /> Use your phone</h2>
            <p className="mt-1 text-[0.85rem] text-[var(--hud-text-dim)]">Scan the code with your phone&apos;s camera, then take or choose up to 6 pages. Aria reads each one as it arrives.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="grid size-8 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"><X size={18} /></button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col items-center gap-2">
            {created && !expired ? (
              <div className="size-[220px] overflow-hidden rounded-xl bg-white p-2 [&_svg]:block [&_svg]:h-full [&_svg]:w-full" role="img" aria-label="QR code to open on your phone" dangerouslySetInnerHTML={{ __html: created.qrSvg }} />
            ) : (
              <div className="grid size-[220px] place-items-center rounded-xl border border-dashed border-[var(--hud-line)] text-center text-[0.8rem] text-[var(--hud-text-dim)]">
                {expired ? <button type="button" onClick={() => void create()} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hud-line)] px-3 py-1.5 text-[var(--hud-text)]"><RefreshCw size={14} /> New code</button> : <Loader2 className="animate-spin" size={20} />}
              </div>
            )}
            <p className="text-center text-[0.72rem] text-[var(--hud-text-faint)]">
              {expired ? "This code has expired." : connected ? "Phone connected" : "Waiting for your phone…"}
            </p>
            {created?.lan && !expired && <p className="text-center text-[0.7rem] text-[var(--hud-text-faint)]">Your phone must be on the same Wi-Fi as this computer.</p>}
          </div>

          <div className="flex min-h-[220px] flex-col">
            <p className="text-[0.8rem] font-semibold text-[var(--hud-text-dim)]">{live.length ? `${live.length} of 6 page${live.length === 1 ? "" : "s"}` : "Your photos appear here"}</p>
            <div className="mt-2 grid flex-1 grid-cols-3 content-start gap-2">
              {ordered.map((s, i) => (
                <figure key={`${s.n}-${s.version}`} className="relative overflow-hidden rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface-2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-student thumbnail */}
                  <img src={`/api/capture/${created?.id}/thumb/${s.n}?v=${s.version}`} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                  <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/60 px-1.5 py-1 text-[0.66rem] text-white">
                    {s.state === "ready" ? <Check size={11} /> : s.state === "reading" ? <Loader2 size={11} className="animate-spin" /> : <TriangleAlert size={11} />}
                    <span>Page {i + 1}</span>
                    <span className="ml-auto opacity-80">{s.state === "ready" ? "ready" : s.state === "reading" ? "reading" : s.state === "held" ? PROBLEM[s.problem ?? ""] ?? "check" : "retake"}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            {error && <p role="alert" className="mt-2 text-[0.8rem] text-[var(--hud-danger)]">{error}</p>}
            <button
              type="button"
              disabled={!usable || reading > 0 || finishing}
              onClick={() => void finish()}
              className="hud-btn-primary mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[0.9rem] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {finishing ? <><Loader2 size={16} className="animate-spin" /> Aria is putting your pages together…</> : reading > 0 ? <><Loader2 size={16} className="animate-spin" /> Reading {reading} page{reading === 1 ? "" : "s"}…</> : `Use ${ready || ""} page${ready === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
