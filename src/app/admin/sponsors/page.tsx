import Link from "next/link";
import { count, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/rogue-raise/db";
import { organizations, sponsorApplications } from "@/lib/rogue-raise/db/schema";
import { cn } from "@/lib/utils";

import {
  formatDate,
  formatFinancial,
  StatusPill,
  STATUS_META,
  type QueueStatus,
} from "./status-pill";

export const metadata = {
  title: "Sponsor curation queue · Rogue Raise",
};

// Counts + rows must reflect every decision immediately — never statically cached.
export const dynamic = "force-dynamic";

const STATUS_VALUES: readonly QueueStatus[] = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
];

/** Filter key = a concrete status or the pseudo-"all". */
type FilterKey = QueueStatus | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Under review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

/** Validate `?status=` against the enum; anything else falls back to `submitted`. */
function parseStatus(raw: string | string[] | undefined): FilterKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "all") return "all";
  if (value && (STATUS_VALUES as readonly string[]).includes(value)) {
    return value as QueueStatus;
  }
  return "submitted";
}

export default async function SponsorQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  const active = parseStatus(status);

  // One grouped count query powers every filter badge (never findMany().length).
  const grouped = await db
    .select({ status: sponsorApplications.status, value: count() })
    .from(sponsorApplications)
    .groupBy(sponsorApplications.status);

  const counts = new Map<string, number>();
  let total = 0;
  for (const g of grouped) {
    counts.set(g.status, g.value);
    total += g.value;
  }
  const countFor = (key: FilterKey) =>
    key === "all" ? total : (counts.get(key) ?? 0);

  const rows = await db
    .select({
      id: sponsorApplications.id,
      orgName: organizations.name,
      pocName: sponsorApplications.pocName,
      amount: sponsorApplications.financialCommitmentAmount,
      toDiscuss: sponsorApplications.financialCommitmentToDiscuss,
      submittedAt: sponsorApplications.submittedAt,
      status: sponsorApplications.status,
    })
    .from(sponsorApplications)
    .innerJoin(
      organizations,
      eq(sponsorApplications.orgId, organizations.id),
    )
    .where(active === "all" ? undefined : eq(sponsorApplications.status, active))
    .orderBy(
      // Newest submissions first; unsubmitted (null) sink to the bottom, then a
      // stable created_at tiebreak disambiguates same-second / same-name orgs.
      sql`${sponsorApplications.submittedAt} desc nulls last`,
      desc(sponsorApplications.createdAt),
    );

  const activeLabel =
    active === "all" ? "All applications" : STATUS_META[active].label;

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">
          Sponsor curation queue
        </h1>
        <p className="max-w-prose text-ink/80">
          Review sponsorship applications and decide which Rogue Raises advance
          to intake. Newest submissions first.
        </p>
      </header>

      {/* Status filter — query-param links with live count badges. */}
      <nav aria-label="Filter applications by status">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const isActive = f.key === active;
            return (
              <li key={f.key}>
                <Link
                  href={`/admin/sponsors?status=${f.key}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors",
                    isActive
                      ? // Non-colour active cue: filled + bold + underline (not colour alone).
                        "border-ink bg-ink font-semibold text-background underline underline-offset-4"
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

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="sr-only">
          {activeLabel}
        </h2>

        {rows.length === 0 ? (
          <EmptyState active={active} total={total} />
        ) : (
          <>
            {/* Desktop: semantic table. */}
            <table className="hidden w-full border-collapse text-left text-sm md:table">
              <caption className="sr-only">
                {activeLabel}, sorted by submission date, newest first.
              </caption>
              <thead>
                <tr className="border-b border-wr-olive-green/30 text-xs uppercase tracking-wide text-ink/70">
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Organization
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Primary contact
                  </th>
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Financial commitment
                  </th>
                  <th
                    scope="col"
                    aria-sort="descending"
                    className="py-3 pr-4 font-medium"
                  >
                    Submitted
                  </th>
                  <th scope="col" className="py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="relative border-b border-wr-olive-green/15 transition-colors hover:bg-muted/60"
                  >
                    <th scope="row" className="py-3 pr-4 align-top font-medium">
                      {/* Single tab stop per row: the org name is a stretched link. */}
                      <Link
                        href={`/admin/sponsors/${r.id}`}
                        className="text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                      >
                        {r.orgName}
                      </Link>
                    </th>
                    <td className="py-3 pr-4 align-top text-ink/80">
                      {r.pocName}
                    </td>
                    <td className="py-3 pr-4 align-top text-ink/80">
                      {formatFinancial(r.amount, r.toDiscuss)}
                    </td>
                    <td className="py-3 pr-4 align-top text-ink/80">
                      {r.submittedAt ? (
                        <time dateTime={r.submittedAt.toISOString()}>
                          {formatDate(r.submittedAt)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 align-top">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: card list mirroring the same one-link-per-row rule. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="relative rounded-lg border border-wr-olive-green/25 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/admin/sponsors/${r.id}`}
                      className="font-serif text-lg font-semibold text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      {r.orgName}
                    </Link>
                    <StatusPill status={r.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-ink/60">Contact</dt>
                    <dd className="text-ink/90">{r.pocName}</dd>
                    <dt className="text-ink/60">Commitment</dt>
                    <dd className="text-ink/90">
                      {formatFinancial(r.amount, r.toDiscuss)}
                    </dd>
                    <dt className="text-ink/60">Submitted</dt>
                    <dd className="text-ink/90">
                      {r.submittedAt ? (
                        <time dateTime={r.submittedAt.toISOString()}>
                          {formatDate(r.submittedAt)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function EmptyState({
  active,
  total,
}: {
  active: FilterKey;
  total: number;
}) {
  // Whole queue empty vs. a filter with no matches get different, honest copy.
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-wr-olive-green/40 p-8 text-center">
        <p className="text-ink/80">No sponsor applications yet.</p>
        <p className="mt-1 text-sm text-ink/60">
          New submissions from the sponsor sign-up form will appear here.
        </p>
      </div>
    );
  }

  const label =
    active === "all" ? "applications" : `${STATUS_META[active as QueueStatus].label.toLowerCase()} applications`;
  return (
    <div className="rounded-lg border border-dashed border-wr-olive-green/40 p-8 text-center">
      <p className="text-ink/80">No {label} right now.</p>
      <p className="mt-1 text-sm">
        <Link
          href="/admin/sponsors?status=all"
          className="font-medium text-ink underline underline-offset-4"
        >
          View all applications
        </Link>
      </p>
    </div>
  );
}
