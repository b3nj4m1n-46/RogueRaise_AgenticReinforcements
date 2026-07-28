import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/rogue-raise/db";
import {
  auditLog,
  events,
  organizations,
  sponsorApplications,
  stakeholders,
} from "@/lib/rogue-raise/db/schema";
import { isActionableAppStatus } from "@/lib/rogue-raise/sponsors/schema";

import {
  formatDate,
  formatFinancial,
  StatusPill,
  type QueueStatus,
} from "../status-pill";
import { DecisionForm } from "./decision-form";

export const metadata = {
  title: "Application detail · Rogue Raise",
};

export const dynamic = "force-dynamic";

// Guard before the query so a malformed id never reaches an `uuid` cast (which
// would throw a 500 instead of a clean 404).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SponsorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const [app] = await db
    .select({
      id: sponsorApplications.id,
      orgName: organizations.name,
      pocName: sponsorApplications.pocName,
      pocEmail: sponsorApplications.pocEmail,
      pocPhone: sponsorApplications.pocPhone,
      painPoints: sponsorApplications.painPoints,
      goalsNeeds: sponsorApplications.goalsNeeds,
      amount: sponsorApplications.financialCommitmentAmount,
      financialNote: sponsorApplications.financialCommitmentNote,
      toDiscuss: sponsorApplications.financialCommitmentToDiscuss,
      status: sponsorApplications.status,
      adminNote: sponsorApplications.adminNote,
      submittedAt: sponsorApplications.submittedAt,
    })
    .from(sponsorApplications)
    .innerJoin(organizations, eq(sponsorApplications.orgId, organizations.id))
    .where(eq(sponsorApplications.id, id))
    .limit(1);

  if (!app) notFound();

  // Stakeholders hang off the linked event (created with it in story 1).
  const [event] = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(eq(events.sponsorApplicationId, id))
    .limit(1);

  const stakeholderRows = event
    ? await db
        .select({
          id: stakeholders.id,
          name: stakeholders.name,
          email: stakeholders.email,
          phone: stakeholders.phone,
        })
        .from(stakeholders)
        .where(eq(stakeholders.eventId, event.id))
        .orderBy(stakeholders.createdAt)
    : [];

  const actionable = isActionableAppStatus(app.status);

  // Decided applications show a resolved banner instead of the decision island;
  // the outcome metadata comes from the audit trail written by the action.
  let decision:
    | { status: QueueStatus; actor: string | null; at: Date }
    | undefined;
  if (!actionable) {
    const [row] = await db
      .select({
        action: auditLog.action,
        actor: auditLog.actor,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, "sponsor_application"),
          sql`${auditLog.metadata} ->> 'applicationId' = ${id}`,
          inArray(auditLog.action, [
            "sponsor_application.approved",
            "sponsor_application.rejected",
          ]),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    if (row) {
      decision = { status: app.status, actor: row.actor, at: row.createdAt };
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/admin/sponsors"
          className="inline-flex min-h-9 items-center text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          ← Back to queue
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin · Sponsor application
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl font-semibold text-ink">
            {app.orgName}
          </h1>
          <StatusPill status={app.status} />
        </div>
        <p className="text-sm text-ink/70">
          {app.submittedAt
            ? `Submitted ${formatDate(app.submittedAt)}`
            : "Not yet submitted"}
        </p>
      </header>

      {/* --- Primary contact --- */}
      <section aria-labelledby="contact-heading" className="flex flex-col gap-3">
        <h2
          id="contact-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Primary contact
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[8rem_1fr]">
          <dt className="text-sm text-ink/60">Name</dt>
          <dd className="text-ink">{app.pocName}</dd>

          <dt className="text-sm text-ink/60">Email</dt>
          <dd className="text-ink">
            <a
              href={`mailto:${app.pocEmail}`}
              className="text-ink underline underline-offset-4 hover:text-primary"
            >
              {app.pocEmail}
            </a>
          </dd>

          <dt className="text-sm text-ink/60">Phone</dt>
          <dd className="text-ink">
            <a
              href={`tel:${app.pocPhone}`}
              className="text-ink underline underline-offset-4 hover:text-primary"
            >
              {app.pocPhone}
            </a>
          </dd>
        </dl>
      </section>

      {/* --- The problem --- */}
      <section aria-labelledby="problem-heading" className="flex flex-col gap-3">
        <h2
          id="problem-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          The problem
        </h2>
        <p className="whitespace-pre-wrap text-ink/90">{app.painPoints}</p>
      </section>

      {/* --- Goals & needs --- */}
      <section aria-labelledby="goals-heading" className="flex flex-col gap-3">
        <h2
          id="goals-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Goals and needs
        </h2>
        <p className="whitespace-pre-wrap text-ink/90">{app.goalsNeeds}</p>
      </section>

      {/* --- Financial commitment --- */}
      <section
        aria-labelledby="financial-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="financial-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Financial commitment
        </h2>
        <p className="text-ink">
          <span className="text-2xl font-semibold">
            {formatFinancial(app.amount, app.toDiscuss)}
          </span>
        </p>
        {app.financialNote ? (
          <p className="whitespace-pre-wrap text-ink/80">{app.financialNote}</p>
        ) : null}
      </section>

      {/* --- Stakeholders --- */}
      <section
        aria-labelledby="stakeholders-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="stakeholders-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Stakeholders
        </h2>
        {stakeholderRows.length === 0 ? (
          <p className="text-ink/70">No stakeholders were listed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                People at {app.orgName} to keep in the loop.
              </caption>
              <thead>
                <tr className="border-b border-wr-olive-green/30 text-xs uppercase tracking-wide text-ink/70">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Name
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Email
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Phone
                  </th>
                </tr>
              </thead>
              <tbody>
                {stakeholderRows.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-wr-olive-green/15"
                  >
                    <th
                      scope="row"
                      className="py-2 pr-4 align-top font-medium text-ink"
                    >
                      {s.name}
                    </th>
                    <td className="py-2 pr-4 align-top">
                      <a
                        href={`mailto:${s.email}`}
                        className="text-ink underline underline-offset-4 hover:text-primary"
                      >
                        {s.email}
                      </a>
                    </td>
                    <td className="py-2 align-top">
                      {s.phone ? (
                        <a
                          href={`tel:${s.phone}`}
                          className="whitespace-nowrap text-ink underline underline-offset-4 hover:text-primary"
                        >
                          {s.phone}
                        </a>
                      ) : (
                        <span className="text-ink/60">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- Decision / resolved banner --- */}
      <section aria-labelledby="decision-heading" className="flex flex-col gap-3">
        <h2
          id="decision-heading"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Decision
        </h2>
        {actionable ? (
          <DecisionForm applicationId={app.id} />
        ) : (
          <ResolvedBanner
            status={app.status}
            decision={decision}
            adminNote={app.adminNote}
          />
        )}
      </section>
    </main>
  );
}

function ResolvedBanner({
  status,
  decision,
  adminNote,
}: {
  status: QueueStatus;
  decision?: { actor: string | null; at: Date };
  adminNote: string | null;
}) {
  const outcome = status === "approved" ? "approved" : "declined";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-wr-olive-green/30 bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        <p className="text-ink">
          This application was <strong>{outcome}</strong>
          {decision ? (
            <>
              {" "}
              on {formatDate(decision.at)}
              {decision.actor ? ` by ${decision.actor}` : ""}
            </>
          ) : null}
          .
        </p>
      </div>
      {adminNote ? (
        <div>
          <h3 className="text-sm font-semibold text-ink/70">Internal note</h3>
          <p className="mt-1 whitespace-pre-wrap text-ink/90">{adminNote}</p>
        </div>
      ) : null}
    </div>
  );
}
