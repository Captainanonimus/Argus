import { Fragment, type ReactNode } from "react";

// Minimal markdown renderer that builds React elements only. Raw HTML is
// never interpreted (it shows as text), and links are limited to http(s).
// Supports paragraphs, headings, lists, fenced code, simple tables, bold,
// italic, inline code, links and [n] citations.

export type CitationSource = { n: number; title: string; url: string };

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))|(\[(\d{1,2})\])|(\*[^*\s\n][^*\n]*\*|_[^_\s\n][^_\n]*_)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;

function inline(text: string, sources: CitationSource[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of Array.from(text.matchAll(INLINE))) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const k = `${keyBase}-${i++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded-[2px] bg-ink px-1 font-mono text-[12px]">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={k}>{inline(m[2].slice(2, -2), sources, k)}</strong>);
    } else if (m[3]) {
      const href = safeUrl(m[5]);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-white">
            {m[4]}
          </a>
        ) : (
          m[0]
        ),
      );
    } else if (m[6]) {
      const n = Number(m[7]);
      const src = sources.find((s) => s.n === n);
      const href = src ? safeUrl(src.url) : null;
      out.push(
        src && href ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={`Source ${n}: ${src.title}`}
            title={src.title}
            className="num mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[2px] border border-seam px-1 align-[1px] text-[10px] text-text hover:border-dim"
          >
            {n}
          </a>
        ) : (
          m[0]
        ),
      );
    } else if (m[8]) {
      out.push(<em key={k}>{inline(m[8].slice(1, -1), sources, k)}</em>);
    } else if (m[9]) {
      const href = safeUrl(m[9]);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
            {m[9]}
          </a>
        ) : (
          m[0]
        ),
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flush();
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered ? /^\d+[.)]\s+(.*)$/.exec(t) : /^[-*+]\s+(.*)$/.exec(t);
        if (m) items.push(m[1]);
        else if (t && items.length && /^\s{2,}/.test(lines[i])) items[items.length - 1] += ` ${t}`;
        else break;
        i++;
      }
      i--;
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const t = lines[i].trim();
        if (!/^\|?[\s:|-]+\|?$/.test(t)) {
          rows.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        }
        i++;
      }
      i--;
      blocks.push({ kind: "table", rows });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

export function Markdown({ text, sources = [] }: { text: string; sources?: CitationSource[] }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-[13px] leading-[19px]">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h":
            return (
              <p key={k} className="pt-1 font-condensed text-[14px] font-semibold">
                {inline(b.text, sources, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.kind === "ul" ? "ul" : "ol";
            return (
              <List key={k} className={`${b.kind === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, sources, `${k}-${j}`)}</li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-[2px] border border-seam bg-ink p-2 font-mono text-[12px] leading-4">
                {b.text}
              </pre>
            );
          case "table": {
            const [head, ...body] = b.rows;
            if (!head) return null;
            return (
              <div key={k} className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-seam text-left font-condensed text-dim">
                      {head.map((c, j) => (
                        <th key={j} scope="col" className="px-2 py-1 font-medium">
                          {inline(c, sources, `${k}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((r, ri) => (
                      <tr key={ri} className="border-b border-seam/50">
                        {r.map((c, j) => (
                          <td key={j} className="px-2 py-1">
                            {inline(c, sources, `${k}-${ri}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          default:
            return (
              <p key={k} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {b.text.split("\n").map((ln, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(ln, sources, `${k}-${j}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
