"use client";

/**
 * Judge invitations card: send the approved drafts, and see who has filled in
 * their background form.
 */
import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";
import { sendJudgeInvitationsAction } from "@/lib/rogue-raise/judges/admin-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="h-11">
      {pending ? "Sending…" : "Send the approved invitations"}
    </Button>
  );
}

export interface JudgeSummary {
  id: string;
  name: string;
  email: string;
  completed: boolean;
  hasQuestion: boolean;
}

export function JudgeCard({
  eventId,
  judges,
  canSend,
  blockedReason,
}: {
  eventId: string;
  judges: JudgeSummary[];
  canSend: boolean;
  blockedReason: string | null;
}) {
  const [state, action] = useActionState(
    sendJudgeInvitationsAction,
    initialAdminEventState,
  );
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.formError) errorRef.current?.focus();
  }, [state.formError, state.version]);

  return (
    <section
      aria-labelledby="judge-card"
      className="flex flex-col gap-4 rounded-lg border border-wr-olive-green/25 p-5"
    >
      <div>
        <h2 id="judge-card" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Judges
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink/70">
          Sending gives each judge their own link to the background form. A judge
          who already has a live link is skipped rather than emailed twice.
        </p>
      </div>

      <p
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={
          state.formError
            ? "rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-ink outline-none"
            : "sr-only"
        }
      >
        {state.formError ?? ""}
      </p>
      <p
        role="status"
        className={
          state.notice && !state.formError
            ? "rounded-md border border-wr-olive-green/50 bg-secondary/50 p-3 text-sm text-ink"
            : "sr-only"
        }
      >
        {state.notice ?? ""}
      </p>

      {judges.length === 0 ? (
        <p className="text-sm text-ink/70">
          No judges named yet — the sponsor adds them in their intake form.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {judges.map((judge) => (
            <li key={judge.id} className="flex flex-wrap items-center gap-2 text-ink/90">
              <span aria-hidden="true" className="font-mono text-ink/60">
                {judge.completed ? "✓" : "○"}
              </span>
              <span className="font-medium">{judge.name}</span>
              <span className="text-ink/60">{judge.email}</span>
              <span className="text-ink/60">
                {judge.completed ? "— profile in" : "— no profile yet"}
              </span>
              {judge.hasQuestion ? (
                <span className="rounded-full border border-wr-olive-green/50 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-ink/80">
                  asked about criteria
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canSend ? (
        <form action={action}>
          <input type="hidden" name="event_id" value={eventId} />
          <SubmitButton />
        </form>
      ) : blockedReason ? (
        <p className="text-sm text-ink/60">{blockedReason}</p>
      ) : null}
    </section>
  );
}
