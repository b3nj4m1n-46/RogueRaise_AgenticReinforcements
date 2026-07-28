import Link from "next/link";
import { notFound } from "next/navigation";

import { loadResults } from "@/lib/rogue-raise/judging/queries";

import { ResultsConsole } from "./results-console";

export const metadata = { title: "Results · Rogue Raise" };

// Scores land while this page is open — never cached.
export const dynamic = "force-dynamic";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const results = await loadResults(id);
  if (!results) notFound();

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">
          {results.event.title}
        </h1>
        <p className="max-w-prose text-ink/80">
          Scores, ties, and awards. Nothing here decides a winner for you.
        </p>
        <p className="text-sm">
          <Link
            href={`/admin/events/${id}`}
            className="font-medium text-ink underline underline-offset-4"
          >
            ← Back to the event
          </Link>
        </p>
      </header>

      <ResultsConsole results={results} />
    </main>
  );
}
