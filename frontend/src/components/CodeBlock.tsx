"use client";

import { useState } from "react";
import { PrismAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { useDarkMode } from "@/lib/theme";

export default function CodeBlock({ code, language }: { code: string; language?: string }) {
  const dark = useDarkMode();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group my-2">
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-surface p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <SyntaxHighlighter
        language={language || "text"}
        style={dark ? vscDarkPlus : oneLight}
        customStyle={{ margin: 0, borderRadius: 10, fontSize: "0.8rem", background: "var(--code-bg)", border: "1px solid var(--border)" }}
        codeTagProps={{ style: { fontFamily: "var(--font-geist-mono), monospace", background: "transparent" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
