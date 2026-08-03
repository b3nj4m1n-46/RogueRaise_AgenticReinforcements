"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitStakeholderReview } from "@/lib/rogue-raise/stakeholders/review-actions";
import { initialReviewFormState } from "@/lib/rogue-raise/stakeholders/review-state";
import type { ReviewableAsset } from "@/lib/rogue-raise/stakeholders/review";
import { useActionFocus } from "@/lib/use-action-focus";

function Actions({ hasDecision }: { hasDecision: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="submit"
        name="decision"
        value="approve"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        className="h-12"
      >
        {hasDecision ? "This still looks right" : "This looks right"}
      </Button>
      <Button
        type="submit"
        name="decision"
        value="request_changes"
        variant="outline"
        size="lg"
        disabled={pending}
        className="h-12 text-ink"
      >
        Something needs changing
      </Button>
      <Button
        type="submit"
        name="decision"
        value=""
        variant="outline"
        size="lg"
        disabled={pending}
        className="h-12 text-ink"
      >
        Just a comment
      </Button>
    </div>
  );
}

export function ReviewForm({
  eventId,
  token,
  asset,
}: {
  eventId: string;
  token: string;
  asset: ReviewableAsset;
}) {
  const baseId = useId();
  const [state, action] = useActionState(
    submitStakeholderReview,
    initialReviewFormState,
  );
  const [body, setBody] = useState("");

  const mine = state.assetId === asset.id;
  const resultRef = useActionFocus<HTMLDivElement>(
    mine ? state.version : undefined,
  );

  return (
    <>
      {/* Outside the keyed form, so the live region survives its remount. */}
      <div ref={resultRef} tabIndex={-1} className="outline-none">
        {mine && state.formError ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/5 p-3 text-sm text-ink"
          >
            {state.formError}
          </p>
        ) : null}
        {mine && state.ok ? (
          <p className="mb-4 rounded-lg border border-wr-olive-green bg-wr-olive-green/10 p-3 text-sm text-ink">
            Thank you — that&rsquo;s recorded and the White Rabbit team can see it.
          </p>
        ) : null}
      </div>

      <form
        key={state.version ?? 0}
        action={action}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="asset_id" value={asset.id} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-body`} className="font-medium text-ink">
            Anything we got wrong, or should add?
          </label>
          <Textarea
            id={`${baseId}-body`}
            name="body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Even a half-formed thought is useful here."
          />
        </div>

        <Actions hasDecision={asset.ownDecision !== null} />
      </form>
    </>
  );
}
