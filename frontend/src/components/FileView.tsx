"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MessageSquare } from "lucide-react";
import { api, formatBytes, type FileData } from "@/lib/api";
import { useRepo, type LineRange } from "@/lib/repo-context";
import CodeViewer from "./CodeViewer";

/** Render with key={path} so state resets when another file opens. */
export default function FileView({ path, range }: { path: string; range?: LineRange }) {
  const { owner, name, ask } = useRepo();
  const [file, setFile] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.file(owner, name, path).then(
      (f) => !cancelled && setFile(f),
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [owner, name, path]);

  const crumbs = path.split("/");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <div className="min-w-0 flex-1 font-mono text-[13px]">
          <span className="text-muted">{crumbs.slice(0, -1).map((c) => c + "/").join("")}</span>
          <span className="font-semibold">{crumbs[crumbs.length - 1]}</span>
          {file && (
            <span className="ml-2 font-sans text-[12px] text-muted">
              {file.line_count.toLocaleString()} lines · {formatBytes(file.size_bytes)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => ask(`What does ${path} do, and how does it fit into the rest of the project?`)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 cursor-pointer"
          >
            <MessageSquare size={14} /> Ask about this file
          </button>
          {file && (
            <a
              href={range ? `${file.github_url}#L${range.start}${range.end ? `-L${range.end}` : ""}` : file.github_url}
              target="_blank"
              rel="noreferrer noopener"
              title="Open on GitHub"
              aria-label="Open on GitHub"
              className="rounded-lg border border-border p-1.5 text-muted hover:bg-surface-2 hover:text-text"
            >
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-5 text-[13px] text-danger">{error}</p>
        ) : !file ? (
          <div className="space-y-2 p-5">{[70, 55, 80, 40, 65].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />)}</div>
        ) : (
          <CodeViewer path={path} content={file.content} range={range} />
        )}
      </div>
    </div>
  );
}
