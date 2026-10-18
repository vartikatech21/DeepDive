"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronRight, CircleCheck, FileCode, LoaderCircle, Square, Trash2, TriangleAlert } from "lucide-react";
import { streamChat, type ChatMessage, type Source } from "@/lib/api";
import { useRepo } from "@/lib/repo-context";
import Markdown from "./Markdown";

type Turn = {
  role: "user" | "assistant";
  content: string;
  steps?: string[];
  sources?: Source[];
  model?: string | null;
  error?: string;
  pending?: boolean;
};

const SUGGESTIONS = [
  "What is this project about, in simple words?",
  "How is the code organised? Explain the main folders.",
  "Where is the main entry point and what does it do?",
  "Is there any payment integration in this repo?",
  "How is authentication handled?",
];

export default function ChatPanel({ incoming }: { incoming: { text: string; nonce: number } | null }) {
  const { owner, name } = useRepo();
  const storageKey = `repolens-chat:${owner}/${name}`.toLowerCase();
  // Keep the conversation across page reloads (per browser tab). This panel only mounts in the browser.
  const [turns, setTurns] = useState<Turn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const handled = useRef<number | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(turns.filter((t) => !t.pending)));
    } catch {}
  }, [turns, storageKey]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: ChatMessage[] = [
      ...turns.filter((t) => !t.error && t.content).map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: q },
    ];
    setTurns((t) => [...t, { role: "user", content: q }, { role: "assistant", content: "", steps: [], pending: true }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchLast = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);

    await streamChat(
      owner,
      name,
      history,
      (e) => {
        if (e.type === "status") patchLast((t) => ({ ...t, steps: [...(t.steps || []), e.label] }));
        else if (e.type === "sources") patchLast((t) => ({ ...t, steps: [...(t.steps || []), e.label], sources: e.sources }));
        else if (e.type === "token") patchLast((t) => ({ ...t, content: t.content + e.text }));
        else if (e.type === "done") patchLast((t) => ({ ...t, model: e.model, pending: false }));
        else if (e.type === "error") patchLast((t) => ({ ...t, error: e.message, pending: false }));
      },
      ctrl.signal,
    );
    patchLast((t) => (t.pending ? { ...t, pending: false, error: t.content ? undefined : "Stopped." } : t));
    setBusy(false);
  };

  // Questions sent from elsewhere in the UI ("Ask about this file").
  useEffect(() => {
    if (incoming && handled.current !== incoming.nonce) {
      handled.current = incoming.nonce;
      send(incoming.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot size={17} className="text-accent-text" />
        <h2 className="text-[14px] font-semibold">Ask about this repo</h2>
        {turns.length > 0 && (
          <button
            onClick={() => {
              abort.current?.abort();
              setTurns([]);
            }}
            title="Clear conversation"
            aria-label="Clear conversation"
            className="ml-auto rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div>
            <p className="text-[13px] text-muted">
              Answers come only from this repository: its directory tree, README and the code chunks retrieved for your
              question, with line citations.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl border border-border px-3 py-2 text-left text-[13px] hover:border-accent hover:bg-accent-soft cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-white whitespace-pre-wrap break-words">
                  {t.content}
                </div>
              ) : (
                <AssistantTurn key={i} turn={t} />
              ),
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface-2 p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="e.g. Where is the database connection set up?"
            className="max-h-32 flex-1 resize-none bg-transparent px-1.5 py-1 text-[14px] outline-none placeholder:text-muted"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="rounded-xl bg-text p-2 text-bg cursor-pointer">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} aria-label="Send" className="rounded-xl bg-accent p-2 text-white disabled:opacity-40 cursor-pointer">
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Sources({ sources, model }: { sources: Source[]; model?: string | null }) {
  const { openFile } = useRepo();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1 text-[12px] text-muted hover:text-text cursor-pointer">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Context: directory tree + {sources.length} retrieved chunks
        {model && <span className="ml-auto font-mono text-[11px] opacity-70">{model}</span>}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {sources.map((s) => (
            <li key={`${s.path}:${s.start_line}`} className="flex items-center gap-2">
              <FileCode size={12} className="shrink-0 text-muted" />
              <button
                onClick={() => openFile(s.path, { start: s.start_line, end: s.end_line })}
                className="min-w-0 truncate text-left font-mono text-[11.5px] text-accent-text hover:underline cursor-pointer"
                title={`${s.path}:${s.start_line}-${s.end_line}`}
              >
                {s.path}:{s.start_line}-{s.end_line}
              </button>
              <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-muted" title="Cosine similarity to your question">
                {s.similarity.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantTurn({ turn }: { turn: Turn }) {
  const steps = turn.steps || [];
  const generating = turn.pending && !!turn.content;
  return (
    <div>
      {turn.pending && !generating && (
        <ul className="space-y-1.5">
          {steps.length === 0 && (
            <li className="flex items-center gap-2 text-[13px] text-muted">
              <LoaderCircle size={14} className="animate-spin" /> Starting…
            </li>
          )}
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-muted">
              {i === steps.length - 1 ? (
                <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-accent-text" />
              ) : (
                <CircleCheck size={14} className="mt-0.5 shrink-0 text-success" />
              )}
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
      {turn.content && <Markdown>{turn.content}</Markdown>}
      {!turn.pending && turn.content && !!turn.sources?.length && <Sources sources={turn.sources} model={turn.model} />}
      {turn.error && (
        <p className="mt-1 flex items-start gap-2 text-[13px] text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {turn.error}
        </p>
      )}
    </div>
  );
}
