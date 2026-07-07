/**
 * Email adapter seam. Default provider is Resend (PRD §3); a dev fallback logs to
 * the console so the flow runs with no credentials. Bulk sends go through a queue
 * elsewhere — this adapter is the single-send primitive.
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
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

const devEmailAdapter: EmailAdapter = {
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
  // Real Resend implementation is wired in when the first email-sending story
  // lands; until then dev logging keeps the seam usable without credentials.
  adapter = devEmailAdapter;
  return adapter;
}
