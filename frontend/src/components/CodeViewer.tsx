"use client";

import { memo, useEffect, useRef } from "react";
import { PrismAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useDarkMode, prismLanguage } from "@/lib/theme";
import type { LineRange } from "@/lib/repo-context";

// Highlighting very large files freezes the browser; above this we show plain text.
const HIGHLIGHT_LIMIT = 150_000;

type Props = { path: string; content: string; range?: LineRange };

function inRange(n: number, range?: LineRange) {
  return !!range && n >= range.start && n <= (range.end ?? range.start);
}

const Highlighted = memo(function Highlighted({ path, content, range, dark }: Props & { dark: boolean }) {
  return (
    <SyntaxHighlighter
      language={prismLanguage(path)}
      style={dark ? vscDarkPlus : oneLight}
      showLineNumbers
      wrapLines
      lineNumberStyle={{ minWidth: "3.2em", paddingRight: "1em", color: "var(--muted)", opacity: 0.6, userSelect: "none" }}
      lineProps={(n: number) => ({
        "data-line": n,
        style: { display: "block", background: inRange(n, range) ? "var(--hl)" : undefined },
      })}
      customStyle={{ margin: 0, background: "transparent", fontSize: "0.8rem", padding: "0.75rem 0" }}
      codeTagProps={{ style: { fontFamily: "var(--font-geist-mono), monospace", background: "transparent" } }}
    >
      {content}
    </SyntaxHighlighter>
  );
});

export default function CodeViewer({ path, content, range }: Props) {
  const dark = useDarkMode();
  const box = useRef<HTMLDivElement>(null);
  const big = content.length > HIGHLIGHT_LIMIT;

  // Scroll the highlighted lines into view. The async highlighter may render a moment later, so retry briefly.
  useEffect(() => {
    if (!range) {
      box.current?.scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    const id = setInterval(() => {
      const el = box.current?.querySelector(`[data-line="${range.start}"]`);
      if (el || ++tries > 20) {
        clearInterval(id);
        el?.scrollIntoView({ block: "center" });
      }
    }, 50);
    return () => clearInterval(id);
  }, [path, range, content]);

  return (
    <div ref={box} className="h-full overflow-auto bg-code-bg">
      {big ? (
        <pre className="font-mono text-[0.8rem] py-3 min-w-max">
          {content.split("\n").map((line, i) => (
            <div key={i} data-line={i + 1} style={{ background: inRange(i + 1, range) ? "var(--hl)" : undefined }}>
              <span className="inline-block w-[4.2em] pr-4 text-right text-muted opacity-60 select-none">{i + 1}</span>
              {line}
            </div>
          ))}
        </pre>
      ) : (
        <Highlighted path={path} content={content} range={range} dark={dark} />
      )}
    </div>
  );
}
