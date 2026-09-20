const IMAGE_URL_PATTERN = /^(?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)/;
const LINK_URL_PATTERN = /^(?:https?:\/\/|mailto:)/;
const FENCED_BLOCK_PATTERN = /^(`{3,}|~{3,})[ \t]*([\w+-]*|{[^{}]*})?[ \t]*$/;

interface CodeBlock {
  placeholder: string;
  html: string;
}

/** Renders the guide's Markdown subset to sanitized HTML without external dependencies. */
export function renderMarkdownToHtml(markdown: string): string {
  const codeBlocks: CodeBlock[] = [];

  // Fenced blocks are opaque: their content never participates in inline formatting.
  const withoutFences = markdown
    .split(/\r?\n/)
    .reduce<{ lines: string[]; fence: string | null; buffer: string[] }>(
      (state, line) => {
        const fence = state.fence ?? FENCED_BLOCK_PATTERN.exec(line)?.[1] ?? null;

        if (state.fence === null && fence !== null) {
          return { lines: state.lines, fence, buffer: [] };
        }

        if (state.fence !== null) {
          if (line.trimStart().startsWith(state.fence)) {
            const placeholder = `<!--code-block-${codeBlocks.length}-->`;

            codeBlocks.push({
              placeholder,
              html: `<pre><code>${escapeHtml(state.buffer.join("\n"))}</code></pre>`,
            });

            return { lines: [...state.lines, placeholder], fence: null, buffer: [] };
          }

          return { ...state, buffer: [...state.buffer, line] };
        }

        return { ...state, lines: [...state.lines, line] };
      },
      { lines: [], fence: null, buffer: [] },
    );

  // An unclosed fence still renders its captured lines as code.
  if (withoutFences.fence !== null) {
    const placeholder = `<!--code-block-${codeBlocks.length}-->`;

    codeBlocks.push({
      placeholder,
      html: `<pre><code>${escapeHtml(withoutFences.buffer.join("\n"))}</code></pre>`,
    });
    withoutFences.lines.push(placeholder);
  }

  const blocks = renderBlocks(withoutFences.lines);
  let html = blocks;

  for (const block of codeBlocks) {
    html = html.replace(block.placeholder, block.html);
  }

  return html;
}

function renderBlocks(lines: string[]): string {
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "" || line.startsWith("<!--code-block-")) {
      if (line.startsWith("<!--code-block-")) html.push(line);
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);

    if (heading) {
      html.push(`<h${heading[1].length}>${renderInline(heading[2] ?? "")}</h${heading[1].length}>`);
      index += 1;
      continue;
    }

    if (/^[ \t]*([-*_][ \t]*){3,}$/.test(line)) {
      html.push("<hr />");
      index += 1;
      continue;
    }

    if (/^[ \t]*>/.test(line)) {
      const quote: string[] = [];

      while (index < lines.length && /^[ \t]*>/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^[ \t]*>[ \t]?/, ""));
        index += 1;
      }

      html.push(`<blockquote>${renderBlocks(quote)}</blockquote>`);
      continue;
    }

    const listMatch = /^[ \t]*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);

    if (listMatch) {
      const ordered = listMatch[2] !== undefined;
      const items: string[] = [];

      while (index < lines.length) {
        const item = /^[ \t]*(?:(?:[-*+])|(?:\d+)[.)])\s+(.*)$/.exec(lines[index] ?? "");

        if (!item) break;

        items.push(`<li>${renderInline(item[1] ?? "")}</li>`);
        index += 1;
      }

      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }

    const paragraph: string[] = [];

    while (
      index < lines.length &&
      (lines[index] ?? "").trim() !== "" &&
      !(lines[index] ?? "").startsWith("<!--code-block-")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }

    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("");
}

function renderInline(text: string): string {
  // Inline code is escaped first so its content survives the remaining replacements.
  const codeSpans: string[] = [];
  const withoutCode = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code: string) => {
    codeSpans.push(`<code>${code}</code>`);

    return `<!--inline-code-${codeSpans.length - 1}-->`;
  });

  const withMedia = withoutCode
    .replace(/!\[([^\]\n]*)\]\(([^)\s\n]+)(?:\s+"[^"\n]*")?\)/g, (_, alt: string, url: string) =>
      IMAGE_URL_PATTERN.test(url.trim()) ? `<img src="${url.trim()}" alt="${alt}" />` : alt,
    )
    .replace(/\[([^\]\n]*)\]\(([^)\s\n]+)(?:\s+"[^"\n]*")?\)/g, (_, label: string, url: string) =>
      LINK_URL_PATTERN.test(url.trim())
        ? `<a href="${url.trim()}" rel="noreferrer">${label || url.trim()}</a>`
        : label,
    );

  const formatted = withMedia
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  return formatted.replace(/<!--inline-code-(\d+)-->/g, (_, position: string) => {
    const span = codeSpans[Number(position)];

    return span ?? "";
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
