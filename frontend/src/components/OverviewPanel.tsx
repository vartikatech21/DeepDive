"use client";

import { BookOpen, Database, FolderTree, GitBranch, MessageSquare, Search, Sparkles, Star, Workflow } from "lucide-react";
import type { GlobalContext } from "@/lib/api";
import { formatNumber } from "@/lib/api";
import { useRepo } from "@/lib/repo-context";
import Markdown from "./Markdown";

// GitHub's own language colours, so the bar looks familiar.
const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Java: "#b07219", Go: "#00ADD8",
  Rust: "#dea584", "C++": "#f34b7d", C: "#555555", "C#": "#178600", PHP: "#4F5D95", Ruby: "#701516",
  HTML: "#e34c26", CSS: "#663399", Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", Shell: "#89e051",
  Vue: "#41b883", SCSS: "#c6538c", Jupyter: "#DA5B0B", Svelte: "#ff3e00", SQL: "#e38c00", Scala: "#c22d40",
  Lua: "#000080", R: "#198CE7", Solidity: "#AA6746", Dockerfile: "#384d54", PowerShell: "#012456",
};

const PIPELINE = [
  { icon: GitBranch, title: "Ingest", text: "Files fetched from the GitHub API (token + paced requests), README and directory tree saved." },
  { icon: Database, title: "Chunk + embed", text: "~60-line chunks with file name, path and folder; embedded locally with all-MiniLM-L6-v2 into pgvector." },
  { icon: Search, title: "Retrieve", text: "Your question is embedded and the top-k nearest chunks are found with pgvector's <-> distance." },
  { icon: Sparkles, title: "Generate", text: "Directory tree + README + chunks go to Groq, which must answer only from that context, with citations." },
];

type Props = { context: GlobalContext | null };

function Card({ title, icon: Icon, children, note }: { title: string; icon: React.ElementType; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={17} className="text-accent-text" />
        <h2 className="text-[15px] font-semibold">{title}</h2>
      </div>
      {note && <p className="-mt-1.5 mb-3 text-[13px] text-muted">{note}</p>}
      {children}
    </section>
  );
}

export default function OverviewPanel({ context }: Props) {
  const { meta, ask } = useRepo();
  const langs = meta.languages || [];
  const imageBase = `https://raw.githubusercontent.com/${meta.full_name}/${meta.commit_sha || meta.default_branch}/`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h1 className="text-xl font-semibold tracking-tight break-words">{meta.full_name}</h1>
        {meta.description && <p className="mt-1.5 text-[15px] text-muted">{meta.description}</p>}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
          <span><b className="text-text tabular-nums">{formatNumber(meta.files_total)}</b> files indexed</span>
          <span><b className="text-text tabular-nums">{formatNumber(meta.chunk_count)}</b> chunks in pgvector</span>
          {meta.stars != null && (
            <span className="flex items-center gap-1"><Star size={13} /> <b className="text-text tabular-nums">{formatNumber(meta.stars)}</b></span>
          )}
          {meta.default_branch && (
            <span className="flex items-center gap-1"><GitBranch size={13} /> {meta.default_branch}</span>
          )}
        </div>
        {langs.length > 0 && (
          <div className="mt-4">
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
              {langs.map((l) => (
                <div key={l.lang} title={`${l.lang} ${l.percent}%`} style={{ width: `${l.percent}%`, background: LANG_COLORS[l.lang] || "#9a9ab2" }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {langs.slice(0, 8).map((l) => (
                <span key={l.lang} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLORS[l.lang] || "#9a9ab2" }} />
                  {l.lang} <span className="text-muted">{l.percent}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            "What does this project do?",
            "How is the code organised?",
            "Where is the main entry point?",
          ].map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] hover:border-accent hover:bg-accent-soft cursor-pointer"
            >
              <MessageSquare size={12} /> {q}
            </button>
          ))}
        </div>
      </section>

      <Card title="How answers are generated (Hybrid RAG)" icon={Workflow}>
        <ol className="grid gap-2.5 sm:grid-cols-2">
          {PIPELINE.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-3 rounded-xl border border-border p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                <Icon size={15} />
              </span>
              <div>
                <p className="text-[13.5px] font-medium">{i + 1}. {title}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card
        title="Directory tree (global context)"
        icon={FolderTree}
        note="This tree is sent to the AI with every question, so it can answer questions about structure."
      >
        {context ? (
          <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-code-bg p-3 font-mono text-[12px] leading-relaxed">
            {context.directory_tree}
          </pre>
        ) : (
          <div className="skeleton h-40 w-full" />
        )}
      </Card>

      <Card title="README" icon={BookOpen}>
        {!context ? (
          <div className="skeleton h-40 w-full" />
        ) : context.readme ? (
          <div className="max-h-[32rem] overflow-auto">
            <Markdown skipHtml imageBase={imageBase}>{context.readme}</Markdown>
          </div>
        ) : (
          <p className="text-[13px] text-muted">This repository has no README.</p>
        )}
      </Card>
    </div>
  );
}
