/**
 * Route-level loading skeleton for the events list. Visual bones are
 * `aria-hidden`; one polite live region announces the load.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-16">
      <p role="status" className="sr-only">
        Loading events…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-9 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 w-32 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 w-full animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </main>
  );
}
