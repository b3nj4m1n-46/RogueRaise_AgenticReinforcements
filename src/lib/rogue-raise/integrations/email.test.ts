import { afterEach, describe, expect, it, vi } from "vitest";

import { getEmailAdapter } from "@/lib/rogue-raise/integrations/email";

describe("email adapter (dev fallback)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a singleton across calls", () => {
    expect(getEmailAdapter()).toBe(getEmailAdapter());
  });

  it("resolves a send without throwing when unconfigured", async () => {
    const logged = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await getEmailAdapter().send({
      to: "poc@example.org",
      subject: "We received your Rogue Raise sponsorship interest",
      html: "<p>Thanks!</p>",
    });
    expect(result).toEqual({ id: "dev" });
    expect(logged).toHaveBeenCalledOnce();
  });
});
