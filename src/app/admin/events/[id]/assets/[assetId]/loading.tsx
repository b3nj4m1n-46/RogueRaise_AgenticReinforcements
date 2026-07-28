/** Route-level loading skeleton for one generated draft. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
      <p role="status" className="sr-only">
        Loading this draft…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-8">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-9 w-80 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-12 w-full animate-pulse rounded bg-muted" />
        <div className="h-96 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    </main>
  );
}
