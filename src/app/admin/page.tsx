import Link from "next/link";
import { count, eq, notInArray } from "drizzle-orm";

import { db } from "@/lib/rogue-raise/db";
import { events, sponsorApplications } from "@/lib/rogue-raise/db/schema";

export const metadata = {
  title: "Admin · Rogue Raise",
};

// The submitted-application count must be live on every visit — no static cache.
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  // COUNT query (never findMany().length) — seed of the M2 curation queue.
  const [row] = await db
    .select({ value: count() })
    .from(sponsorApplications)
    .where(eq(sponsorApplications.status, "submitted"));
  const submittedCount = row?.value ?? 0;

  // "In flight" = everything that still needs staff attention: not rejected,
  // not finished, not archived.
  const [eventRow] = await db
    .select({ value: count() })
    .from(events)
    .where(notInArray(events.status, ["rejected", "completed", "archived"]));
  const liveEventCount = eventRow?.value ?? 0;

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        WR Admin
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink">
        Rogue Raise console
      </h1>
      <p className="max-w-prose text-ink/80">
        One place for White Rabbit staff to run every phase: sponsor curation,
        intake, agent runs, registration, judging, and handoff. Surfaces land
        here as their stories are built.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink">
          Sponsor applications to review
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-2 py-0.5 font-mono text-xs font-semibold text-primary-foreground">
            {submittedCount}
          </span>
        </span>
        <Link
          href="/admin/sponsors"
          className="inline-flex min-h-9 items-center text-sm font-medium text-ink underline underline-offset-4 hover:text-primary"
        >
          Review queue →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink">
          Events in flight
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-2 py-0.5 font-mono text-xs font-semibold text-primary-foreground">
            {liveEventCount}
          </span>
        </span>
        <Link
          href="/admin/events"
          className="inline-flex min-h-9 items-center text-sm font-medium text-ink underline underline-offset-4 hover:text-primary"
        >
          All events →
        </Link>
      </div>
    </main>
  );
}
