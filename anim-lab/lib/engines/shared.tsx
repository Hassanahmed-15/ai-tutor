"use client";

import { Component, type ReactNode } from "react";
import * as Babel from "@babel/standalone";

/** What every engine renderer receives: the shared narration clock and the board's code. */
export type EngineProps = {
  code: string;
  progress: number;
  sentenceIndex: number;
  sentenceProgress: number;
  sentenceTotal: number;
  playing: boolean;
  assetIds?: string[];
  onError: (message: string) => void;
};

/**
 * Turns generated JSX into a live function. Classic runtime so `React` from the scope object is
 * what JSX compiles against — the same React instance as the page. Local lab only: this evaluates
 * model output in the page, with no sandbox.
 */
export function compileEntry<T>(code: string, scope: Record<string, unknown>, entry: string): T {
  const js = Babel.transform(code, { presets: [["react", { runtime: "classic" }]], filename: "board.jsx" }).code ?? "";
  const names = Object.keys(scope);
  const factory = new Function(...names, `"use strict";\n${js}\nreturn typeof ${entry} === "function" ? ${entry} : undefined;`);
  const fn = factory(...names.map((n) => scope[n]));
  if (typeof fn !== "function") throw new Error(`code does not define ${entry}()`);
  return fn as T;
}

export class BoardBoundary extends Component<{ onError: (m: string) => void; resetKey: string; children: ReactNode }, { error: string | null; key: string }> {
  state = { error: null as string | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }
  render() {
    return this.state.error ? <BoardError message={this.state.error} /> : this.props.children;
  }
}

export function BoardError({ message }: { message: string }) {
  return (
    <div className="board-error">
      <strong>Runtime error</strong>
      <span>{message}</span>
    </div>
  );
}
