/**
 * Route-level loading skeleton for the curation queue. The visual bones are
 * `aria-hidden`; a single polite live region announces the load to AT.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-16">
      <p role="status" className="sr-only">
        Loading sponsor applications…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-9 w-72 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-28 animate-pulse rounded-full bg-muted"
            />
          ))}
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-3">
          <div className="hidden h-8 w-full animate-pulse rounded bg-muted md:block" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-lg bg-muted md:h-12"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
