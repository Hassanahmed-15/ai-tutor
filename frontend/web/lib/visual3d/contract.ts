// The contract every 3D template follows (spec §3.1). A template is data-in, facts-out: the model
// passes data only (numbers, vectors, expressions, lists); the template runs the real algorithm or
// maths, lays everything out, and returns facts the tutor can say without guessing.
import type { z } from "zod/v4";
import type { Board } from "./board3d/board.ts";

export type Domain = "math" | "cs";

/** One teaching step: a caption the tutor can say, and how to show it (animated or instant). */
export interface Step {
  caption: string;
  apply: (board: Board, opts: { animate: boolean }) => Promise<void> | void;
}

/** What building a scene (or running an action) returns. */
export interface Result {
  facts: Record<string, unknown>;
  steps: Step[];
  /** One-sentence description, used for alt text and the tool result summary. */
  summary: string;
}

export interface TemplateAction<S extends z.ZodType = z.ZodType> {
  description: string;
  schema: S;
  run: (board: Board, args: z.infer<S>) => Promise<Result> | Result;
}

export interface Template<S extends z.ZodType = z.ZodType> {
  id: string;
  domain: Domain;
  family: string;
  title: string;
  /** Words and phrases the router matches on. */
  topics: string[];
  schema: S;
  defaults: z.input<S>;
  run: (board: Board, args: z.infer<S>) => Promise<Result> | Result;
  // Each action has its own schema, so its argument type is its own (any here, checked by Zod at run time).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: Record<string, TemplateAction<any>>;
  narrationHints: string[];
}

/** A template-level error the tutor can say out loud ("stack underflow", "value not in tree"). */
export class VisualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualError";
  }
}

export const defineTemplate = <S extends z.ZodType>(t: Template<S>): Template => t as unknown as Template;
