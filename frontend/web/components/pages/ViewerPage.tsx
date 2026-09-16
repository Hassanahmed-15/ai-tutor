"use client";

import { useEffect, useState } from "react";
import { UploadScreen, type UploadedDocument } from "@/components/viewer/UploadScreen";
import { DocumentViewer } from "@/components/viewer/DocumentViewer";

/**
 * The top-level page for the standalone document viewer: upload screen until a document is open,
 * then the viewer itself. `onExit` returns to wherever the student came from — this page owns no
 * navigation of its own beyond that, matching how every other top-level page in this app is a
 * component the central router (app/page.tsx) swaps in and out.
 */
export function ViewerPage({ onExit }: { onExit: () => void }) {
  const [openDoc, setOpenDoc] = useState<UploadedDocument | null>(null);
  const [recent, setRecent] = useState<UploadedDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/viewer-documents")
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((data) => {
        if (cancelled || !Array.isArray(data.documents)) return;
        setRecent(
          data.documents.map((d: { id: string; name: string; sourceKind: string; pageCount: number; bytes: number }) => ({
            id: d.id,
            name: d.name,
            sourceKind: d.sourceKind === "pptx" ? "pptx" : "pdf",
            pageCount: d.pageCount,
            bytes: d.bytes,
          })),
        );
      })
      .catch(() => {
        // The recent-documents list is a convenience, not a requirement — a failed fetch just
        // leaves it empty, and the upload screen still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="h-screen bg-[var(--hud-bg)]">
      {openDoc ? (
        <DocumentViewer doc={openDoc} onBack={() => setOpenDoc(null)} />
      ) : (
        <div className="relative h-full">
          <button
            onClick={onExit}
            className="absolute left-4 top-4 z-10 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--hud-text-faint)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
          >
            ← Back
          </button>
          <UploadScreen onOpened={setOpenDoc} recent={recent} />
        </div>
      )}
    </main>
  );
}
