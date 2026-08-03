import Link from "next/link";
import { notFound } from "next/navigation";

import { isPublicEvent, loadLandingPage } from "@/lib/rogue-raise/events/landing";
import { getSpamGuard } from "@/lib/rogue-raise/integrations/spam";

import { RegistrationForm } from "./registration-form";

export const metadata = { title: "Register · Rogue Raise" };

// The signed spam challenge is minted per request, so never statically cached.
export const dynamic = "force-dynamic";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await loadLandingPage(slug);
  if (!event || !isPublicEvent(event.status)) notFound();

  // Registration closed is a real state with its own page, not a 404 — the link
  // may be in an email someone opens a week late.
  if (!event.registrationOpen) {
    return (
      <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Registration is closed
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          {event.title} isn&rsquo;t taking new registrations right now.
        </p>
        <div>
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            Back to the event
          </Link>
        </div>
      </main>
    );
  }

  const challenge = getSpamGuard().issueChallenge();

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-16 sm:py-20">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Register to build
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          {event.title}
          {event.weekendLabel ? ` · ${event.weekendLabel}` : ""}
        </p>
        <p className="max-w-prose text-sm text-ink/60">
          Four fields. We&rsquo;ll email you the rules and what to bring.
        </p>
      </header>

      <RegistrationForm
        eventSlug={event.slug}
        challengeTs={challenge.renderedAt}
        challengeSig={challenge.sig}
      />
    </main>
  );
}
