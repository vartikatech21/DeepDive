"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, FileCode, FolderTree, LayoutDashboard, LoaderCircle, MessageSquare, RefreshCw, TriangleAlert, X } from "lucide-react";
import { api, ApiError, type FileRow, type GlobalContext, type RepoStatus } from "@/lib/api";
import { RepoContext, type LineRange, type RepoCtx } from "@/lib/repo-context";
import ChatPanel from "./ChatPanel";
import FileTree from "./FileTree";
import FileView from "./FileView";
import { GitHubMark, Logo } from "./Logo";
import OverviewPanel from "./OverviewPanel";

type View = { kind: "overview" } | { kind: "file"; path: string; range?: LineRange };
type MobileTab = "files" | "main" | "chat";

const STAGES: { key: RepoStatus["status"]; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "fetching", label: "Reading repo info, README and file tree from GitHub" },
  { key: "ingesting", label: "Downloading, chunking and embedding files into pgvector" },
];

export default function RepoWorkspace({ owner, name }: { owner: string; name: string }) {
  const [job, setJob] = useState<RepoStatus | null>(null);
  const [meta, setMeta] = useState<RepoStatus | null>(null);
  const [rows, setRows] = useState<FileRow[] | null>(null);
  const [context, setContext] = useState<GlobalContext | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [mobileTab, setMobileTab] = useState<MobileTab>("main");
  const [incoming, setIncoming] = useState<{ text: string; nonce: number } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const started = useRef(false);

  const loadReady = useCallback(
    (m: RepoStatus) => {
      setMeta(m);
      document.title = `${m.full_name} · RepoLens`;
      api.files(owner, name).then((f) => setRows(f.files), (e) => setFatal(e.message));
      api.context(owner, name).then(setContext, () => setContext({ readme: "", directory_tree: "" }));
    },
    [owner, name],
  );

  // Poll the ingestion job until the repo is ready.
  const poll = useCallback(async () => {
    while (true) {
      let s: RepoStatus;
      try {
        s = await api.status(owner, name);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          try {
            s = await api.analyze(`${owner}/${name}`);
          } catch (err) {
            setFatal((err as Error).message);
            return;
          }
        } else {
          setFatal((e as Error).message);
          return;
        }
      }
      setJob(s);
      if (s.status === "ready") {
        loadReady(s.languages ? s : await api.status(owner, name));
        return;
      }
      if (s.status === "error") return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, [owner, name, loadReady]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    poll();
  }, [poll]);

  const reanalyze = async () => {
    setMeta(null);
    setRows(null);
    setContext(null);
    setView({ kind: "overview" });
    setFatal(null);
    try {
      setJob(await api.analyze(`${owner}/${name}`, true));
      poll();
    } catch (e) {
      setFatal((e as Error).message);
    }
  };

  const paths = useMemo(() => new Set((rows || []).map((r) => r[0])), [rows]);

  const ctx: RepoCtx | null = useMemo(
    () =>
      meta && {
        owner,
        name,
        meta,
        paths,
        openFile: (path, range) => {
          setView({ kind: "file", path, range });
          setMobileTab("main");
        },
        ask: (text) => {
          setIncoming({ text, nonce: Date.now() });
          setMobileTab("chat");
        },
      },
    [meta, owner, name, paths],
  );

  if (fatal || job?.status === "error") {
    return (
      <Shell owner={owner} name={name}>
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <TriangleAlert className="mx-auto text-danger" />
          <p className="mt-3 font-medium">Couldn&apos;t analyse {owner}/{name}</p>
          <p className="mt-1 text-[14px] text-muted">{fatal || job?.error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={reanalyze} className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-white cursor-pointer">Try again</button>
            <Link href="/" className="rounded-lg border border-border px-4 py-2 text-[14px]">Analyse another repo</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!ctx && !job) {
    return (
      <Shell owner={owner} name={name}>
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="animate-spin text-muted" />
        </div>
      </Shell>
    );
  }

  if (!ctx) {
    const current = STAGES.findIndex((s) => s.key === job?.status);
    const pct = job?.files_total ? Math.round((100 * job.files_done) / job.files_total) : 0;
    return (
      <Shell owner={owner} name={name}>
        <div className="mx-auto mt-16 w-full max-w-md px-4">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <p className="text-[15px] font-semibold">Analysing {owner}/{name}</p>
            <p className="mt-1 text-[13px] text-muted">This happens once per repo. Big repositories take longer.</p>
            <ol className="mt-5 space-y-3">
              {STAGES.slice(1).map((s, i) => {
                const idx = i + 1;
                const done = current > idx;
                const active = current === idx;
                return (
                  <li key={s.key} className="flex items-start gap-3 text-[14px]">
                    {done ? (
                      <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" />
                    ) : active ? (
                      <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin text-accent-text" />
                    ) : (
                      <span className="mx-[3px] mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-border" />
                    )}
                    <span className={done || active ? "" : "text-muted"}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
            {job?.status === "ingesting" && (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-[12px] text-muted tabular-nums">
                  {job.files_done.toLocaleString()} / {job.files_total.toLocaleString()} files · {job.chunk_count.toLocaleString()} chunks
                </p>
              </div>
            )}
            {job?.message && <p className="mt-3 text-[12px] text-muted">{job.message}</p>}
          </div>
        </div>
      </Shell>
    );
  }

  const openPath = view.kind === "file" ? view.path : undefined;

  return (
    <RepoContext.Provider value={ctx}>
      <Shell owner={owner} name={name} meta={meta!} onReanalyze={reanalyze}>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_420px]">
          <aside className={`${mobileTab === "files" ? "flex" : "hidden"} min-h-0 flex-col border-r border-border bg-surface md:flex`}>
            <button
              onClick={() => {
                setView({ kind: "overview" });
                setMobileTab("main");
              }}
              className={`mx-2 mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium cursor-pointer ${
                view.kind === "overview" ? "bg-accent-soft text-accent-text" : "hover:bg-surface-2"
              }`}
            >
              <LayoutDashboard size={15} /> Overview
            </button>
            <div className="min-h-0 flex-1">
              {rows ? (
                <FileTree
                  rows={rows}
                  selected={openPath}
                  onSelect={(p) => {
                    setView({ kind: "file", path: p });
                    setMobileTab("main");
                  }}
                />
              ) : (
                <div className="space-y-2 p-4">{[60, 80, 50, 70].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />)}</div>
              )}
            </div>
          </aside>

          {/* Phones: one pane at a time. Tablets/laptops: tree + (main or chat). Wide screens: all three. */}
          <main
            className={`${
              mobileTab === "main" ? "flex" : mobileTab === "files" ? "hidden md:flex" : "hidden xl:flex"
            } min-h-0 min-w-0 flex-col`}
          >
            {view.kind === "file" && (
              <div className="flex items-center gap-1 border-b border-border bg-surface px-2 pt-1.5">
                <button onClick={() => setView({ kind: "overview" })} className="rounded-t-lg px-3 py-1.5 text-[13px] text-muted hover:text-text cursor-pointer">
                  Overview
                </button>
                <span className="flex items-center gap-1.5 rounded-t-lg border border-b-0 border-border bg-bg px-3 py-1.5 text-[13px]">
                  <FileCode size={13} className="text-accent-text" />
                  <span className="max-w-[40ch] truncate">{view.path.split("/").pop()}</span>
                  <button onClick={() => setView({ kind: "overview" })} aria-label="Close file" className="rounded p-0.5 text-muted hover:text-text cursor-pointer">
                    <X size={12} />
                  </button>
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {view.kind === "overview" ? (
                <OverviewPanel context={context} />
              ) : (
                <FileView key={view.path} path={view.path} range={view.range} />
              )}
            </div>
          </main>

          <aside className={`${mobileTab === "chat" ? "flex" : "hidden"} min-h-0 flex-col border-l border-border xl:flex`}>
            <ChatPanel incoming={incoming} />
          </aside>
        </div>

        <nav className="grid grid-cols-3 border-t border-border bg-surface xl:hidden">
          {(
            [
              ["files", "Files", FolderTree],
              ["main", view.kind === "file" ? "Code" : "Overview", LayoutDashboard],
              ["chat", "Ask AI", MessageSquare],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] cursor-pointer ${key === "files" ? "md:hidden" : ""} ${
                mobileTab === key ? "text-accent-text" : "text-muted"
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </Shell>
    </RepoContext.Provider>
  );
}

function Shell({
  owner, name, meta, onReanalyze, children,
}: { owner: string; name: string; meta?: RepoStatus; onReanalyze?: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo size={24} />
          <span className="hidden sm:inline">RepoLens</span>
        </Link>
        <span className="text-muted">/</span>
        <span className="min-w-0 truncate text-[14px] font-medium">{meta?.full_name || `${owner}/${name}`}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {onReanalyze && (
            <button onClick={onReanalyze} title="Fetch the latest code and re-index" className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-text sm:inline-flex cursor-pointer">
              <RefreshCw size={13} /> Re-analyse
            </button>
          )}
          <a
            href={meta?.html_url || `https://github.com/${owner}/${name}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
          >
            <GitHubMark size={14} /> <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
