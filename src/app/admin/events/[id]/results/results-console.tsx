"use client";

/**
 * Results console (PRD §7.3).
 *
 * The whole point of this screen is that a person, not the platform, decides
 * who won. Ties are shown as their own block ABOVE the standings, awards are
 * assigned by hand, and the announce step is separate from the assign step so
 * "we picked" and "we told everyone" are never the same click.
 */
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  announceAward,
  createAwardCategory,
  deleteAwardCategory,
  reopenAward,
  setAwardWinner,
} from "@/lib/rogue-raise/judging/award-actions";
import {
  closeJudging,
  openJudging,
  sendScoringLinksAction,
} from "@/lib/rogue-raise/judging/actions";
import type { ResultsView } from "@/lib/rogue-raise/judging/queries";
import { describeMethod, rankByCriterion } from "@/lib/rogue-raise/judging/scoring";
import { cn } from "@/lib/utils";

function fmt(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

export function ResultsConsole({ results }: { results: ResultsView }) {
  const { event, criteria, rows, ties, judgeProgress, awards } = results;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [newAward, setNewAward] = useState({ label: "", criterionId: "" });

  const teamName = (id: string) =>
    rows.find((r) => r.submissionId === id)?.teamName ?? "—";

  /** Every mutation lands here so exactly one place reports success/failure. */
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await fn();
      setMessage(
        result.ok
          ? { kind: "ok", text: okText }
          : { kind: "error", text: result.error ?? "That didn't work." },
      );
    });

  const scoredCount = rows.filter((r) => r.judgeCount > 0).length;

  return (
    <div className="flex flex-col gap-10">
      {message ? (
        <p
          role="alert"
          className={cn(
            "rounded-lg border p-3 text-sm text-ink",
            message.kind === "ok"
              ? "border-wr-olive-green bg-wr-olive-green/10"
              : "border-destructive bg-destructive/5",
          )}
        >
          {message.text}
        </p>
      ) : null}

      {/* --- Phase controls --------------------------------------------- */}
      <section aria-labelledby="phase" className="flex flex-col gap-3">
        <h2 id="phase" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Scoring
        </h2>
        <p className="text-sm text-ink/70">
          {event.status === "live"
            ? "Submissions are open. Opening judging closes them — do it after the last team submits."
            : event.status === "judging"
              ? "Judging is open. Judges can score and re-score until you close it."
              : `This event is "${event.status}". Scoring is closed.`}
        </p>
        <div className="flex flex-wrap gap-3">
          {event.status === "live" ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => openJudging(event.id), "Judging is open.")}
              className="h-11"
            >
              Close submissions &amp; open judging
            </Button>
          ) : null}
          {event.status === "judging" ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setMessage(null);
                    const outcome = await sendScoringLinksAction(event.id);
                    setMessage(
                      outcome.ok
                        ? { kind: "ok", text: outcome.summary ?? "Scoring links sent." }
                        : {
                            kind: "error",
                            text: outcome.error ?? "That didn't work.",
                          },
                    );
                  })
                }
                className="h-11 text-ink"
              >
                Email scoring links
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => closeJudging(event.id), "Scoring closed.")
                }
                className="h-11 text-ink"
              >
                Close scoring
              </Button>
            </>
          ) : null}
        </div>
      </section>

      {/* --- Judge progress ---------------------------------------------- */}
      <section aria-labelledby="progress" className="flex flex-col gap-3">
        <h2
          id="progress"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Judge progress
        </h2>
        {judgeProgress.length === 0 ? (
          <p className="text-ink/70">No judges on this event.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {judgeProgress.map((judge) => (
              <li
                key={judge.judgeId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-wr-olive-green/25 px-4 py-2"
              >
                <span className="font-medium text-ink">{judge.judgeName}</span>
                <span className="font-mono text-sm text-ink/70">
                  {judge.submitted} of {results.submissionCount} submitted
                  {judge.drafted > 0 ? ` · ${judge.drafted} in draft` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Ties, ABOVE the standings ------------------------------------ */}
      {ties.length > 0 ? (
        <section
          aria-labelledby="ties"
          className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-muted/60 p-5"
        >
          <h2 id="ties" className="font-serif text-2xl font-semibold text-ink">
            {ties.length === 1 ? "There\u2019s a tie" : "There are ties"}
          </h2>
          <p className="max-w-prose text-ink/80">
            These teams have identical averages. Nothing here breaks a tie for
            you — pick a winner deliberately, or hand out both awards.
          </p>
          <ul className="flex flex-col gap-3">
            {ties.map((group) => (
              <li key={group[0].average ?? "x"} className="flex flex-col gap-1">
                <p className="font-mono text-sm text-ink/70">
                  Tied at {fmt(group[0].average)}
                </p>
                <p className="font-serif text-lg text-ink">
                  {group.map((row) => row.teamName).join("  ·  ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Standings ---------------------------------------------------- */}
      <section aria-labelledby="standings" className="flex flex-col gap-3">
        <h2
          id="standings"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Standings
        </h2>
        <p className="text-sm text-ink/70">{describeMethod(criteria)}</p>
        <p className="text-sm text-ink/70">
          {scoredCount} of {results.submissionCount} project
          {results.submissionCount === 1 ? "" : "s"} have at least one submitted
          card. Drafts are not counted.
        </p>
        {rows.length === 0 ? (
          <p className="text-ink/70">No projects submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">
                Average score per project, highest first
              </caption>
              <thead>
                <tr className="border-b border-wr-olive-green/40 text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Team
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Average
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Judges
                  </th>
                  {criteria.map((criterion) => (
                    <th
                      key={criterion.id}
                      scope="col"
                      className="py-2 pr-4 font-medium"
                    >
                      {criterion.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.submissionId}
                    className="border-b border-wr-olive-green/15"
                  >
                    <th scope="row" className="py-2 pr-4 text-left font-serif text-base">
                      {row.teamName}
                    </th>
                    <td className="py-2 pr-4 font-mono">{fmt(row.average)}</td>
                    <td className="py-2 pr-4 font-mono text-ink/70">
                      {row.judgeCount}
                    </td>
                    {criteria.map((criterion) => (
                      <td key={criterion.id} className="py-2 pr-4 font-mono text-ink/70">
                        {fmt(row.perCriterion[criterion.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- Awards ------------------------------------------------------- */}
      <section aria-labelledby="awards" className="flex flex-col gap-4">
        <h2
          id="awards"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Awards
        </h2>

        {awards.length === 0 ? (
          <p className="text-ink/70">
            No award categories yet. Add one below — &ldquo;Best Overall&rdquo; is
            the usual first.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {awards.map((award) => {
              // When an award is tied to a criterion, the suggested order is that
              // criterion's ranking rather than the overall average.
              const ranked = award.criterionId
                ? rankByCriterion(award.criterionId, rows)
                : rows;
              return (
                <li
                  key={award.id}
                  className="flex flex-col gap-3 rounded-lg border border-wr-olive-green/25 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-serif text-lg font-semibold text-ink">
                      {award.label}
                    </h3>
                    {award.announcedAt ? (
                      <span className="rounded-full border border-wr-olive-green bg-wr-olive-green/10 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink">
                        Announced
                      </span>
                    ) : null}
                  </div>
                  {award.criterionId ? (
                    <p className="text-sm text-ink/60">
                      Ranked by{" "}
                      {criteria.find((c) => c.id === award.criterionId)?.label ??
                        "a criterion"}
                    </p>
                  ) : null}

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`winner-${award.id}`}
                      className="text-sm font-medium text-ink"
                    >
                      Winner
                    </label>
                    <select
                      id={`winner-${award.id}`}
                      defaultValue={award.winningSubmissionId ?? ""}
                      disabled={pending || Boolean(award.announcedAt)}
                      onChange={(e) =>
                        run(
                          () =>
                            setAwardWinner(
                              event.id,
                              award.id,
                              e.target.value || null,
                            ),
                          e.target.value
                            ? `${award.label}: ${teamName(e.target.value)}.`
                            : `${award.label}: winner cleared.`,
                        )
                      }
                      className="h-11 rounded-md border border-input bg-background px-3 text-ink disabled:opacity-60"
                    >
                      <option value="">— not decided —</option>
                      {ranked.map((row) => (
                        <option key={row.submissionId} value={row.submissionId}>
                          {row.teamName} ({fmt(
                            award.criterionId
                              ? row.perCriterion[award.criterionId]
                              : row.average,
                          )})
                        </option>
                      ))}
                    </select>
                    {award.winningTeamName ? (
                      <p className="text-sm text-ink/70">
                        Currently: {award.winningTeamName}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {award.announcedAt ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => reopenAward(event.id, award.id),
                            `${award.label} reopened.`,
                          )
                        }
                        className="h-11 text-ink"
                      >
                        Reopen
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          disabled={pending || !award.winningSubmissionId}
                          onClick={() =>
                            run(
                              () => announceAward(event.id, award.id),
                              `${award.label} announced.`,
                            )
                          }
                          className="h-11"
                        >
                          Announce
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => deleteAwardCategory(event.id, award.id),
                              `${award.label} removed.`,
                            )
                          }
                          className="h-11 text-ink"
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-wr-olive-green/40 p-4">
          <h3 className="font-medium text-ink">Add an award</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="award-label" className="text-sm font-medium text-ink">
                Name
              </label>
              <Input
                id="award-label"
                value={newAward.label}
                maxLength={120}
                placeholder="Best Overall"
                onChange={(e) =>
                  setNewAward((a) => ({ ...a, label: e.target.value }))
                }
                className="h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="award-criterion"
                className="text-sm font-medium text-ink"
              >
                Rank by
              </label>
              <select
                id="award-criterion"
                value={newAward.criterionId}
                onChange={(e) =>
                  setNewAward((a) => ({ ...a, criterionId: e.target.value }))
                }
                className="h-11 rounded-md border border-input bg-background px-3 text-ink"
              >
                <option value="">Overall average</option>
                {criteria.map((criterion) => (
                  <option key={criterion.id} value={criterion.id}>
                    {criterion.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              disabled={pending || newAward.label.trim().length < 2}
              onClick={() =>
                run(async () => {
                  const result = await createAwardCategory(event.id, {
                    label: newAward.label,
                    criterionId: newAward.criterionId || null,
                  });
                  if (result.ok) setNewAward({ label: "", criterionId: "" });
                  return result;
                }, "Award added.")
              }
              className="h-11"
            >
              Add
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
