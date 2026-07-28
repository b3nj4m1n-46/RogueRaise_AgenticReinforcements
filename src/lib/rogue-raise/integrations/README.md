# Integration adapters

Every external service the platform touches lives behind a thin adapter in this
directory, configured from env vars only (PRD §3.1). This is the **portability
seam**: nothing in feature code hard-depends on a concrete provider, so at merge
WR staff swap credentials/providers without touching feature logic.

| Adapter | Provider (default) | Env |
|---------|--------------------|-----|
| `email` | Resend | `RESEND_API_KEY`, `RR_EMAIL_FROM` |
| `blob` | Vercel Blob | `BLOB_READ_WRITE_TOKEN` |
| `ai-gateway` | Vercel AI Gateway | `AI_GATEWAY_API_KEY`, `RR_AI_MODEL_*` |
| `github` | GitHub App | `RR_GITHUB_*`, `RR_GITHUB_ORG` |
| `auth` | Better Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| `spam` | Vercel BotID / hCaptcha (honeypot + signed timestamp in dev) | `RR_SPAM_SECRET` (falls back to `RR_MAGIC_LINK_SECRET`) |

Each adapter exports an interface + a factory (`getXAdapter()`) that picks a real
implementation when configured and a dev fallback otherwise, so the whole flow
runs on a laptop with no WR credentials. Implementations are filled in when the
first user story reaches them — the interfaces are the stable contract.
