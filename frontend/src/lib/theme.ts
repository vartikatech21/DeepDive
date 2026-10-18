"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-color-scheme: dark)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(query);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useDarkMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const EXT_TO_PRISM: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript",
  tsx: "tsx", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", go: "go", rs: "rust", c: "c",
  h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby", php: "php",
  swift: "swift", m: "objectivec", dart: "dart", lua: "lua", r: "r", jl: "julia", ex: "elixir",
  exs: "elixir", hs: "haskell", clj: "clojure", vue: "markup", svelte: "markup", html: "markup",
  htm: "markup", xml: "markup", svg: "markup", css: "css", scss: "scss", sass: "sass", less: "less",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown", mdx: "markdown", sh: "bash",
  bash: "bash", zsh: "bash", ps1: "powershell", sql: "sql", graphql: "graphql", gql: "graphql",
  sol: "solidity", proto: "protobuf", tf: "hcl", ini: "ini", gradle: "groovy", ipynb: "python",
  prisma: "graphql", env: "bash",
};

export function prismLanguage(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "docker";
  if (name === "makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return EXT_TO_PRISM[ext] || "text";
}
