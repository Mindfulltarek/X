"use client";

import { memo, useCallback, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

/**
 * Safe Markdown renderer.
 *
 * - No `rehype-raw`, so HTML in model output is rendered as text, never executed.
 * - Links are forced to open in a new tab with `noopener noreferrer`.
 * - Fenced blocks get a copy button; `text` blocks (the image-prompt output) are
 *   labelled "Copy prompt" because that is exactly what they are.
 */
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard permission can be denied; the user can still select the text. */
    }
  }, [code]);

  const isPrompt = language === "text" || language === undefined;
  const label = isPrompt ? "Copy prompt" : `Copy ${language ?? "code"}`;

  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-midnight-900 px-2.5 py-1.5 text-xs font-semibold text-ink-100 transition hover:border-electric-400/60 hover:text-white"
          aria-label={copied ? "Copied to clipboard" : label}
        >
          {copied ? <Check size={13} className="text-cyan-accent" /> : <Copy size={13} />}
          {copied ? "Copied" : label}
        </button>
      </div>
      <pre style={{ paddingTop: "2.75rem" }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Memoised: during streaming only the in-flight message's `content` changes, so
 * earlier answers are never re-parsed by react-markdown on every chunk.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children as ReactNode}
            </a>
          ),
          pre: ({ children }) => <>{children as ReactNode}</>,
          code: ({ className, children }) => {
            const text = String(children ?? "").replace(/\n$/, "");
            const match = /language-([\w-]+)/.exec(className ?? "");
            const isBlock = Boolean(match) || text.includes("\n");
            if (!isBlock) return <code>{children as ReactNode}</code>;
            return <CodeBlock code={text} language={match?.[1]} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
