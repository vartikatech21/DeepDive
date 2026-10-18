// Client for the RepoLens FastAPI backend.

// 127.0.0.1 rather than localhost: on Windows "localhost" can resolve to IPv6 (::1), where uvicorn isn't listening.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export type RepoStatus = {
  id: number;
  repo_key: string;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string | null;
  commit_sha: string | null;
  stars: number | null;
  html_url: string | null;
  status: "queued" | "fetching" | "ingesting" | "ready" | "error";
  message: string | null;
  files_total: number;
  files_done: number;
  chunk_count: number;
  error: string | null;
  updated_at: string | null;
  languages?: { lang: string; files: number; lines: number; percent: number }[];
};

export type GlobalContext = { readme: string; directory_tree: string };

// [path, lines, bytes]
export type FileRow = [string, number, number];

export type FileData = {
  full_file_path: string;
  file_name: string;
  directory_path: string;
  language: string | null;
  line_count: number;
  size_bytes: number;
  content: string;
  github_url: string;
};

export type Source = { path: string; start_line: number; end_line: number; similarity: number };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatEvent =
  | { type: "status"; label: string }
  | { type: "sources"; label: string; sources: Source[] }
  | { type: "token"; text: string }
  | { type: "done"; model: string | null }
  | { type: "error"; message: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError(`Can't reach the RepoLens server at ${API_URL}. Is the backend running?`, 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new ApiError(detail, res.status);
  }
  return res.json();
}

const repoPath = (owner: string, name: string) => `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

export const api = {
  health: () =>
    request<{ ok: boolean; database: boolean; llm_configured: boolean; github_configured: boolean }>("/api/health"),
  analyze: (url: string, refresh = false) =>
    request<RepoStatus>("/api/repos", { method: "POST", body: JSON.stringify({ url, refresh }) }),
  status: (o: string, n: string) => request<RepoStatus>(repoPath(o, n)),
  context: (o: string, n: string) => request<GlobalContext>(`${repoPath(o, n)}/context`),
  files: (o: string, n: string) => request<{ files: FileRow[] }>(`${repoPath(o, n)}/files`),
  file: (o: string, n: string, path: string) =>
    request<FileData>(`${repoPath(o, n)}/file?path=${encodeURIComponent(path)}`),
};

/** Streams the RAG pipeline's events (Server-Sent Events over a POST request). */
export async function streamChat(
  owner: string,
  name: string,
  messages: ChatMessage[],
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${repoPath(owner, name)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name !== "AbortError") onEvent({ type: "error", message: `Can't reach the RepoLens server at ${API_URL}.` });
    return;
  }
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {}
    onEvent({ type: "error", message: detail });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (data) onEvent(JSON.parse(data));
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") onEvent({ type: "error", message: "The connection to the server was lost." });
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
}

/** Parses repo citations like "src/a.ts#L10-L20", "src/a.ts:10-20" or "./src/a.ts". */
export function parseCitation(href: string): { path: string; start?: number; end?: number } | null {
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:")) return null;
  let s = decodeURIComponent(href).replace(/^\.?\//, "");
  let start: number | undefined, end: number | undefined;
  const hash = s.match(/#L(\d+)(?:-L?(\d+))?$/);
  if (hash) {
    start = +hash[1];
    end = hash[2] ? +hash[2] : undefined;
    s = s.slice(0, hash.index);
  }
  const colon = s.match(/:(\d+)(?:-(\d+))?$/);
  if (colon) {
    start = start ?? +colon[1];
    end = end ?? (colon[2] ? +colon[2] : undefined);
    s = s.slice(0, colon.index);
  }
  return { path: s, start, end };
}
