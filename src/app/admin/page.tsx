export const metadata = {
  title: "Admin · Rogue Raise",
};

export default function AdminHomePage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        WR Admin
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink">
        Rogue Raise console
      </h1>
      <p className="max-w-prose text-ink/80">
        One place for White Rabbit staff to run every phase: sponsor curation,
        intake, agent runs, registration, judging, and handoff. Surfaces land
        here as their stories are built.
      </p>
    </main>
  );
}
