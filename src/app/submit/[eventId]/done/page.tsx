import Link from "next/link";

export const metadata = { title: "Submitted · Rogue Raise" };

export default function SubmittedPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
        That&rsquo;s in
      </h1>
      <p className="max-w-prose text-lg text-ink/80">
        Your project is with the judges. Pitches are at 4:00 PM — five minutes,
        and they&rsquo;ve already read your summary. Results at 6:00.
      </p>
      <p className="max-w-prose text-ink/70">
        Go get a drink of water. You&rsquo;ve earned it.
      </p>
      <div>
        <Link
          href="/rogue-raise"
          className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          Back to Rogue Raise
        </Link>
      </div>
    </main>
  );
}
