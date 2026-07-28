import { parseMarkdown, type Inline } from "@/lib/rogue-raise/portal/markdown";

/**
 * Renders an agent-written document as real typography rather than as raw
 * Markdown. See `lib/rogue-raise/portal/markdown.ts` for why this exists and
 * why it is deliberately small.
 */
function renderInline(content: Inline[]) {
  return content.map((part, index) => {
    if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
    if (part.kind === "italic") return <em key={index}>{part.text}</em>;
    return <span key={index}>{part.text}</span>;
  });
}

export function Prose({ source }: { source: string }) {
  const blocks = parseMarkdown(source);

  return (
    <div className="flex max-w-prose flex-col gap-3">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          // The document's own H1 is its title, which the portal already shows
          // as a section heading — so it starts one level down here.
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return (
            <Tag
              key={index}
              className={
                block.level === 1
                  ? "font-serif text-xl font-semibold text-ink"
                  : "font-serif text-lg font-semibold text-ink"
              }
            >
              {renderInline(block.content)}
            </Tag>
          );
        }
        return (
          <p key={index} className="text-ink/85">
            {renderInline(block.content)}
          </p>
        );
      })}
    </div>
  );
}
