/**
 * Route-level loading skeleton for the intake form. The visual bones are
 * `aria-hidden`; a single polite live region announces the load to AT.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-16">
      <p role="status" className="sr-only">
        Loading your intake form…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-10">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-10 w-80 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>

        {/* Progress panel */}
        <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />

        {/* Sections */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div className="h-7 w-56 animate-pulse rounded bg-muted" />
            <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </main>
  );
}
