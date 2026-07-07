export const metadata = {
  title: "Rogue Raise",
  description:
    "White Rabbit's community build event — raise something that lasts.",
};

export default function RogueRaiseHubPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>
      <h1 className="font-serif text-5xl font-semibold text-ink">Rogue Raise</h1>
      <p className="max-w-prose text-lg text-ink/80">
        A community build event modeled on a barn raise. Neighbors gather to
        raise working software and practical tools that solve a real problem
        facing the Rogue Valley — and every project is handed to a committed
        steward who carries it forward.
      </p>
      <p className="text-sm text-ink/60">
        Platform foundation is in place. Sponsor sign-up is the first flow.
      </p>
    </main>
  );
}
