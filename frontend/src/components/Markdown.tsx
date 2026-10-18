"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseCitation } from "@/lib/api";
import { resolvePath, useRepo, type LineRange } from "@/lib/repo-context";
import CodeBlock from "./CodeBlock";

type Props = {
  children: string;
  /** For file explanations: links like "#L12-L40" jump within this file. */
  currentPath?: string;
  onLineLink?: (range: LineRange) => void;
  /** Ignore raw HTML (READMEs are full of it). */
  skipHtml?: boolean;
  /** Base URL for relative image paths (README images). */
  imageBase?: string;
};

// "[src/app.py:12-30]" written as plain text (not already a link) -> "[src/app.py:12-30](src/app.py#L12-L30)"
// The hyphen may come back as an en dash or a non-breaking hyphen, so accept those too.
const PLAIN_CITE = /\[([^\[\]\s:]+\.\w+):(\d+)(?:[-‐‑–](\d+))?\](?!\()/g;

function linkCitations(md: string): string {
  // gpt-oss models write citations with CJK lenticular brackets: 【path:1-2】 -> [path:1-2]
  return md.replace(/【([^【】\s]+:\d+[^【】\s]*)】/g, "[$1]").replace(PLAIN_CITE, (_m, path: string, a: string, b?: string) =>
    // Escape "_" and "*" in the visible text so names like __main__.py aren't turned into bold.
    `[${path.replace(/([_*])/g, "\\$1")}:${a}${b ? "-" + b : ""}](${encodeURI(path)}#L${a}${b ? "-L" + b : ""})`,
  );
}

const CITE_IN_CODE = /^\.?\/?([\w@.\-\/\[\]()]+\.[\w]+)(?::(\d+)(?:-(\d+))?)?$/;

export default function Markdown({ children, currentPath, onLineLink, skipHtml, imageBase }: Props) {
  const { paths, openFile } = useRepo();

  return (
    <div className="prose-lens">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={skipHtml}
        components={{
          img({ src, alt }) {
            if (typeof src !== "string" || !src) return null;
            const url = /^(https?:)?\/\//i.test(src) || !imageBase ? src : imageBase + src.replace(/^\.?\//, "");
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={url} alt={alt || ""} className="inline max-w-full" loading="lazy" />;
          },
          a({ href = "", children }) {
            // Line links inside a file explanation.
            const local = href.match(/^#L(\d+)(?:-L?(\d+))?$/);
            if (local && onLineLink) {
              return (
                <button
                  type="button"
                  onClick={() => onLineLink({ start: +local[1], end: local[2] ? +local[2] : undefined })}
                  className="text-accent-text underline underline-offset-2 decoration-1 cursor-pointer"
                >
                  {children}
                </button>
              );
            }
            // Citations of repo files open in the code viewer.
            const cite = parseCitation(href);
            const real = cite && resolvePath(paths, cite.path);
            if (cite && real) {
              return (
                <button
                  type="button"
                  onClick={() => openFile(real, cite.start ? { start: cite.start, end: cite.end } : undefined)}
                  className="text-accent-text underline underline-offset-2 decoration-1 cursor-pointer font-mono text-[0.85em] break-all text-left"
                  title={`Open ${real}`}
                >
                  {children}
                </button>
              );
            }
            if (/^https?:\/\//i.test(href)) {
              return (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            }
            // A repo path that isn't a file (usually a folder): show it, but don't navigate away from the app.
            return <span className="font-mono text-[0.85em] text-accent-text">{children}</span>;
          },
          code({ className, children }) {
            const text = String(children ?? "");
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            if (lang || text.includes("\n")) return <CodeBlock code={text.replace(/\n$/, "")} language={lang} />;
            // Inline code that names a repo file becomes clickable too.
            const m = text.match(CITE_IN_CODE);
            const real = m && resolvePath(paths, m[1]);
            if (m && real && real !== currentPath) {
              return (
                <button
                  type="button"
                  onClick={() => openFile(real, m[2] ? { start: +m[2], end: m[3] ? +m[3] : undefined } : undefined)}
                  className="font-mono text-[0.85em] bg-surface-2 border border-border rounded-[5px] px-[0.35em] text-accent-text hover:border-accent cursor-pointer break-all text-left"
                >
                  {text}
                </button>
              );
            }
            return <code>{children}</code>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {linkCitations(children)}
      </ReactMarkdown>
    </div>
  );
}
