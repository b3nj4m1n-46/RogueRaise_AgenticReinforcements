import Link from "next/link";

import { listPublicEvents } from "@/lib/rogue-raise/events/landing";

export const metadata = {
  title: "Rogue Raise",
  description:
    "White Rabbit's community build event — raise something that lasts.",
};

// Lists live events, so never statically cached.
export const dynamic = "force-dynamic";

export default async function RogueRaiseHubPage() {
  const publicEvents = await listPublicEvents();

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-10 px-6 py-24">
      <header className="flex flex-col gap-6">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          White Rabbit · Ashland, OR
        </p>
        <h1 className="font-serif text-5xl font-semibold text-ink">Rogue Raise</h1>
        <p className="max-w-prose text-lg text-ink/80">
          A community build event modeled on a barn raise. Neighbors gather to
          raise working software and practical tools that solve a real problem
          facing the Rogue Valley — and every project is handed to a committed
          steward who carries it forward.
        </p>
      </header>

      <section aria-labelledby="upcoming" className="flex flex-col gap-4">
        <h2
          id="upcoming"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Upcoming raises
        </h2>
        {publicEvents.length === 0 ? (
          <p className="text-ink/70">
            Nothing scheduled publicly just yet — sponsoring organizations are in
            the works.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {publicEvents.map((event) => (
              <li
                key={event.slug}
                className="rounded-lg border border-wr-olive-green/25 p-4"
              >
                <Link
                  href={`/events/${event.slug}`}
                  className="font-serif text-lg font-semibold text-ink underline-offset-4 hover:underline"
                >
                  {event.title}
                </Link>
                <p className="mt-1 text-sm text-ink/70">
                  With {event.organizationName}
                  {event.weekendLabel ? ` · ${event.weekendLabel}` : ""}
                  {event.registrationOpen ? " · registration open" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sponsor" className="flex flex-col gap-3">
        <h2
          id="sponsor"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Have a problem worth raising?
        </h2>
        <p className="max-w-prose text-ink/80">
          If your organization is carrying a problem that a weekend of volunteers
          could genuinely move, tell us about it.
        </p>
        <div>
          <Link
            href="/sponsor"
            className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Sponsor a Rogue Raise
          </Link>
        </div>
      </section>
    </main>
  );
}
