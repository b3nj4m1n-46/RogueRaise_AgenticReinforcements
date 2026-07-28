import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { loadAdminEvent } from "@/lib/rogue-raise/events/queries";
import {
  canConfirmWeekend,
  canReissueIntakeInvite,
  eventStatusLabel,
  isLateConfirm,
} from "@/lib/rogue-raise/events/status";
import {
  describeSchedule,
  formatWeekendLabel,
} from "@/lib/rogue-raise/intake/schedule";

import { EventActions, type WeekendChoice } from "./event-actions";

export const metadata = {
  title: "Event · Rogue Raise",
};

export const dynamic = "force-dynamic";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-serif text-2xl font-semibold text-wr-olive-green">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Long free text keeps the sponsor's own line breaks. */
function Prose({ value }: { value: string | null }) {
  if (!value?.trim()) {
    return <p className="text-ink/60">Not provided.</p>;
  }
  return <p className="max-w-prose whitespace-pre-wrap text-ink/90">{value}</p>;
}

export default async function AdminEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const event = await loadAdminEvent(id);
  if (!event) notFound();

  const weekends: WeekendChoice[] = event.weekends.map((w) => ({
    id: w.id,
    label: formatWeekendLabel(w.schedule.fridayKickoffAt),
    lines: describeSchedule(w.schedule.fridayKickoffAt),
    isConfirmed: w.isConfirmed,
  }));

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-16">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/admin/events"
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          ← All events
        </Link>
        <Link
          href={`/admin/events/${id}/agents`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Agents &amp; drafts →
        </Link>
        <Link
          href={`/admin/events/${id}/repo-review`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Repo review →
        </Link>
        <Link
          href={`/admin/events/${id}/submissions`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Submissions →
        </Link>
        <Link
          href={`/admin/events/${id}/results`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Results &amp; awards →
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">
          {event.organizationName}
        </h1>
        <p className="text-lg text-ink/80">{event.title}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full border border-wr-olive-green/50 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink/80">
            {eventStatusLabel(event.status)}
          </span>
          <span className="text-ink/70">
            {event.confirmedFridayKickoffAt
              ? `Weekend confirmed: ${formatWeekendLabel(new Date(event.confirmedFridayKickoffAt))}`
              : "No weekend confirmed yet"}
          </span>
        </div>
      </header>

      {/* Intake progress — the same evaluation the sponsor sees on their form. */}
      <section
        aria-labelledby="intake-progress"
        className="rounded-lg border border-input bg-secondary/40 p-5"
      >
        <h2 id="intake-progress" className="font-serif text-xl font-semibold text-ink">
          Intake progress
        </h2>
        <p className="mt-1 text-sm text-ink/70">
          {event.completeness.requiredMetCount} of {event.completeness.requiredTotal}{" "}
          vital sections complete
          {event.intake?.completedAt ? " · intake submitted" : ""}.
        </p>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {[...event.completeness.required, ...event.completeness.optional].map((req) => (
            <li key={req.key} className="flex gap-2">
              <span aria-hidden="true" className="font-mono text-ink/70">
                {req.met ? "✓" : "○"}
              </span>
              <span className="text-ink/90">
                {req.label}
                <span className="text-ink/60">
                  {req.met ? " — provided" : " — not yet"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <EventActions
        eventId={event.id}
        weekends={weekends}
        canConfirm={canConfirmWeekend(event.status)}
        lateConfirm={isLateConfirm(event.status)}
        canReissue={canReissueIntakeInvite(event.status)}
        pocEmail={event.application?.pocEmail ?? null}
      />

      {event.application ? (
        <Section id="sponsor" title="Sponsor">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink/60">Contact</dt>
            <dd className="text-ink/90">{event.application.pocName}</dd>
            <dt className="text-ink/60">Email</dt>
            <dd className="text-ink/90">
              <a
                href={`mailto:${event.application.pocEmail}`}
                className="underline underline-offset-4"
              >
                {event.application.pocEmail}
              </a>
            </dd>
            <dt className="text-ink/60">Phone</dt>
            <dd className="text-ink/90">
              <a
                href={`tel:${event.application.pocPhone}`}
                className="underline underline-offset-4"
              >
                {event.application.pocPhone}
              </a>
            </dd>
          </dl>
          <h3 className="mt-2 text-base font-medium text-ink">The problem</h3>
          <Prose value={event.application.painPoints} />
          <h3 className="mt-2 text-base font-medium text-ink">Goals &amp; needs</h3>
          <Prose value={event.application.goalsNeeds} />
          {event.application.adminNote ? (
            <>
              <h3 className="mt-2 text-base font-medium text-ink">
                Internal note from curation
              </h3>
              <Prose value={event.application.adminNote} />
            </>
          ) : null}
        </Section>
      ) : null}

      <Section id="stakeholders" title="Stakeholders">
        {event.stakeholders.length === 0 ? (
          <p className="text-ink/60">None listed.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {event.stakeholders.map((s) => (
              <li key={s.id} className="text-ink/90">
                <span className="font-medium">{s.name}</span> —{" "}
                <a href={`mailto:${s.email}`} className="underline underline-offset-4">
                  {s.email}
                </a>
                {s.phone ? ` — ${s.phone}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="context" title="Supporting context">
        <Prose value={event.intake?.supplementaryInfo ?? null} />
        {event.attachments.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {event.attachments.map((file) => (
              <li key={file.id} className="text-ink/90">
                <a
                  href={`/admin/events/${event.id}/attachments/${file.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {file.filename}
                </a>
                <span className="ml-2 text-ink/60">{formatBytes(file.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">No files attached.</p>
        )}
      </Section>

      <Section id="stack" title="Stakeholder technical stack">
        <Prose value={event.intake?.stakeholderTechStack ?? null} />
        {event.intake?.stakeholderTechTags.length ? (
          <ul className="flex flex-wrap gap-2">
            {event.intake.stakeholderTechTags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-wr-olive-green/40 px-3 py-0.5 font-mono text-xs text-ink/80"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section id="judges" title="Judges">
        {event.judges.length === 0 ? (
          <p className="text-ink/60">
            None yet — judge invitations can&rsquo;t go out until these are provided.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {event.judges.map((j) => (
              <li key={j.id} className="text-ink/90">
                <span className="font-medium">{j.name}</span> —{" "}
                <a href={`mailto:${j.email}`} className="underline underline-offset-4">
                  {j.email}
                </a>
                {j.phone ? ` — ${j.phone}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="criteria" title="Evaluative criteria">
        {event.criteria.length === 0 ? (
          <p className="text-ink/60">None yet — the judging form needs these.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {event.criteria.map((c) => (
              <li key={c.id} className="text-ink/90">
                <span className="font-medium">{c.label}</span>
                {c.weight ? (
                  <span className="ml-2 text-ink/60">weight {c.weight}</span>
                ) : null}
                {c.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-ink/70">{c.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="awards" title="Awards budget">
        <p className="text-ink/90">
          {event.intake?.awardsBudgetAmount
            ? `$${event.intake.awardsBudgetAmount}`
            : "No amount given"}
        </p>
        {event.intake?.awardsBudgetNote ? (
          <Prose value={event.intake.awardsBudgetNote} />
        ) : null}
      </Section>

      <Section id="tech-sponsors" title="Technical sponsors">
        {event.techSponsors.length === 0 ? (
          <p className="text-ink/60">None listed.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {event.techSponsors.map((s) => (
              <li key={s.id} className="text-ink/90">
                <span className="font-medium">{s.name}</span>
                {s.status ? <span className="ml-2 text-ink/60">{s.status}</span> : null}
                {s.offering ? (
                  <p className="mt-1 whitespace-pre-wrap text-ink/70">{s.offering}</p>
                ) : null}
                {s.contactEmail ? (
                  <p className="mt-1 text-ink/70">
                    {s.contactName ? `${s.contactName} — ` : ""}
                    <a
                      href={`mailto:${s.contactEmail}`}
                      className="underline underline-offset-4"
                    >
                      {s.contactEmail}
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
