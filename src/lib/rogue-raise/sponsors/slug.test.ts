import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/rogue-raise/sponsors/slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Acme Robotics")).toBe("acme-robotics");
  });

  it("collapses runs of punctuation/whitespace into a single hyphen", () => {
    expect(slugify("Rogue   Raise!!!Event")).toBe("rogue-raise-event");
    expect(slugify("a---b___c")).toBe("a-b-c");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--Hello--")).toBe("hello");
    expect(slugify("!!!Acme!!!")).toBe("acme");
    expect(slugify("   Acme   ")).toBe("acme");
  });

  it("strips unicode diacritics down to ascii", () => {
    expect(slugify("Café Münchén")).toBe("cafe-munchen");
    expect(slugify("naïve")).toBe("naive");
  });

  it("falls back to 'org' for empty or all-non-alphanumeric input", () => {
    expect(slugify("")).toBe("org");
    expect(slugify("   ")).toBe("org");
    expect(slugify("!!!")).toBe("org");
    // Characters that NFKD-strip to nothing usable also fall back.
    expect(slugify("日本語")).toBe("org");
  });

  it("caps the stem at 60 characters", () => {
    const out = slugify("a".repeat(80));
    expect(out.length).toBe(60);
    expect(out).toBe("a".repeat(60));
  });

  it("keeps digits", () => {
    expect(slugify("Team 42 Rocks")).toBe("team-42-rocks");
  });
});
