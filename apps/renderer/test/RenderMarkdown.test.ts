import { describe, expect, it } from "vitest";
import { renderMarkdownToHtml } from "../src/lib/RenderMarkdown";

describe("guide Markdown preview", () => {
  it("renders headings, emphasis, and links while escaping raw HTML", () => {
    const html = renderMarkdownToHtml(
      "# Title\n\nHello **bold** and *italic* with `code`.\n\n[docs](https://example.com)\n\n<script>alert(1)</script>",
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com" rel="noreferrer">docs</a>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders fenced code blocks without applying inline formatting inside", () => {
    const html = renderMarkdownToHtml("```\n**not bold** `not code`\n```");

    expect(html).toContain("<pre><code>**not bold** `not code`</code></pre>");
    expect(html).not.toContain("<strong>");
  });

  it("renders lists, quotes, and embedded guide images", () => {
    const html = renderMarkdownToHtml(
      "- one\n- two\n\n1. first\n2. second\n\n> note\n\n![alt](data:image/png;base64,AAAA)",
    );

    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>note</p></blockquote>");
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="alt" />');
  });

  it("drops unsafe image and link targets instead of rendering them", () => {
    const html = renderMarkdownToHtml(
      "![evil](javascript:alert(1))\n\n[evil](javascript:alert(1))",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a");
  });
});
