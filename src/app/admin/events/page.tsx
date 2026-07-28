import Link from "next/link";

import {
  countAdminEventsByStatus,
  listAdminEvents,
} from "@/lib/rogue-raise/events/queries";
import { eventStatusLabel } from "@/lib/rogue-raise/events/status";
import { formatWeekendLabel } from "@/lib/rogue-raise/intake/schedule";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Events · Rogue Raise",
};

// Statuses and intake progress change under us constantly — never cached.
export const dynamic = "force-dynamic";

/**
 * A curated subset of `event_status`, not all fifteen: these are the phases a
 * staff member actually filters by day to day. "All" is the default so nothing
 * is ever hidden by a filter the user didn't choose.
 */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "intake_pending", label: "Intake pending" },
  { key: "intake_complete", label: "Intake complete" },
  { key: "registration_open", label: "Registration open" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function parseStatus(raw: string | string[] | undefined): FilterKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = FILTERS.find((f) => f.key === value);
  return match ? match.key : "all";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  const active = parseStatus(status);

  const [rows, counts] = await Promise.all([
    listAdminEvents(active === "all" ? undefined : active),
    countAdminEventsByStatus(),
  ]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const countFor = (key: FilterKey) => (key === "all" ? total : (counts[key] ?? 0));

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">Events</h1>
        <p className="max-w-prose text-ink/80">
          Every Rogue Raise and where it stands. Open one to read the sponsor&rsquo;s
          intake and lock in the weekend.
        </p>
      </header>

      <nav aria-label="Filter events by status">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const isActive = f.key === active;
            return (
              <li key={f.key}>
                <Link
                  href={`/admin/events?status=${f.key}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-ink bg-ink font-semibold text-background underline underline-offset-4"
                      : "border-wr-olive-green/40 text-ink hover:bg-muted",
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-xs font-semibold",
                      isActive
                        ? "bg-background/20 text-background"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {countFor(f.key)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading" className="sr-only">
          {active === "all" ? "All events" : eventStatusLabel(active)}
        </h2>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-wr-olive-green/40 p-8 text-center">
            <p className="text-ink/80">
              {total === 0
                ? "No events yet — approving a sponsor application creates one."
                : "No events in this phase right now."}
            </p>
            {total > 0 ? (
              <p className="mt-1 text-sm">
                <Link
                  href="/admin/events?status=all"
                  className="font-medium text-ink underline underline-offset-4"
                >
                  View all events
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const missing = row.completeness.required.filter((r) => !r.met);
              return (
                <li
                  key={row.id}
                  className="relative rounded-lg border border-wr-olive-green/25 p-4 transition-colors hover:bg-muted/60"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* One tab stop per row: the title is a stretched link. */}
                    <Link
                      href={`/admin/events/${row.id}`}
                      className="font-serif text-lg font-semibold text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      {row.organizationName}
                    </Link>
                    <span className="rounded-full border border-wr-olive-green/50 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink/80">
                      {eventStatusLabel(row.status)}
                    </span>
                  </div>

                  <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="text-ink/60">Event</dt>
                    <dd className="text-ink/90">{row.title}</dd>

                    <dt className="text-ink/60">Weekend</dt>
                    <dd className="text-ink/90">
                      {row.confirmedFridayKickoffAt ? (
                        <>
                          {formatWeekendLabel(new Date(row.confirmedFridayKickoffAt))}{" "}
                          <span className="text-ink/60">(confirmed)</span>
                        </>
                      ) : (
                        "Not confirmed"
                      )}
                    </dd>

                    <dt className="text-ink/60">Intake</dt>
                    <dd className="text-ink/90">
                      {row.completeness.complete ? (
                        "Complete"
                      ) : (
                        <>
                          {row.completeness.requiredMetCount} of{" "}
                          {row.completeness.requiredTotal} vital sections
                          {missing.length > 0 ? (
                            <span className="text-ink/60">
                              {" "}
                              — still needs {missing.map((m) => m.label).join(", ")}
                            </span>
                          ) : null}
                        </>
                      )}
                    </dd>

                    <dt className="text-ink/60">Created</dt>
                    <dd className="text-ink/90">
                      <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
                    </dd>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
