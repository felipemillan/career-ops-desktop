/**
 * Markdown.tsx — Editorial-style markdown renderer.
 * Wraps react-markdown + remark-gfm. No 'use client', no Next.js imports.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
  className?: string;
}

function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Editorial-style markdown renderer. Generous line-height, serif headings,
 * subtle emerald accents. Full control via component overrides (no Tailwind
 * Typography plugin dependency).
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <article
      className={cn(
        "md-editorial text-gray-700 dark:text-gray-300",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...p }) => (
            <h1
              className="mt-10 mb-5 text-2xl leading-tight font-bold tracking-tight text-gray-900 dark:text-gray-100 first:mt-0"
              {...p}
            />
          ),
          h2: ({ ...p }) => (
            <h2
              className="relative mt-10 mb-4 border-b border-gray-200 dark:border-gray-700 pb-2.5 pl-4 text-xl leading-snug font-bold tracking-tight text-gray-900 dark:text-gray-100 first:mt-0 before:absolute before:left-0 before:top-[8px] before:bottom-[14px] before:w-[3px] before:rounded-sm before:bg-emerald-500/70"
              {...p}
            />
          ),
          h3: ({ ...p }) => (
            <h3
              className="mt-8 mb-3 text-lg leading-snug font-semibold text-gray-900 dark:text-gray-100"
              {...p}
            />
          ),
          h4: ({ ...p }) => (
            <h4
              className="mt-6 mb-2 text-[11px] font-bold tracking-[0.12em] text-gray-500 dark:text-gray-400 uppercase"
              {...p}
            />
          ),
          p: ({ ...p }) => (
            <p
              className="my-4 text-sm leading-[1.8] text-gray-700 dark:text-gray-300 [&:first-child]:mt-0"
              {...p}
            />
          ),
          ul: ({ ...p }) => (
            <ul
              className="my-4 ml-5 list-disc space-y-1.5 marker:text-emerald-500/60 [&_ul]:my-1.5 [&_ol]:my-1.5"
              {...p}
            />
          ),
          ol: ({ ...p }) => (
            <ol
              className="my-4 ml-5 list-decimal space-y-1.5 marker:text-emerald-500/60 marker:font-semibold [&_ul]:my-1.5 [&_ol]:my-1.5"
              {...p}
            />
          ),
          li: ({ ...p }) => (
            <li
              className="pl-1.5 text-sm leading-[1.75] text-gray-700 dark:text-gray-300"
              {...p}
            />
          ),
          strong: ({ ...p }) => (
            <strong className="font-semibold text-gray-900 dark:text-gray-100" {...p} />
          ),
          em: ({ ...p }) => (
            <em className="italic text-gray-500 dark:text-gray-400" {...p} />
          ),
          a: ({ href, ...p }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="break-words text-emerald-600 dark:text-emerald-400 underline decoration-emerald-400/30 underline-offset-[3px] transition-colors hover:decoration-emerald-400"
              {...p}
            />
          ),
          blockquote: ({ ...p }) => (
            <blockquote
              className="my-5 rounded-r-md border-l-2 border-emerald-500/50 bg-gray-50 dark:bg-gray-800/40 py-3 pl-5 pr-4 italic text-gray-600 dark:text-gray-400 [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0"
              {...p}
            />
          ),
          code: ({ className: codeClass, children: codeChildren, ...rest }) => {
            const isInline = !codeClass?.includes("language-");
            if (isInline) {
              return (
                <code
                  className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[0.85em] text-emerald-700 dark:text-emerald-300 font-mono"
                  {...rest}
                >
                  {codeChildren}
                </code>
              );
            }
            return (
              <code
                className={cn("text-[13px] font-mono", codeClass)}
                {...rest}
              >
                {codeChildren}
              </code>
            );
          },
          pre: ({ ...p }) => (
            <pre
              className="my-5 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-900 p-4 text-[13px] leading-relaxed"
              {...p}
            />
          ),
          hr: () => (
            <div className="my-8 flex items-center justify-center gap-3">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              <span className="size-1.5 rotate-45 bg-emerald-500/60 inline-block" />
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
          ),
          table: ({ ...p }) => (
            <div className="my-5 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          thead: ({ ...p }) => (
            <thead className="bg-gray-50 dark:bg-gray-800/60" {...p} />
          ),
          th: ({ ...p }) => (
            <th
              className="border-b border-gray-200 dark:border-gray-700 px-3 py-2.5 text-left text-[10.5px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase"
              {...p}
            />
          ),
          td: ({ ...p }) => (
            <td
              className="border-b border-gray-200/60 dark:border-gray-700/40 px-3 py-2.5 align-top text-[13px] leading-relaxed text-gray-700 dark:text-gray-300"
              {...p}
            />
          ),
          tr: ({ ...p }) => (
            <tr
              className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 [&:last-child>td]:border-b-0"
              {...p}
            />
          ),
          img: ({ ...p }) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img className="my-5 rounded-lg border border-gray-200 dark:border-gray-700 max-w-full" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </article>
  );
}
