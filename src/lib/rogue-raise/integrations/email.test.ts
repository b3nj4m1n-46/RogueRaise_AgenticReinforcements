/**
 * The email seam. `fetch` is mocked: these prove what we SEND to Resend and how
 * we handle what comes back. Whether Resend then delivers is a smoke test
 * against a real key — `npm run verify:providers -- --write`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getEmailAdapter,
  resetEmailAdapter,
} from "@/lib/rogue-raise/integrations/email";

const ORIGINAL_ENV = { ...process.env };
const fetchMock = vi.fn();

const MESSAGE = {
  to: "someone@example.org",
  subject: "Your intake link",
  html: "<p>Hello</p>",
  text: "Hello",
};

function ok(body: unknown = { id: "msg_1" }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetEmailAdapter();
  fetchMock.mockReset().mockResolvedValue(ok());
  vi.stubGlobal("fetch", fetchMock);
  process.env.RESEND_API_KEY = "re_test";
  process.env.RR_EMAIL_FROM = "Rogue Raise <rr@example.org>";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  resetEmailAdapter();
});

describe("provider selection", () => {
  it("uses Resend when a key is present", () => {
    expect(getEmailAdapter().provider).toBe("resend");
  });

  it("uses the dev provider without one, outside production", () => {
    delete process.env.RESEND_API_KEY;
    resetEmailAdapter();
    expect(getEmailAdapter().provider).toBe("dev");
  });

  it("REFUSES the dev provider in production", () => {
    // Every magic link would vanish into a log file, and the event would be
    // discovered broken by a room of volunteers with no way in.
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "production");
    resetEmailAdapter();
    expect(() => getEmailAdapter()).toThrow(/Email not configured/);
    vi.unstubAllEnvs();
  });

  it("memoizes the adapter", () => {
    expect(getEmailAdapter()).toBe(getEmailAdapter());
  });
});

describe("dev provider", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    resetEmailAdapter();
  });

  it("announces the send rather than swallowing it", async () => {
    const logged = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await getEmailAdapter().send({
      to: "poc@example.org",
      subject: "We received your Rogue Raise sponsorship interest",
      html: "<p>Thanks!</p>",
    });
    // A silent no-op looks exactly like a working mailer until it matters.
    expect(result).toEqual({ id: "dev" });
    expect(logged).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resend provider", () => {
  async function sentBody() {
    await getEmailAdapter().send(MESSAGE);
    return JSON.parse(fetchMock.mock.calls[0][1].body as string);
  }

  it("posts to Resend with the configured sender", async () => {
    const body = await sentBody();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(body.from).toBe("Rogue Raise <rr@example.org>");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer re_test");
  });

  it("always sends `to` as an array", async () => {
    expect((await sentBody()).to).toEqual(["someone@example.org"]);
  });

  it("passes a list through unchanged", async () => {
    await getEmailAdapter().send({
      ...MESSAGE,
      to: ["a@example.org", "b@example.org"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(["a@example.org", "b@example.org"]);
  });

  it("includes the plain-text part", async () => {
    // A text part is most of what keeps these out of spam folders.
    expect((await sentBody()).text).toBe("Hello");
  });

  it("uses Resend's snake_case reply_to", async () => {
    await getEmailAdapter().send({ ...MESSAGE, replyTo: "wr@example.org" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reply_to).toBe("wr@example.org");
    expect(body).not.toHaveProperty("replyTo");
  });

  it("omits optional fields rather than sending nulls", async () => {
    await getEmailAdapter().send({
      to: "x@example.org",
      subject: "s",
      html: "<p>h</p>",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("reply_to");
  });

  it("returns the message id", async () => {
    expect(await getEmailAdapter().send(MESSAGE)).toEqual({ id: "msg_1" });
  });

  it("THROWS on rejection, carrying Resend's own reason", async () => {
    fetchMock.mockResolvedValue(
      new Response("The domain is not verified.", { status: 422 }),
    );
    // Callers log per-recipient failures; "422" alone tells a staff member
    // nothing about what to fix.
    await expect(getEmailAdapter().send(MESSAGE)).rejects.toThrow(
      /422.*domain is not verified/s,
    );
  });

  it("still throws usefully when the error body can't be read", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(getEmailAdapter().send(MESSAGE)).rejects.toThrow(/500/);
  });

  it("survives a success response with no JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await expect(getEmailAdapter().send(MESSAGE)).resolves.toEqual({
      id: undefined,
    });
  });

  it("propagates a network failure rather than reporting success", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(getEmailAdapter().send(MESSAGE)).rejects.toThrow("ECONNRESET");
  });
});
