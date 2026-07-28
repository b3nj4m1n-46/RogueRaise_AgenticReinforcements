"use client";

/**
 * Repo review controls: per-file comments plus the two repo-level decisions.
 *
 * Approving publishes the repository, which is the last irreversible step
 * before participants can see it — so it asks for confirmation and says what it
 * will do, rather than doing it on a single click.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";
import {
  approveRepoAction,
  commentOnRepoFileAction,
  requestRepoChangesAction,
} from "@/lib/rogue-raise/repo/review-actions";

function SubmitButton({
  label,
  pendingLabel,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className="h-11">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function FileCommentForm({
  eventId,
  filePath,
}: {
  eventId: string;
  filePath: string;
}) {
  const baseId = useId();
  const [state, action] = useActionState(commentOnRepoFileAction, initialAdminEventState);

  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="file_path" value={filePath} />
      <Field id={`${baseId}-body`} label={`Comment on ${filePath}`}>
        {(aria) => <Textarea {...aria} name="body" rows={2} className="min-h-16" />}
      </Field>
      {state.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
      <div>
        <SubmitButton label="Add comment" pendingLabel="Adding…" variant="outline" />
      </div>
    </form>
  );
}

export function RepoDecisions({
  eventId,
  canApprove,
  isPublic,
}: {
  eventId: string;
  canApprove: boolean;
  isPublic: boolean;
}) {
  const baseId = useId();
  const [approveState, approveAction] = useActionState(
    approveRepoAction,
    initialAdminEventState,
  );
  const [changesState, changesAction] = useActionState(
    requestRepoChangesAction,
    initialAdminEventState,
  );

  const version = (approveState.version ?? 0) + (changesState.version ?? 0);
  const [panel, setPanel] = useState<{ key: string; at: number } | null>(null);
  const isOpen = (key: string) => panel?.key === key && panel.at === version;

  const error = approveState.formError ?? changesState.formError;
  const notice = approveState.notice ?? changesState.notice;
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, version]);

  return (
    <div className="flex flex-col gap-4">
      <p
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={
          error
            ? "rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-ink outline-none"
            : "sr-only"
        }
      >
        {error ?? ""}
      </p>
      <p
        role="status"
        className={
          notice && !error
            ? "rounded-md border border-wr-olive-green/50 bg-secondary/50 p-3 text-sm text-ink"
            : "sr-only"
        }
      >
        {notice ?? ""}
      </p>

      {isPublic ? (
        <p className="text-sm text-ink/70">
          This repository is public — participants can see it.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canApprove ? (
          <Button
            type="button"
            className="h-11"
            aria-expanded={isOpen("approve")}
            onClick={() => setPanel(isOpen("approve") ? null : { key: "approve", at: version })}
          >
            Approve and publish
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-11 text-ink"
          aria-expanded={isOpen("changes")}
          onClick={() => setPanel(isOpen("changes") ? null : { key: "changes", at: version })}
        >
          Send back to the agent
        </Button>
      </div>

      {isOpen("approve") ? (
        <form
          action={approveAction}
          role="group"
          aria-label="Approve and publish the repository"
          className="flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
        >
          <input type="hidden" name="event_id" value={eventId} />
          <p className="text-sm text-ink">
            This makes the repository <strong>public</strong> and moves the event to
            repo approved. Anyone with the link will be able to read it.
          </p>
          <div className="flex flex-wrap gap-3">
            <SubmitButton label="Publish the repository" pendingLabel="Publishing…" />
            <Button
              type="button"
              variant="outline"
              className="h-11 text-ink"
              onClick={() => setPanel(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {isOpen("changes") ? (
        <form
          action={changesAction}
          role="group"
          aria-label="Send the repository back to the agent"
          className="flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
        >
          <input type="hidden" name="event_id" value={eventId} />
          <Field
            id={`${baseId}-changes`}
            label="What needs to change?"
            required
            description="Your file comments are sent along with this, and the research agent re-runs with all of it."
          >
            {(aria) => <Textarea {...aria} name="body" rows={4} className="min-h-24" />}
          </Field>
          <div className="flex flex-wrap gap-3">
            <SubmitButton label="Send back and re-run" pendingLabel="Re-running…" />
            <Button
              type="button"
              variant="outline"
              className="h-11 text-ink"
              onClick={() => setPanel(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
