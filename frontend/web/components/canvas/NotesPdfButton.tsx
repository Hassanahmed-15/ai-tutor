"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { NotesPdfAsked } from "@/lib/notes/notesHtml";

/** Prints the page in the browser, for a server with no browser of its own: "Save as PDF" in the print dialog. */
function printHere(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  frame.srcdoc = html;
  frame.onload = () => window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60_000); }, 800);
  document.body.append(frame);
}

/** "Download notes (PDF)": the lecture's notes in full (app/api/progressive-lectures/[id]/notes-pdf). */
export function NotesPdfButton({ sessionId, asked, className }: { sessionId: string; asked: NotesPdfAsked[]; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  async function download() {
    setState("busy");
    try {
      const res = await fetch(`/api/progressive-lectures/${encodeURIComponent(sessionId)}/notes-pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asked }) });
      if (!res.ok) throw new Error(String(res.status));
      if ((res.headers.get("content-type") ?? "").includes("application/pdf")) {
        const url = URL.createObjectURL(await res.blob());
        const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Aria-Notes.pdf");
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        printHere(((await res.json()) as { html: string }).html);
      }
      setState("idle");
    } catch {
      setState("failed");
    }
  }
  return (
    <button type="button" onClick={download} disabled={state === "busy"} data-notes-pdf="" className={className ?? "inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--hud-text)] underline-offset-4 hover:underline disabled:opacity-60"}>
      {state === "busy" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Download aria-hidden="true" size={15} />}
      {state === "busy" ? "Making your PDF…" : state === "failed" ? "Couldn't make it — try again" : "Download notes (PDF)"}
    </button>
  );
}
