/**
 * A tiny module-level audio event bus.
 *
 * Doors, coffee machines, and kiosks live many layers deep in the scene graph; threading sound
 * callbacks down through every intermediate component would couple the whole tree to the audio
 * system for no benefit. Instead the ambient-audio hook registers its synthesisers here once, and
 * any prop can emit a named event. If no handler is registered (audio disabled, quiet mode, or
 * before first user gesture) the emit is a silent no-op — sound must never be load-bearing.
 */

type AudioEvent = "door-open" | "door-close" | "coffee" | "water" | "chime" | "locker";

type Handler = (event: AudioEvent) => void;

let handler: Handler | null = null;

export const audioBus = {
  register(next: Handler | null): void {
    handler = next;
  },
  emit(event: AudioEvent): void {
    handler?.(event);
  },
};

export type { AudioEvent };
