/**
 * Route-level loading skeleton for one event. Visual bones are `aria-hidden`;
 * one polite live region announces the load.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-16">
      <p role="status" className="sr-only">
        Loading this event…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-10">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 w-80 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-5 w-56 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-44 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-56 w-full animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div className="h-7 w-48 animate-pulse rounded bg-muted" />
            <div className="h-16 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </main>
  );
}
