"use client";

/**
 * One project's scorecard (PRD §7.2).
 *
 * Designed for a judge on a phone in a loud room between pitches: the 1–5 scale
 * is radio buttons with real hit targets, not a select or a slider, and both
 * "Save draft" and "Submit" are always available so a half-finished card is
 * never a dead end.
 */
import { useActionState, useId, useState } from "react";
import { useActionFocus } from "@/lib/use-action-focus";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveScorecard } from "@/lib/rogue-raise/judging/actions";
import { initialScorecardState } from "@/lib/rogue-raise/judging/form-state";
import { MAX_SCORE, MIN_SCORE, type Criterion } from "@/lib/rogue-raise/judging/scoring";
import type { SubmissionForJudge } from "@/lib/rogue-raise/judging/queries";
import { cn } from "@/lib/utils";

const SCALE = Array.from(
  { length: MAX_SCORE - MIN_SCORE + 1 },
  (_, i) => MIN_SCORE + i,
);

/** Anchors, so 3 means the same thing to every judge. */
const SCALE_HINT = `1 = didn't land · 3 = solid · 5 = outstanding`;

function Actions({ hasCard }: { hasCard: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="submit"
        name="intent"
        value="final"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        className="h-12 flex-1 text-base font-semibold sm:flex-none"
      >
        {pending ? "Saving…" : hasCard ? "Update score" : "Submit score"}
      </Button>
      <Button
        type="submit"
        name="intent"
        value="draft"
        variant="outline"
        size="lg"
        disabled={pending}
        className="h-12 text-ink"
      >
        Save draft
      </Button>
    </div>
  );
}

export function Scorecard({
  eventId,
  token,
  submission,
  criteria,
  index,
}: {
  eventId: string;
  token: string;
  submission: SubmissionForJudge;
  criteria: Criterion[];
  index: number;
}) {
  const baseId = useId();
  const [state, action] = useActionState(saveScorecard, initialScorecardState);

  /**
   * Local picks layered OVER the saved card, rather than state seeded from it
   * once. After a save the server sends a fresh card down, and a
   * seeded-once `useState` would either ignore it or (worse) be reset by the
   * re-render and blank out scores the judge just entered. Merging keeps both
   * true: whatever they touched last wins, and anything they haven't touched
   * shows what is actually on disk.
   */
  const [picks, setPicks] = useState<Record<string, number>>({});
  const scores: Record<string, number | undefined> = {
    ...(submission.card?.scores ?? {}),
    ...picks,
  };
  // Notes are layered the same way, for the same reason.
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const notes = notesDraft ?? submission.card?.notes ?? "";

  // A result belongs to this card only if the action says so — two cards share
  // one page and must never paint each other's errors.
  const mine = state.submissionId === submission.id;
  const fieldError = (id: string) => (mine ? state.fieldErrors?.[id] : undefined);
  const scoredCount = criteria.filter((c) => scores[c.id] !== undefined).length;

  // Only this card's own results move focus — two cards share the page.
  const resultRef = useActionFocus<HTMLDivElement>(mine ? state.version : undefined);

  const status = submission.card
    ? submission.card.isDraft
      ? "Draft saved"
      : "Submitted"
    : "Not started";

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="flex flex-col gap-5 rounded-lg border border-wr-olive-green/25 p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={`${baseId}-title`}
            className="font-serif text-2xl font-semibold text-ink"
          >
            <span className="font-mono text-sm text-ink/70">{index + 1}. </span>
            {submission.teamName}
          </h2>
          <span
            className={cn(
              "rounded-full border px-3 py-0.5 font-mono text-xs uppercase tracking-wide",
              mine && state.saved === "final"
                ? "border-wr-olive-green bg-wr-olive-green/10 text-ink"
                : "border-wr-olive-green/40 text-ink/70",
            )}
          >
            {mine && state.saved
              ? state.saved === "final"
                ? "Submitted"
                : "Draft saved"
              : status}
          </span>
        </div>
        {submission.members.length > 0 ? (
          <p className="text-sm text-ink/60">{submission.members.join(", ")}</p>
        ) : null}
        <p className="whitespace-pre-wrap text-ink/85">{submission.projectSummary}</p>
        <p className="flex flex-wrap gap-4 text-sm">
          <a
            href={submission.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-ink underline underline-offset-4"
          >
            Repository
          </a>
          {submission.pitchMaterialsUrl ? (
            <a
              href={submission.pitchMaterialsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-ink underline underline-offset-4"
            >
              Slides / demo
            </a>
          ) : null}
        </p>
      </header>

      {/*
        * The result region lives OUTSIDE the keyed form below, so it survives
        * the remount — a live region that is torn down and re-mounted already
        * populated is announced unreliably by NVDA and JAWS. Focus moves here
        * after each result, which both announces the message and stops focus
        * falling to the top of a page holding one scorecard per project.
        */}
      <div
        ref={resultRef}
        tabIndex={-1}
        className="outline-none"
        aria-live="polite"
      >
        {mine && state.formError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive bg-destructive/5 p-3 text-sm text-ink"
          >
            {state.formError}
          </p>
        ) : null}
        {mine && state.ok ? (
          <p className="rounded-lg border border-wr-olive-green bg-wr-olive-green/10 p-3 text-sm text-ink">
            {state.saved === "final"
              ? "Score recorded. You can change it while scoring is open."
              : "Draft saved. Come back to it whenever."}
          </p>
        ) : null}
      </div>

      {/*
        * Keyed on the action version. React calls `form.reset()` once a server
        * action settles, which unchecks the radios in the DOM; because the
        * rendered `checked` values are unchanged, React's reconciler sees no
        * work to do and never writes them back — so a judge's picks vanish while
        * still being saved. Remounting the form on each result keeps the DOM and
        * the state we actually hold in agreement.
        */}
      <form
        key={state.version ?? 0}
        action={action}
        className="flex flex-col gap-5"
      >
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="submission_id" value={submission.id} />
        <input type="hidden" name="version" value={state.version ?? 0} />

        <p className="font-mono text-xs uppercase tracking-widest text-ink/70">
          {SCALE_HINT}
        </p>

        {criteria.map((criterion) => {
          const groupId = `${baseId}-${criterion.id}`;
          const error = fieldError(criterion.id);
          return (
            <fieldset
              key={criterion.id}
              className="border-0 p-0"
              // On the fieldset (role `group`), not the plain div it used to
              // sit on — a roleless element is not exposed to assistive tech,
              // so the error description was dropped entirely. `aria-invalid`
              // is NOT valid on role="radio", so the group's description is
              // the mechanism here.
              aria-describedby={error ? `${groupId}-error` : undefined}
            >
              <legend className="mb-2 font-medium text-ink">
                {criterion.label}
                {criterion.weight ? (
                  <span className="ml-2 font-mono text-xs text-ink/70">
                    ×{criterion.weight}
                  </span>
                ) : null}
              </legend>
              {/*
                * A `fieldset` + `legend` around same-named radios IS the group —
                * adding role="radiogroup" here would make a screen reader
                * announce the criterion twice.
                */}
              <div className="flex flex-wrap gap-2">
                {SCALE.map((value) => {
                  const id = `${groupId}-${value}`;
                  const checked = scores[criterion.id] === value;
                  return (
                    <label
                      key={value}
                      htmlFor={id}
                      className={cn(
                        "flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border font-mono text-lg transition-colors",
                        // The real input is sr-only, so the ring has to be drawn
                        // on the label or keyboard focus is invisible.
                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                        checked
                          ? "border-ink bg-ink font-semibold text-background"
                          // Full strength: with the input sr-only, this border
                          // is the control's entire visible boundary (1.4.11).
                          : "border-wr-olive-green text-ink hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        id={id}
                        name={`score_${criterion.id}`}
                        value={value}
                        checked={checked}
                        onChange={() =>
                          setPicks((p) => ({ ...p, [criterion.id]: value }))
                        }
                        className="sr-only"
                      />
                      {value}
                    </label>
                  );
                })}
              </div>
              {error ? (
                <p
                  id={`${groupId}-error`}
                  className="mt-1 text-sm font-medium text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </fieldset>
          );
        })}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${baseId}-notes`}
            className="font-medium text-ink"
          >
            Notes{" "}
            <span className="font-normal text-ink/60">
              — for the team, not the leaderboard
            </span>
          </label>
          <Textarea
            id={`${baseId}-notes`}
            name="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotesDraft(e.target.value)}
            aria-invalid={fieldError("notes") ? true : undefined}
          />
          {fieldError("notes") ? (
            <p className="text-sm font-medium text-destructive">
              {fieldError("notes")}
            </p>
          ) : null}
        </div>

        <p className="font-mono text-xs text-ink/70">
          {scoredCount} of {criteria.length} criteria scored
        </p>

        <Actions hasCard={Boolean(submission.card && !submission.card.isDraft)} />
      </form>
    </section>
  );
}
