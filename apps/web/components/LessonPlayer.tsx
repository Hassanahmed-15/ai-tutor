"use client";

import { useState } from "react";
import { Whiteboard } from "./Whiteboard";

interface NarrationUnit {
  text: string;
  emphasis?: boolean;
}

interface RenderedBeat {
  nodeId: string;
  narration: NarrationUnit[];
  captions?: string[];
  drawCommands?: { primitive: string; elements: unknown[]; relations: unknown[] };
  pacingMultiplier?: number;
}

interface RenderedAnnotation {
  branchId: string;
  description: string;
}

interface LessonNode {
  id: string;
  type: string;
  checkpoint?: { prompt: string; expectedAnswerKind: string };
  citations?: { sourceTitle: string; locator?: string }[];
}

interface LessonGraph {
  id: string;
  subject: string;
  topic: string;
  nodes: LessonNode[];
  currentNodeId: string | null;
}

interface SessionView {
  sessionId?: string;
  graph: LessonGraph;
  currentBeat: RenderedBeat | null;
  activeAnnotation: RenderedAnnotation | null;
}

type LensId = "default" | "dyslexia";

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

export function LessonPlayer() {
  const [lens, setLens] = useState<LensId>("default");
  const [view, setView] = useState<SessionView | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [interruptText, setInterruptText] = useState("");
  const [checkpointText, setCheckpointText] = useState("");
  const [checkpointFeedback, setCheckpointFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLesson() {
    setLoading(true);
    setError(null);
    setCheckpointFeedback(null);
    try {
      const data = await postJSON<SessionView & { sessionId: string }>("/api/session", {
        subject: "cs-fundamentals",
        topic: "binary-search",
        lens,
      });
      setSessionId(data.sessionId);
      setView(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start lesson");
    } finally {
      setLoading(false);
    }
  }

  async function advance() {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    setCheckpointFeedback(null);
    try {
      const data = await postJSON<SessionView>(`/api/session/${sessionId}/advance`);
      setView(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to advance");
    } finally {
      setLoading(false);
    }
  }

  async function sendInterrupt() {
    if (!sessionId || !interruptText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await postJSON<SessionView>(`/api/session/${sessionId}/interrupt`, {
        utterance: interruptText,
      });
      setView(data);
      setInterruptText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send interrupt");
    } finally {
      setLoading(false);
    }
  }

  async function submitCheckpoint() {
    if (!sessionId || !checkpointText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await postJSON<{ understood: boolean; feedback: string }>(
        `/api/session/${sessionId}/checkpoint`,
        { response: checkpointText }
      );
      setCheckpointFeedback(result.feedback);
      setCheckpointText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit checkpoint response");
    } finally {
      setLoading(false);
    }
  }

  const currentNode = view?.graph.nodes.find((n) => n.id === view.graph.currentNodeId);
  const isLastNode = Boolean(
    view && view.graph.nodes[view.graph.nodes.length - 1]?.id === view.graph.currentNodeId
  );
  const isCheckpoint = currentNode?.type === "checkpoint";

  if (!view) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">Aria — Living Lecture demo</h1>
        <p className="text-sm text-neutral-500">
          Seeded topic: binary search (README Section 8 Phase 0 scope — one subject, deeply).
        </p>
        <div className="flex justify-center gap-2">
          <label className="text-sm">
            Modality lens:{" "}
            <select
              className="rounded border border-neutral-300 px-2 py-1"
              value={lens}
              onChange={(e) => setLens(e.target.value as LensId)}
            >
              <option value="default">Default (visual + audio)</option>
              <option value="dyslexia">Dyslexia-friendly</option>
            </select>
          </label>
        </div>
        <button
          onClick={startLesson}
          disabled={loading}
          className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Starting…" : "Start lesson"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {view.graph.subject} / {view.graph.topic}
        </h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
          lens: {lens}
        </span>
      </div>

      <Whiteboard drawCommands={view.currentBeat?.drawCommands as never} />

      <div className="space-y-2">
        {view.currentBeat?.narration.map((unit, i) => (
          <p key={i} className={unit.emphasis ? "font-semibold" : ""}>
            {unit.text}
          </p>
        ))}
      </div>

      {view.activeAnnotation && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Side note:</strong> {view.activeAnnotation.description}
        </div>
      )}

      {currentNode?.citations && currentNode.citations.length > 0 && (
        <div className="text-xs text-neutral-400">
          Source: {currentNode.citations.map((c) => c.sourceTitle).join(", ")}
        </div>
      )}

      {isCheckpoint && (
        <div className="space-y-2 rounded-md border border-neutral-200 p-4">
          <p className="text-sm font-medium">{currentNode?.checkpoint?.prompt}</p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
              value={checkpointText}
              onChange={(e) => setCheckpointText(e.target.value)}
              placeholder="Type your answer…"
            />
            <button
              onClick={submitCheckpoint}
              disabled={loading || !checkpointText.trim()}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Answer
            </button>
          </div>
          {checkpointFeedback && <p className="text-sm text-emerald-700">{checkpointFeedback}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          value={interruptText}
          onChange={(e) => setInterruptText(e.target.value)}
          placeholder='Interrupt: e.g. "wait, why do we ignore half the array?"'
          onKeyDown={(e) => e.key === "Enter" && sendInterrupt()}
        />
        <button
          onClick={sendInterrupt}
          disabled={loading || !interruptText.trim()}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Interrupt
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={advance}
          disabled={loading || isLastNode}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isLastNode ? "Lesson complete" : "Continue →"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
