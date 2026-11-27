"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Check, Images, Loader2, Plus, RotateCcw, Send, Trash2, TriangleAlert } from "lucide-react";

/**
 * THE PHONE'S SIDE OF THE QR CAPTURE. The phone's own camera takes each page (a file input with `capture`, which
 * needs no camera permission prompt and no HTTPS); the photo is shrunk here (≤2200 px JPEG) and uploaded at once,
 * so Aria reads it while the next one is being taken. A bad shot is flagged within a couple of seconds.
 *
 * The "+" and Retake controls are <label>s of the file input, not buttons that click it from a script: the camera
 * opens natively on the tap, which every phone browser allows (a scripted click on a hidden input is what some
 * refuse), and they appear only once this page's script runs, so a tap is never lost on a page that cannot upload.
 */

const INPUT_ID = "capture-photo-input";
const GALLERY_ID = "capture-gallery-input";

type SlotState = "uploading" | "reading" | "ready" | "failed" | "held" | "error";
type Slot = { n: number; version: number; state: SlotState; problem: string | null; error: string | null; preview?: string };
type Server = { status: "waiting" | "connected" | "sent" | "cancelled" | "expired"; order: number[]; slots: Array<{ n: number; version: number; state: SlotState; problem: string | null; error: string | null }> };

const MAX = 6;
const PROBLEM: Record<string, string> = { blurry: "Looks blurry — retake?", dark: "Too dark to read", "no-page": "No page found" };

/** The photo as a ≤2200 px JPEG (measured 2026-11-25: half that still read as well); the browser applies the camera's orientation when it decodes. */
const MAX_SIDE = 2200;
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the photo"))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhoneCapture({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [status, setStatus] = useState<Server["status"] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const retakeRef = useRef<number | null>(null);

  useEffect(() => {
    const key = `aria.capture.${id}`;
    const fromUrl = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");
    let t = fromUrl;
    // Kept for this tab, so a reload (development reloads the page by itself) does not lose the link's key…
    try {
      if (fromUrl) sessionStorage.setItem(key, fromUrl);
      else t = sessionStorage.getItem(key);
    } catch { /* private mode: the URL's key is all there is */ }
    queueMicrotask(() => (t ? setToken(t) : setFatal("This link is incomplete. Scan the code on your computer again.")));
    // …and out of the address bar (and so out of a shared screenshot of it).
    if (fromUrl) window.history.replaceState(null, "", window.location.pathname);
  }, [id]);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/capture/${id}${path}`, { ...init, headers: { ...(init.headers ?? {}), "x-capture-token": token ?? "" }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || res.status === 410) setFatal(data.error || "This code no longer works. Scan the code on your computer again.");
    return { ok: res.ok, data };
  }, [id, token]);

  // What the server knows: each photo's reading, the computer closing the capture.
  useEffect(() => {
    if (!token || fatal) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const { ok, data } = await call("/phone").catch(() => ({ ok: false, data: null }));
      if (!stop && ok && data) {
        const s = data as Server;
        setStatus(s.status);
        setSlots((prev) => prev.map((slot) => {
          const server = s.slots.find((x) => x.n === slot.n);
          if (!server || server.version !== slot.version || slot.state === "uploading") return slot;
          return { ...slot, state: server.state, problem: server.problem, error: server.error };
        }));
      }
      if (!stop && (status !== "sent")) setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; };
  }, [token, fatal, call, status]);

  const live = slots.filter((s) => s.state !== "error" || s.preview);
  const ordered = order.map((n) => live.find((s) => s.n === n)).filter((s): s is Slot => Boolean(s));

  const upload = async (n: number, photo: Blob, preview: string) => {
    setSlots((prev) => [...prev.filter((s) => s.n !== n), { n, version: (prev.find((s) => s.n === n)?.version ?? 0) + 1, state: "uploading", problem: null, error: null, preview }]);
    setOrder((prev) => (prev.includes(n) ? prev : [...prev, n]));
    for (let attempt = 0; attempt < 3; attempt++) {
      const form = new FormData();
      form.append("photo", photo, `page-${n}.jpg`);
      const { ok, data } = await call(`/photo?n=${n}`, { method: "POST", body: form }).catch(() => ({ ok: false, data: { error: "No connection" } }));
      if (ok) {
        setSlots((prev) => prev.map((s) => (s.n === n ? { ...s, version: data.version, state: data.state, problem: data.problem ?? null } : s)));
        return;
      }
      if (data?.error && attempt === 2) setSlots((prev) => prev.map((s) => (s.n === n ? { ...s, state: "error", error: data.error } : s)));
      await new Promise((r) => setTimeout(r, 1200));
    }
  };

  /** Photos from the camera (one) or the gallery (several at once): each takes the next free page, or the one retaken. */
  const onPicked = async (files: File[]) => {
    if (!files.length) return;
    const used = new Set(slots.map((s) => s.n));
    const free = Array.from({ length: MAX }, (_, i) => i + 1).filter((k) => !used.has(k));
    const targets = retakeRef.current ? [retakeRef.current] : free;
    retakeRef.current = null;
    const picked = files.filter((f) => f.type.startsWith("image/") || f.type === "").slice(0, targets.length);
    await Promise.all(picked.map(async (file, i) => {
      const n = targets[i];
      try {
        const photo = await shrink(file);
        await upload(n, photo, URL.createObjectURL(photo));
      } catch {
        setOrder((prev) => (prev.includes(n) ? prev : [...prev, n]));
        setSlots((prev) => [...prev.filter((s) => s.n !== n), { n, version: 0, state: "error", problem: null, error: "That photo could not be opened." }]);
      }
    }));
  };
  const takeFrom = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void onPicked(files);
  };

  const remove = async (n: number) => {
    setSlots((prev) => prev.filter((s) => s.n !== n));
    const next = order.filter((k) => k !== n);
    setOrder(next);
    await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", n }) });
    await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "order", order: next }) });
  };

  const move = async (n: number, by: -1 | 1) => {
    const i = order.indexOf(n);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "order", order: next }) });
  };

  const readAnyway = async (n: number) => {
    setSlots((prev) => prev.map((s) => (s.n === n ? { ...s, state: "reading" } : s)));
    await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "use", n }) });
  };

  const send = async () => {
    setSending(true);
    await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "order", order }) });
    const { ok } = await call("/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
    if (ok) setStatus("sent");
    setSending(false);
  };

  const usable = ordered.filter((s) => s.state === "ready" || s.state === "reading").length;
  const busy = ordered.some((s) => s.state === "uploading");

  if (fatal) return <Screen><TriangleAlert className="mx-auto text-[var(--hud-warn)]" size={28} /><p className="mt-3 text-center text-[1rem] text-[var(--hud-text)]">{fatal}</p></Screen>;
  if (status === "sent") return <Screen><Check className="mx-auto text-[var(--hud-cyan)]" size={32} /><p className="mt-3 text-center font-display text-[1.4rem] text-[var(--hud-text)]">Sent to Aria</p><p className="mt-1 text-center text-[0.9rem] text-[var(--hud-text-dim)]">Carry on on your computer.</p></Screen>;
  if (status === "cancelled" || status === "expired") return <Screen><p className="text-center text-[1rem] text-[var(--hud-text)]">This code {status === "expired" ? "has expired" : "was closed"}. Ask for a new one on your computer.</p></Screen>;

  const room = ordered.length < MAX;

  return (
    <main className="hud-canvas theme-glow min-h-screen px-4 pb-32 pt-5">
      <input id={INPUT_ID} ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={takeFrom} />
      {/* No `capture`: the phone offers its gallery and files (several at once). */}
      <input id={GALLERY_ID} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={takeFrom} />
      <h1 className="font-display text-[1.6rem] leading-tight text-[var(--hud-text)]">Add your pages</h1>
      <p className="mt-1 text-[0.9rem] text-[var(--hud-text-dim)]">Take a photo with the camera, or choose photos already on your phone. Each one goes to your computer the moment you add it — up to 6 pages.</p>

      {!token ? (
        <div className="mt-10 flex flex-col items-center gap-3 text-center text-[0.9rem] text-[var(--hud-text-dim)]">
          <Loader2 className="animate-spin" size={26} />
          <p>Connecting to your computer…</p>
          <p className="text-[0.78rem] text-[var(--hud-text-faint)]">If this does not go away, check that your phone is on the same Wi-Fi as your computer, then scan the code again.</p>
        </div>
      ) : ordered.length === 0 ? (
        <div className="mx-auto mt-8 grid w-full max-w-sm gap-3">
          <label htmlFor={INPUT_ID} onClick={() => { retakeRef.current = null; }} className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--hud-cyan)] px-4 py-8 text-[var(--hud-cyan)] active:scale-[0.98]">
            <span className="grid size-20 place-items-center rounded-full bg-[var(--hud-cyan)] text-[var(--hud-bg)] shadow-lg"><Camera size={38} strokeWidth={2.2} /></span>
            <span className="text-[1.05rem] font-semibold">Take a photo</span>
            <span className="-mt-2 text-[0.8rem] text-[var(--hud-text-dim)]">Hold the phone straight above the page, in good light.</span>
          </label>
          <label htmlFor={GALLERY_ID} onClick={() => { retakeRef.current = null; }} className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[var(--hud-line-strong)] px-4 py-4 text-[1rem] font-semibold text-[var(--hud-text)] active:scale-[0.98]">
            <Images size={20} /> Choose from gallery or files
          </label>
        </div>
      ) : null}

      <ol className="mt-4 space-y-2">
        {ordered.map((s, i) => (
          <li key={s.n} className="flex items-center gap-3 rounded-xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- the student's own photo, from this phone */}
            {s.preview ? <img src={s.preview} alt={`Page ${i + 1}`} className="h-20 w-16 shrink-0 rounded-md object-cover" /> : <div className="h-20 w-16 shrink-0 rounded-md bg-[var(--hud-surface-2)]" />}
            <div className="min-w-0 flex-1">
              <p className="text-[0.95rem] font-semibold text-[var(--hud-text)]">Page {i + 1}</p>
              <p className={`flex items-center gap-1 text-[0.8rem] ${s.state === "ready" ? "text-[var(--hud-cyan)]" : s.state === "failed" || s.state === "error" || s.state === "held" || s.problem ? "text-[var(--hud-warn)]" : "text-[var(--hud-text-dim)]"}`}>
                {s.state === "uploading" ? <><Loader2 size={13} className="animate-spin" /> Sending to your computer…</>
                  : s.state === "reading" ? <><Loader2 size={13} className="animate-spin" /> {s.problem ? PROBLEM[s.problem] : "On your computer · Aria is reading it…"}</>
                  : s.state === "ready" ? <><Check size={13} /> {s.problem ? PROBLEM[s.problem] : "On your computer · read"}</>
                  : s.state === "held" ? <><TriangleAlert size={13} /> {PROBLEM[s.problem ?? ""] ?? "Check this photo"}</>
                  : <><TriangleAlert size={13} /> {s.error || "Could not be read — retake"}</>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <label htmlFor={INPUT_ID} onClick={() => { retakeRef.current = s.n; }} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-[var(--hud-line)] px-2.5 text-[0.78rem] text-[var(--hud-text)]"><RotateCcw size={13} /> Retake</label>
                {s.state === "held" && <SmallButton onClick={() => void readAnyway(s.n)}>Use anyway</SmallButton>}
                <SmallButton onClick={() => void remove(s.n)} label="Delete"><Trash2 size={13} /></SmallButton>
                <SmallButton onClick={() => void move(s.n, -1)} label="Move up" disabled={i === 0}><ArrowUp size={13} /></SmallButton>
                <SmallButton onClick={() => void move(s.n, 1)} label="Move down" disabled={i === ordered.length - 1}><ArrowDown size={13} /></SmallButton>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* "+" on the right, by the thumb — and clear of the development badge Next.js puts at the bottom left. */}
      <div className="fixed inset-x-0 bottom-0 flex flex-row-reverse items-center gap-3 border-t border-[var(--hud-line)] bg-[var(--hud-bg)]/95 p-3 backdrop-blur">
        {token && ordered.length > 0 && (room ? (
          <>
            <label htmlFor={INPUT_ID} onClick={() => { retakeRef.current = null; }} aria-label={`Take photo of page ${ordered.length + 1}`} className="grid size-14 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--hud-cyan)] text-[var(--hud-bg)] shadow-lg active:scale-95">
              <Plus size={30} strokeWidth={2.5} />
            </label>
            <label htmlFor={GALLERY_ID} onClick={() => { retakeRef.current = null; }} aria-label="Add photos from gallery or files" className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border border-[var(--hud-line-strong)] text-[var(--hud-text)] active:scale-95">
              <Images size={20} />
            </label>
          </>
        ) : (
          <span title="6 pages is the most" className="grid size-14 shrink-0 place-items-center rounded-full border border-[var(--hud-line)] text-[var(--hud-text-faint)]"><Camera size={18} /></span>
        ))}
        <button type="button" disabled={!usable || busy || sending} onClick={() => void send()} className="hud-btn-primary flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[1rem] disabled:opacity-50">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {usable ? `Done — teach me ${usable} page${usable === 1 ? "" : "s"}` : "Add a page first"}
        </button>
      </div>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="hud-canvas theme-glow grid min-h-screen place-items-center px-6"><div className="max-w-sm">{children}</div></main>;
}

function SmallButton({ children, onClick, label, disabled }: { children: React.ReactNode; onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--hud-line)] px-2.5 text-[0.78rem] text-[var(--hud-text)] disabled:opacity-40">
      {children}
    </button>
  );
}
