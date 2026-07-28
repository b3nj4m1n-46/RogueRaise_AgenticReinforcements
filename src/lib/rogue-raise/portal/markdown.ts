/**
 * A deliberately tiny Markdown reader for agent-written prose.
 *
 * Every document the agents produce is Markdown, and until now every surface
 * that displayed one was for WR staff, who can read `**bold**` without minding.
 * The handoff portal is the first place a document is shown to someone outside
 * the building, and asterisks in front of a county health director read as a
 * bug in the product.
 *
 * This handles exactly what our own agents emit — ATX headings, bold, italic,
 * links, and blank-line-separated paragraphs — and passes anything else through
 * as text.
 *
 * **Links were added deliberately, after the line was first drawn without
 * them.** Research documents are made of citations; rendering
 * `[label](url)` as literal brackets in front of the person who supplied the
 * data is the failure this renderer exists to prevent. A link is one regex and
 * one node type, and taking a full Markdown dependency to get it would mean
 * inheriting an HTML-passthrough surface for *agent-generated* content, which
 * is a strictly worse trade.
 *
 * That is where the line now is. Tables and lists are still out: they are
 * genuinely more parser than this should be, and no agent emits them today.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
// Links first (their label can contain emphasis markers), then bold before
// italic so `**x**` isn't read as an empty italic pair.
const INLINE = /(\[[^\]]*\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|_[^_]+_)/g;
const LINK_PARTS = /^\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: "text", text: text.slice(lastIndex, index) });
    }
    const token = match[0];
    const link = LINK_PARTS.exec(token);
    if (link) {
      // A link with no label shows its URL — better than an invisible anchor.
      parts.push({ kind: "link", text: link[1] || link[2], href: link[2] });
    } else if (token.startsWith("**")) {
      parts.push({ kind: "bold", text: token.slice(2, -2) });
    } else {
      parts.push({ kind: "italic", text: token.slice(1, -1) });
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return parts;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    // Soft-wrapped lines are one paragraph, which is how the agents write.
    blocks.push({
      kind: "paragraph",
      content: parseInline(paragraph.join(" ").trim()),
    });
    paragraph = [];
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: parseInline(heading[2].trim()),
      });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();

  return blocks;
}
