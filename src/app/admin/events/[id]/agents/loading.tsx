/** Route-level loading skeleton for the agents page. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-10 px-6 py-16">
      <p role="status" className="sr-only">
        Loading agents…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-10">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-36 w-full animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </main>
  );
}
