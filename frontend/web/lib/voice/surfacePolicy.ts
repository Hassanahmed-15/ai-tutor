import type { VoiceSurface } from "./sessionMachine";
import type { GateProfile } from "./sharedVoiceGate";

/** All modes share one engine; only the cost of interrupting differs by conversational context. */
export function profileForSurface(surface: VoiceSurface): GateProfile {
  return surface === "normal" || surface === "pdf" ? "lecture" : "conversation";
}
