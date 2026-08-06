import { ExternalLink, Maximize2, Mic2, PenTool, X } from "lucide-react";
import type { CampusRoom } from "./types";

const LIVE_TUTOR_URL = import.meta.env.VITE_LIVE_TUTOR_URL || "http://localhost:3000/";

export function SmartboardWorkspace({ room, onClose }: { room: CampusRoom; onClose: () => void }) {
  const boardUrl = new URL(room.tutorRoute ?? "", LIVE_TUTOR_URL).toString();

  return (
    <section className="board-workspace" role="dialog" aria-modal="true" aria-labelledby="board-title">
      <header className="board-toolbar">
        <div className="board-title-group">
          <span className="live-dot" aria-hidden="true" />
          <div>
            <p>Live classroom smartboard</p>
            <h2 id="board-title">{room.name}</h2>
          </div>
        </div>
        <div className="board-capabilities" aria-label="Integrated capabilities">
          <span><Mic2 size={15} /> Gemini Live</span>
          <span><PenTool size={15} /> Teaching board</span>
          <span><Maximize2 size={15} /> Focus view</span>
        </div>
        <div className="board-actions">
          <a className="icon-button" href={boardUrl} target="_blank" rel="noreferrer" aria-label="Open tutor in a new tab" title="Open tutor in a new tab">
            <ExternalLink size={19} />
          </a>
          <button className="icon-button" onClick={onClose} aria-label="Close smartboard" title="Close smartboard">
            <X size={21} />
          </button>
        </div>
      </header>
      <div className="board-frame">
        <iframe
          title={`Live Tutor in ${room.name}`}
          src={boardUrl}
          allow="microphone; camera; autoplay; fullscreen; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="board-fallback">
        The smartboard uses the existing Live Tutor directly. If it is not visible, start that application at <code>{LIVE_TUTOR_URL}</code>.
      </p>
    </section>
  );
}
