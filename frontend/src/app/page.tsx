"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Database, FolderTree, LoaderCircle, MessageSquare, ShieldCheck, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { GitHubMark, Logo } from "@/components/Logo";

const EXAMPLES = [
  { repo: "stripe-samples/accept-a-payment", note: "payments" },
  { repo: "fastapi/full-stack-fastapi-template", note: "full-stack" },
  { repo: "pallets/flask", note: "framework" },
  { repo: "shadcn-ui/taxonomy", note: "Next.js app" },
];

const FEATURES = [
  { icon: MessageSquare, title: "Ask anything", text: "“Is there a payment method?” Get an answer with citations to the exact files and lines." },
  { icon: Database, title: "Vector search in Postgres", text: "Code is chunked, embedded locally, and searched with pgvector on Neon." },
  { icon: FolderTree, title: "Knows the structure", text: "The directory tree and README go into every prompt, so questions about organisation work too." },
  { icon: ShieldCheck, title: "Strictly grounded", text: "The AI may only answer from the retrieved code. If it isn't there, it says so instead of guessing." },
];

function parse(input: string): { owner: string; name: string } | null {
  const s = input
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
  const [owner, name] = s.split("/");
  if (!owner || !name || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  return { owner, name: name.replace(/\.git$/, "") };
}

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<{ ok: boolean; problems: string[] } | null>(null);

  useEffect(() => {
    api.health().then(
      (h) =>
        setServer({
          ok: true,
          problems: [
            !h.database && "the database isn't connected (check DATABASE_URL)",
            !h.github_configured && "GITHUB_TOKEN is missing",
            !h.llm_configured && "GROQ_API_KEY is missing",
          ].filter(Boolean) as string[],
        }),
      () => setServer({ ok: false, problems: [] }),
    );
  }, []);

  const go = async (value: string) => {
    const repo = parse(value);
    if (!repo) {
      setError("Paste a GitHub repository link, like https://github.com/owner/repo");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.analyze(value);
      router.push(`/repo/${res.owner}/${res.name}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-4 sm:px-6">
        <Logo />
        <span className="text-[17px] font-semibold tracking-tight">RepoLens</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6">
        <section className="pt-12 pb-10 text-center sm:pt-20">
          <p className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
            <GitHubMark size={12} /> Works with any public GitHub repository
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Understand any codebase <span className="text-accent-text">in minutes</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] text-muted">
            Paste a GitHub link. RepoLens indexes the whole repository and answers any question about the code, grounded
            in the real files, with links to the exact lines.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              go(url);
            }}
            className="mx-auto mt-8 flex max-w-2xl flex-col gap-2 sm:flex-row"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              aria-label="GitHub repository URL"
              autoFocus
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-[15px] outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-[15px] font-medium text-white hover:opacity-90 disabled:opacity-60 cursor-pointer"
            >
              {busy ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              Analyse
            </button>
          </form>
          {error && <p className="mt-3 text-[14px] text-danger">{error}</p>}
          {server && !server.ok && (
            <p className="mx-auto mt-3 flex max-w-2xl items-center justify-center gap-2 text-[13px] text-warn">
              <TriangleAlert size={14} /> The backend isn&apos;t reachable. Start it with: uvicorn app.main:app --reload
            </p>
          )}
          {server?.ok && server.problems.length > 0 && (
            <p className="mx-auto mt-3 flex max-w-2xl items-center justify-center gap-2 text-[13px] text-warn">
              <TriangleAlert size={14} /> Server setup incomplete: {server.problems.join("; ")}. See backend/.env.
            </p>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <span className="py-1 text-[13px] text-muted">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.repo}
                onClick={() => {
                  setUrl(`https://github.com/${ex.repo}`);
                  go(ex.repo);
                }}
                className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] hover:border-accent cursor-pointer"
              >
                {ex.repo} <span className="text-muted">· {ex.note}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-3 pb-16 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-border bg-surface p-5">
              <Icon size={20} className="text-accent-text" />
              <h2 className="mt-3 text-[15px] font-semibold">{title}</h2>
              <p className="mt-1 text-[14px] text-muted">{text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-5 text-center text-[12px] text-muted">
        RepoLens: an AI codebase explainer. Final-year B.Tech CSE project.
      </footer>
    </div>
  );
}
