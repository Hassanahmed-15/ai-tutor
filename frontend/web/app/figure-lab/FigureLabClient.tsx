"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryAsset } from "@/lib/figures/libraryIndex";

type Filter = "todo" | "approved" | "rejected" | "all";

const status = (a: LibraryAsset) => (a.rejected ? "rejected" : a.reviewed ? "approved" : "todo");

/**
 * Review one diagram at a time, fast: J/K or ←/→ to move, A to approve, R to reject, U to undo a
 * verdict, S to save name edits. Every anchor is drawn on the art with its part name, so a dot on
 * the wrong part is obvious; drop the part (×) or rename it, then approve.
 */
export function FigureLabClient() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [filter, setFilter] = useState<Filter>("todo");
  const [at, setAt] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/figure-lab").then((r) => r.json()).then((j: { assets: LibraryAsset[] }) => setAssets(j.assets ?? [])).catch(() => setError("Could not load the library index."));
  }, []);

  const list = useMemo(() => assets.filter((a) => filter === "all" || status(a) === filter), [assets, filter]);
  const asset = list[Math.min(at, Math.max(0, list.length - 1))];
  const counts = useMemo(() => ({ todo: assets.filter((a) => status(a) === "todo").length, approved: assets.filter((a) => status(a) === "approved").length, rejected: assets.filter((a) => status(a) === "rejected").length, all: assets.length }), [assets]);

  const pick = useCallback((i: number) => { setAt(i); setNames({}); setDrop(new Set()); }, []);

  const send = useCallback(async (action: "approve" | "reject" | "reset" | "save") => {
    if (!asset || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/figure-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asset.id, action, names, drop: [...drop] }) });
      const j = (await res.json()) as { asset?: LibraryAsset; error?: string };
      if (!res.ok || !j.asset) throw new Error(j.error ?? "save failed");
      setAssets((all) => all.map((a) => (a.id === j.asset!.id ? j.asset! : a)));
      setNames({});
      setDrop(new Set());
      // After a verdict the item leaves a filtered list, so the same index now shows the next one.
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }, [asset, busy, names, drop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "arrowright") pick(Math.min(list.length - 1, at + 1));
      else if (k === "k" || k === "arrowleft") pick(Math.max(0, at - 1));
      else if (k === "a") void send("approve");
      else if (k === "r") void send("reject");
      else if (k === "u") void send("reset");
      else if (k === "s") void send("save");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, list.length, pick, send]);

  const dot = asset ? Math.max(asset.w, asset.h) / 140 : 4;
  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Nunito, system-ui, sans-serif", background: "#f6f3ea", color: "#1f2937" }}>
      <aside style={{ width: 280, borderRight: "1px solid #e5e0d4", overflowY: "auto", padding: 12, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "4px 0 10px" }}>Figure lab</h1>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
          {(["todo", "approved", "rejected", "all"] as Filter[]).map((f) => (
            <button key={f} onClick={() => { setFilter(f); pick(0); }} style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid #d6cfbf", background: filter === f ? "#1f2937" : "#fff", color: filter === f ? "#fff" : "#1f2937", fontSize: 12 }}>
              {f} {counts[f]}
            </button>
          ))}
        </div>
        {list.map((a, i) => (
          <button key={a.id} onClick={() => pick(i)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 2, borderRadius: 8, border: "none", background: a.id === asset?.id ? "#fde68a" : "transparent", fontSize: 13, cursor: "pointer" }}>
            <div style={{ fontWeight: 700 }}>{a.title}</div>
            <div style={{ color: "#6b7280", fontSize: 11 }}>{a.seed} · {a.parts.filter((p) => p.confidence === "high").length} exact · {a.parts.filter((p) => p.confidence === "low").length} guessed</div>
          </button>
        ))}
      </aside>
      <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        {!asset ? (
          <p>Nothing here. Run scripts/figures/harvest-library.mts then normalise-library.mts.</p>
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{asset.title}</h2>
                <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: status(asset) === "approved" ? "#bbf7d0" : status(asset) === "rejected" ? "#fecaca" : "#e5e7eb" }}>{status(asset)}</span>
              </div>
              <svg viewBox={`0 0 ${asset.w} ${asset.h}`} style={{ width: "100%", maxHeight: "78vh", background: "#fff", borderRadius: 12, border: "1px solid #e5e0d4" }}>
                <image href={`/api/figure-lab?svg=${asset.id}`} x={0} y={0} width={asset.w} height={asset.h} />
                {asset.parts.filter((p) => !drop.has(p.id)).map((p) => (
                  <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
                    <circle cx={p.anchor.x} cy={p.anchor.y} r={dot * (hover === p.id ? 1.8 : 1)} fill={p.confidence === "high" ? "#16a34a" : "#f59e0b"} stroke="#fff" strokeWidth={dot / 3} />
                    <text x={p.anchor.x + dot * 1.6} y={p.anchor.y + dot * 0.9} fontSize={dot * 2.6} fontWeight={800} fill="#111827" stroke="#fff" strokeWidth={dot * 0.6} paintOrder="stroke">
                      {names[p.id] ?? p.name}
                    </text>
                  </g>
                ))}
              </svg>
              <p style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                {asset.credit} · <a href={asset.source.url} target="_blank" rel="noreferrer">source</a> · licence <a href={asset.source.licenceUrl} target="_blank" rel="noreferrer">{asset.source.licence}</a> · revision {asset.source.revision} · {Math.round(asset.w)}×{Math.round(asset.h)}
              </p>
            </div>
            <div style={{ width: 340, flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button disabled={busy} onClick={() => send("approve")} style={btn("#16a34a")}>Approve (A)</button>
                <button disabled={busy} onClick={() => send("reject")} style={btn("#dc2626")}>Reject (R)</button>
                <button disabled={busy} onClick={() => send("save")} style={btn("#374151")}>Save (S)</button>
              </div>
              <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 8px" }}>J/K or ←/→ move · U undo verdict · green = traced along its leader · amber = guessed</p>
              {asset.parts.map((p) => (
                <div key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, opacity: drop.has(p.id) ? 0.35 : 1 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: p.confidence === "high" ? "#16a34a" : "#f59e0b", flexShrink: 0 }} />
                  <input value={names[p.id] ?? p.name} onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))} style={{ flex: 1, fontSize: 13, padding: "3px 6px", border: "1px solid #d6cfbf", borderRadius: 6, background: hover === p.id ? "#fef3c7" : "#fff" }} />
                  <button title="drop this part" onClick={() => setDrop((d) => { const n = new Set(d); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const btn = (bg: string) => ({ flex: 1, padding: "8px 10px", border: "none", borderRadius: 8, background: bg, color: "#fff", fontWeight: 800, cursor: "pointer" });
