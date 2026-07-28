"use client";

/**
 * The review gate for one generated asset: approve, request edits, reject — or
 * edit the text and approve the edit in one step.
 *
 * The editor is a plain textarea seeded with the agent's text. Saving writes a
 * NEW version rather than overwriting, so the page below can always show what
 * the agent originally produced.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  editAndApproveAssetAction,
  reviewAssetAction,
} from "@/lib/rogue-raise/agents/review-actions";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";

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
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
      className="h-11"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function AssetReview({
  assetId,
  title,
  body,
  reviewStatus,
  isLatest,
}: {
  assetId: string;
  title: string;
  body: string;
  reviewStatus: string;
  isLatest: boolean;
}) {
  const baseId = useId();
  const [reviewState, reviewAction] = useActionState(
    reviewAssetAction,
    initialAdminEventState,
  );
  const [editState, editAction] = useActionState(
    editAndApproveAssetAction,
    initialAdminEventState,
  );

  const version = (reviewState.version ?? 0) + (editState.version ?? 0);
  const [panel, setPanel] = useState<{ key: string; at: number } | null>(null);
  const isOpen = (key: string) => panel?.key === key && panel.at === version;
  const toggle = (key: string) =>
    setPanel(isOpen(key) ? null : { key, at: version });

  const error = reviewState.formError ?? editState.formError;
  const notice = reviewState.notice ?? editState.notice;
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, version]);

  if (!isLatest) {
    return (
      <p className="rounded-md border border-input bg-muted/40 p-4 text-sm text-ink/70">
        This is an earlier version, kept for the record. Review the latest version
        instead.
      </p>
    );
  }

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

      <div className="flex flex-wrap gap-3">
        <form action={reviewAction}>
          <input type="hidden" name="asset_id" value={assetId} />
          <input type="hidden" name="decision" value="approve" />
          <SubmitButton
            label={reviewStatus === "approved" ? "Approve again" : "Approve"}
            pendingLabel="Approving…"
          />
        </form>

        <Button
          type="button"
          variant="outline"
          className="h-11 text-ink"
          aria-expanded={isOpen("edit")}
          onClick={() => toggle("edit")}
        >
          Edit the text
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-11 text-ink"
          aria-expanded={isOpen("request_edits")}
          onClick={() => toggle("request_edits")}
        >
          Send back to the agent
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-11 text-ink"
          aria-expanded={isOpen("reject")}
          onClick={() => toggle("reject")}
        >
          Reject
        </Button>
      </div>

      {isOpen("edit") ? (
        <form
          action={editAction}
          role="group"
          aria-label="Edit and approve this document"
          className="flex flex-col gap-4 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
        >
          <input type="hidden" name="asset_id" value={assetId} />
          <p className="text-sm text-ink">
            Your edit is saved as a new version and approved. The agent&rsquo;s
            original is kept exactly as it was.
          </p>
          <Field id={`${baseId}-title`} label="Title">
            {(aria) => (
              <Input {...aria} name="title" defaultValue={title} className="h-11" />
            )}
          </Field>
          <Field id={`${baseId}-body`} label="Document" required>
            {(aria) => (
              <Textarea
                {...aria}
                name="body"
                rows={24}
                defaultValue={body}
                className="min-h-96 font-mono text-sm"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <SubmitButton label="Save and approve" pendingLabel="Saving…" />
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

      {(["request_edits", "reject"] as const).map((decision) =>
        isOpen(decision) ? (
          <form
            key={decision}
            action={reviewAction}
            role="group"
            aria-label={
              decision === "reject" ? "Reject this document" : "Send back for edits"
            }
            className="flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
          >
            <input type="hidden" name="asset_id" value={assetId} />
            <input type="hidden" name="decision" value={decision} />
            <Field
              id={`${baseId}-${decision}-note`}
              label="What needs to change?"
              required
              description={
                decision === "reject"
                  ? "Recorded against this document."
                  : "This becomes the starting instruction when you re-run the agent."
              }
            >
              {(aria) => (
                <Textarea {...aria} name="note" rows={4} className="min-h-24" />
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <SubmitButton
                label={decision === "reject" ? "Reject document" : "Send back"}
                pendingLabel="Recording…"
                variant={decision === "reject" ? "destructive" : "default"}
              />
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
        ) : null,
      )}
    </div>
  );
}
