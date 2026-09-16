"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, UploadCloud } from "lucide-react";

export type UploadedDocument = {
  id: string;
  name: string;
  sourceKind: "pdf" | "pptx";
  pageCount: number;
  bytes: number;
};

/**
 * The viewer's own entry screen: drag-and-drop or click to open a PDF or PowerPoint, with real
 * upload/conversion progress and an error state a student can recover from without reloading.
 *
 * TWO PHASES OF PROGRESS, HONESTLY LABELLED. The browser's own upload progress (bytes sent) and
 * the server's conversion step (a PPTX going through LibreOffice) are different kinds of waiting —
 * the first is bounded and the second is not, so they are shown as different messages rather than
 * one progress bar pretending to track both.
 */
export function UploadScreen({
  onOpened,
  recent,
}: {
  onOpened: (doc: UploadedDocument) => void;
  recent: UploadedDocument[];
}) {
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "converting" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);

  const upload = useCallback((file: File) => {
    setError(null);
    setPhase("uploading");
    setProgress(0);

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/viewer-documents");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgress(pct);
        // The upload itself finishes well before the response — a PPTX still has to be converted
        // server-side after every byte has arrived, which is real, unmeasurable time. Naming that
        // phase explicitly is what stops the bar from looking stuck at 100%.
        if (pct >= 100) setPhase("converting");
      }
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the generic error below.
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof data.id === "string") {
        setPhase("idle");
        onOpened({
          id: data.id,
          name: String(data.name ?? file.name),
          sourceKind: data.sourceKind === "pptx" ? "pptx" : "pdf",
          pageCount: Number(data.pageCount ?? 0),
          bytes: Number(data.bytes ?? file.size),
        });
        return;
      }
      setPhase("error");
      setError(typeof data.error === "string" ? data.error : "That file could not be opened.");
    };
    xhr.onerror = () => {
      setPhase("error");
      setError("Upload failed — check your connection and try again.");
    };
    xhr.send(form);
  }, [onOpened]);

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    upload(file);
  }, [upload]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="text-center">
        <h1 className="font-display text-2xl font-semibold text-[var(--hud-text)]">Document Viewer</h1>
        <p className="mt-2 text-sm text-[var(--hud-text-dim)]">
          Open a PDF or PowerPoint to read, search, highlight, and collect text from it.
        </p>
      </div>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current += 1;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current -= 1;
          if (dragCounterRef.current <= 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`relative w-full rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragging
            ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan-glow-soft)]"
            : "border-[var(--hud-line)] bg-[var(--hud-surface)]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label="Upload a PDF or PowerPoint file"
        />

        {phase === "uploading" || phase === "converting" ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-[var(--hud-cyan)]" />
            <p className="text-sm font-semibold text-[var(--hud-text)]">
              {phase === "uploading" ? `Uploading… ${progress}%` : "Converting for viewing…"}
            </p>
            {phase === "uploading" && (
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[var(--hud-line)]">
                <div
                  className="h-full rounded-full bg-[var(--hud-cyan)] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        ) : phase === "error" ? (
          <div className="flex flex-col items-center gap-3">
            <AlertCircle className="size-8 text-[var(--hud-danger)]" />
            <p className="max-w-sm text-sm text-[var(--hud-danger)]">{error}</p>
            <button
              onClick={() => setPhase("idle")}
              className="rounded-lg border border-[var(--hud-line)] px-4 py-2 text-xs font-semibold text-[var(--hud-text-dim)] transition hover:text-[var(--hud-text)]"
            >
              Try again
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-3"
          >
            <UploadCloud className="size-8 text-[var(--hud-cyan)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--hud-text)]">
                Drop a PDF or PowerPoint here, or click to browse
              </p>
              <p className="mt-1 text-xs text-[var(--hud-text-faint)]">Up to 100 MB, 600 pages</p>
            </div>
          </button>
        )}
      </div>

      {recent.length > 0 && phase === "idle" && (
        <div className="w-full">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--hud-text-faint)]">Recent documents</p>
          <div className="flex flex-col gap-1.5">
            {recent.slice(0, 5).map((doc) => (
              <button
                key={doc.id}
                onClick={() => onOpened(doc)}
                className="flex items-center gap-3 rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-2.5 text-left transition hover:border-[var(--hud-line-strong)]"
              >
                <FileText className="size-4 shrink-0 text-[var(--hud-text-faint)]" />
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--hud-text-dim)]">{doc.name}</span>
                <span className="shrink-0 text-xs text-[var(--hud-text-faint)]">{doc.pageCount} pages</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
