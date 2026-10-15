export type DepthHelpKind = "example" | "why";
export type DepthHelpState = Record<string, number>;
export const MAX_DEPTH_HELP_REQUESTS_PER_BOARD = 2;

/** Local budget for the optional depth buttons. It prevents an accidental click loop from making
 * unlimited paid chat calls while leaving the normal Ask Aria path available. */
export function requestDepthHelp(state: DepthHelpState, boardId: string, limit = MAX_DEPTH_HELP_REQUESTS_PER_BOARD): { allowed: boolean; next: DepthHelpState; used: number } {
  const used = Math.max(0, state[boardId] ?? 0);
  if (used >= limit) return { allowed: false, next: state, used };
  return { allowed: true, next: { ...state, [boardId]: used + 1 }, used: used + 1 };
}

export function depthHelpLabel(state: DepthHelpState, boardId: string): string {
  const left = Math.max(0, MAX_DEPTH_HELP_REQUESTS_PER_BOARD - (state[boardId] ?? 0));
  return left ? `${left} optional explanation${left === 1 ? "" : "s"} left` : "Use Ask Aria for more help";
}
