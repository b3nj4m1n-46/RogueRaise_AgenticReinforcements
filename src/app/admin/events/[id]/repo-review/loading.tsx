/** Route-level loading skeleton for repo review. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-10 px-6 py-16">
      <p role="status" className="sr-only">
        Loading the repository…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-10">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-3">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <div className="h-12 w-full animate-pulse rounded bg-muted" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 w-full animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </main>
  );
}
