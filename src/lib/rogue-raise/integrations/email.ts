/**
 * Email adapter seam (PRD §3, §10).
 *
 * Two providers, selected from the environment exactly like the AI, blob, and
 * GitHub seams:
 *
 *   - **resend** — the real thing, when `RESEND_API_KEY` is present.
 *   - **dev** — logs to the console so the whole flow runs on a laptop with no
 *     credentials. It announces every send rather than swallowing it, because a
 *     silent no-op looks exactly like a working mailer right up until it
 *     matters.
 *
 * **Production refuses the dev provider.** Every email this app sends is either
 * a magic link somebody needs to do their job, or the only notice a sponsor gets
 * that their application was decided. An event where all of that silently went
 * to a log file would be discovered by a room of volunteers with no way in.
 *
 * Bulk fan-out is paced by `integrations/rate-limit.ts`; this adapter is the
 * single-send primitive underneath it.
 */
export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  id?: string;
}

export interface EmailAdapter {
  readonly provider: "resend" | "dev";
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** The sending identity. Must be a domain verified in Resend, or every send 403s. */
function fromAddress(): string {
  return process.env.RR_EMAIL_FROM ?? "Rogue Raise <rogue-raise@whiterabbitashland.com>";
}

/**
 * Resend over its REST API rather than the `resend` SDK.
 *
 * One `fetch` against one documented endpoint is less to carry than a dependency
 * — and it keeps this file honest about being a thin adapter, which is the
 * property PRD §3.1 actually asks for (nothing hard-depending on private WR
 * infrastructure).
 */
const resendEmailAdapter: EmailAdapter = {
  provider: "resend",
  async send(input) {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        // Resend expects `text` alongside `html`; senders here always provide
        // both, and a plain-text part is what keeps these out of spam folders.
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // The body carries Resend's own reason (unverified domain, bad key, rate
      // limit). Surfacing it beats a bare status: every caller of this logs the
      // failure per-recipient, and "422" alone tells a staff member nothing.
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // Ignore — the status is still worth reporting.
      }
      throw new Error(
        `Resend rejected the send (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { id: body.id };
  },
};

const devEmailAdapter: EmailAdapter = {
  provider: "dev",
  async send(input) {
    console.info("[email:dev] would send", {
      to: input.to,
      subject: input.subject,
    });
    return { id: "dev" };
  },
};

let adapter: EmailAdapter | undefined;

export function getEmailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  if (process.env.RESEND_API_KEY) {
    adapter = resendEmailAdapter;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Email not configured (set RESEND_API_KEY). The dev provider is refused in production — it logs instead of sending, and every magic link would vanish.",
    );
  } else {
    adapter = devEmailAdapter;
  }
  return adapter;
}

/** Test seam — resets the memoized provider selection. */
export function resetEmailAdapter(): void {
  adapter = undefined;
}
