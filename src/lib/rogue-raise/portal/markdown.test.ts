import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("leaves plain text alone", () => {
    expect(parseInline("Just words.")).toEqual([
      { kind: "text", text: "Just words." },
    ]);
  });

  it("reads bold and keeps the surrounding text", () => {
    expect(parseInline("We got **2 projects** in.")).toEqual([
      { kind: "text", text: "We got " },
      { kind: "bold", text: "2 projects" },
      { kind: "text", text: " in." },
    ]);
  });

  it("reads italic", () => {
    expect(parseInline("_A caveat._")).toEqual([
      { kind: "italic", text: "A caveat." },
    ]);
  });

  it("does not read `**x**` as an empty italic pair", () => {
    // Bold is matched first for exactly this reason.
    const parts = parseInline("**bold**");
    expect(parts).toEqual([{ kind: "bold", text: "bold" }]);
  });

  it("passes an unmatched asterisk through rather than eating it", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", text: "2 * 3 = 6" }]);
  });
});

describe("parseInline — links", () => {
  it("reads a markdown link", () => {
    expect(parseInline("See [the count](https://example.org/pit) for detail.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "the count", href: "https://example.org/pit" },
      { kind: "text", text: " for detail." },
    ]);
  });

  it("falls back to the URL when the label is empty", () => {
    // An anchor with no text is invisible; showing the URL beats showing nothing.
    expect(parseInline("[](https://example.org/x)")).toEqual([
      { kind: "link", text: "https://example.org/x", href: "https://example.org/x" },
    ]);
  });

  it("does not treat a non-http link as one", () => {
    // Keeps `javascript:` and friends out of an href by construction.
    const parts = parseInline("[click](javascript:alert(1))");
    expect(parts.every((p) => p.kind !== "link")).toBe(true);
  });

  it("reads several links in one line", () => {
    const parts = parseInline("[a](https://a.example) and [b](https://b.example)");
    expect(parts.filter((p) => p.kind === "link")).toHaveLength(2);
  });

  it("keeps bold working alongside links", () => {
    const parts = parseInline("**Four** systems, per [the report](https://x.example)");
    expect(parts.map((p) => p.kind)).toEqual(["bold", "text", "link"]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings at their level", () => {
    const blocks = parseMarkdown("# Title\n\n## Section\n\n### Sub");
    expect(blocks.map((b) => b.kind === "heading" && b.level)).toEqual([1, 2, 3]);
  });

  it("joins soft-wrapped lines into one paragraph", () => {
    const blocks = parseMarkdown("One line\nand its continuation.\n\nA second.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      content: [{ kind: "text", text: "One line and its continuation." }],
    });
  });

  it("keeps inline formatting inside a heading", () => {
    const blocks = parseMarkdown("## **Loud** heading");
    expect(blocks[0].content[0]).toEqual({ kind: "bold", text: "Loud" });
  });

  it("ignores blank lines rather than emitting empty paragraphs", () => {
    expect(parseMarkdown("\n\n\nText.\n\n\n")).toHaveLength(1);
  });

  it("returns nothing for an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n  \n")).toEqual([]);
  });

  it("treats four hashes as text, not a heading", () => {
    // Only h1-h3 are supported; anything deeper is prose, not silently dropped.
    const blocks = parseMarkdown("#### Too deep");
    expect(blocks[0].kind).toBe("paragraph");
    expect(blocks[0].content[0]).toEqual({ kind: "text", text: "#### Too deep" });
  });

  it("handles the shape the categorizer actually emits", () => {
    const document = [
      "# What got built — Jackson County Health Department",
      "",
      "Both teams built for the front desk; nobody touched intake.",
      "",
      "**2 projects submitted.**",
      "**4,200 lines of code** across all of them.",
      "",
      "_Line counts describe scale, not effort._",
      "",
      "## The projects",
      "",
      "### Beds Tonight",
      "**Data dashboard**",
      "Shows free beds tonight.",
    ].join("\n");

    const blocks = parseMarkdown(document);
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings).toHaveLength(3);
    // No stray asterisks or bracket syntax survive into the rendered text.
    const text = blocks
      .flatMap((b) => b.content.map((c) => c.text))
      .join(" ");
    expect(text).not.toContain("*");
    expect(text).not.toContain("_");
    expect(text).not.toContain("](");
  });
});
