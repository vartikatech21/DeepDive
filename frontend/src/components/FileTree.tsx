"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileCode, FileText, Folder, FolderOpen, Search } from "lucide-react";
import type { FileRow } from "@/lib/api";

type Node = { name: string; path: string; dirs: Map<string, Node>; files: FileRow[]; count: number };

function buildTree(rows: FileRow[]): Node {
  const root: Node = { name: "", path: "", dirs: new Map(), files: [], count: 0 };
  for (const row of rows) {
    const parts = row[0].split("/");
    let node = root;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { name: parts[i], path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [], count: 0 };
        node.dirs.set(parts[i], next);
      }
      next.count++;
      node = next;
    }
    node.files.push(row);
  }
  return root;
}

function ancestors(path: string | undefined, into: Set<string>): Set<string> {
  const parts = path ? path.split("/") : [];
  for (let i = 1; i < parts.length; i++) into.add(parts.slice(0, i).join("/"));
  return into;
}

const DOC_EXT = /\.(md|mdx|txt|rst|json|ya?ml|toml|ini|cfg|lock|xml|csv)$/i;

function FileIcon({ path }: { path: string }) {
  if (DOC_EXT.test(path)) return <FileText size={15} className="shrink-0 text-muted" />;
  return <FileCode size={15} className="shrink-0 text-accent-text" />;
}

type Props = { rows: FileRow[]; selected?: string; onSelect: (path: string) => void };

export default function FileTree({ rows, selected, onSelect }: Props) {
  const tree = useMemo(() => buildTree(rows), [rows]);
  const [open, setOpen] = useState<Set<string>>(() => ancestors(selected, new Set()));
  const [filter, setFilter] = useState("");
  const [revealed, setRevealed] = useState(selected);

  // Reveal a newly selected file by opening its folders (state adjusted during render, not in an effect).
  if (selected !== revealed) {
    setRevealed(selected);
    setOpen((prev) => ancestors(selected, new Set(prev)));
  }

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    return rows.filter((r) => r[0].toLowerCase().includes(q)).slice(0, 400);
  }, [filter, rows]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const fileButton = (row: FileRow, depth: number, label: string) => (
    <button
      key={row[0]}
      type="button"
      onClick={() => onSelect(row[0])}
      title={row[0]}
      className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[13px] ${
        selected === row[0] ? "bg-accent-soft text-accent-text font-medium" : "hover:bg-surface-2"
      } cursor-pointer`}
      style={{ paddingLeft: 8 + depth * 14 + 15 }}
    >
      <FileIcon path={row[0]} />
      <span className="truncate">{label}</span>
    </button>
  );

  const renderNode = (node: Node, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      const isOpen = open.has(d.path);
      out.push(
        <button
          key={"d:" + d.path}
          type="button"
          onClick={() => toggle(d.path)}
          className="flex w-full items-center gap-1 rounded-md py-[3px] pr-2 text-left text-[13px] hover:bg-surface-2 cursor-pointer"
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-expanded={isOpen}
        >
          <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
          {isOpen ? <FolderOpen size={15} className="shrink-0 text-warn" /> : <Folder size={15} className="shrink-0 text-warn" />}
          <span className="truncate">{d.name}</span>
          <span className="ml-auto pl-2 text-[11px] text-muted tabular-nums">{d.count}</span>
        </button>,
      );
      if (isOpen) out.push(...renderNode(d, depth + 1));
    }
    const files = [...node.files].sort((a, b) => a[0].localeCompare(b[0]));
    for (const f of files) out.push(fileButton(f, depth, f[0].split("/").pop()!));
    return out;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-2 border-b border-border">
        <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 focus-within:border-accent">
          <Search size={14} className="text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${rows.length.toLocaleString()} files`}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {matches
          ? matches.length
            ? matches.map((r) => fileButton(r, 0, r[0]))
            : <p className="p-3 text-[13px] text-muted">No files match.</p>
          : renderNode(tree, 0)}
      </div>
    </div>
  );
}
