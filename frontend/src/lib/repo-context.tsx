"use client";

import { createContext, useContext } from "react";
import type { RepoStatus } from "./api";

export type LineRange = { start: number; end?: number };

export type RepoCtx = {
  owner: string;
  name: string;
  meta: RepoStatus;
  paths: Set<string>;
  openFile: (path: string, range?: LineRange) => void;
  ask: (question: string) => void;
};

export const RepoContext = createContext<RepoCtx | null>(null);

export function useRepo(): RepoCtx {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used inside RepoContext");
  return ctx;
}

/** Finds the real path for a citation the AI wrote, tolerating small differences like a missing folder prefix. */
export function resolvePath(paths: Set<string>, candidate: string): string | null {
  const p = candidate.replace(/^\.?\//, "").trim();
  if (paths.has(p)) return p;
  let best: string | null = null;
  for (const real of paths) {
    if (real.endsWith("/" + p) && (!best || real.length < best.length)) best = real;
  }
  return best;
}
