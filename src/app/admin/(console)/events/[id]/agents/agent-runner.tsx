"use client";

/**
 * Run / re-run controls for one agent.
 *
 * A re-run always opens a panel asking what to change, because a re-run with no
 * new instruction usually just produces the same document again — and the note
 * a reviewer already wrote ("request edits") is pre-filled, which is what closes
 * the review loop.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { runAgentAction } from "@/lib/rogue-raise/agents/review-actions";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="h-11">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function AgentRunner({
  eventId,
  agentType,
  agentLabel,
  canRun,
  blockedReason,
  hasRun,
  latestRunId,
  suggestedInstructions,
}: {
  eventId: string;
  agentType: string;
  agentLabel: string;
  canRun: boolean;
  blockedReason: string | null;
  hasRun: boolean;
  latestRunId: string | null;
  /** A reviewer's "request edits" note, so a re-run starts from their words. */
  suggestedInstructions: string | null;
}) {
  const baseId = useId();
  const [state, action] = useActionState(runAgentAction, initialAdminEventState);
  const [open, setOpen] = useState<{ at: number } | null>(null);
  const version = state.version ?? 0;
  const isOpen = open?.at === version;

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.formError) errorRef.current?.focus();
  }, [state.formError, version]);

  if (!canRun) {
    return (
      <p className="text-sm text-ink/60">
        {blockedReason ?? "This agent can't run at this stage."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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

      {isOpen ? (
        <form
          action={action}
          role="group"
          aria-label={`Re-run ${agentLabel}`}
          className="flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
        >
          <input type="hidden" name="event_id" value={eventId} />
          <input type="hidden" name="agent_type" value={agentType} />
          {latestRunId ? (
            <input type="hidden" name="previous_run_id" value={latestRunId} />
          ) : null}
          <Field
            id={`${baseId}-instructions`}
            label="What should be different this time?"
            description="This is added to the agent's instructions. The previous drafts are kept."
          >
            {(aria) => (
              <Textarea
                {...aria}
                name="additional_instructions"
                rows={4}
                defaultValue={suggestedInstructions ?? ""}
                className="min-h-24"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <SubmitButton label="Re-run agent" pendingLabel="Running…" />
            <Button
              type="button"
              variant="outline"
              className="h-11 text-ink"
              onClick={() => setOpen(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          {hasRun ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 text-ink"
              aria-expanded={false}
              onClick={() => setOpen({ at: version })}
            >
              Re-run with instructions
            </Button>
          ) : (
            <form action={action}>
              <input type="hidden" name="event_id" value={eventId} />
              <input type="hidden" name="agent_type" value={agentType} />
              <SubmitButton label={`Run ${agentLabel}`} pendingLabel="Running…" />
            </form>
          )}
        </div>
      )}
    </div>
  );
}
