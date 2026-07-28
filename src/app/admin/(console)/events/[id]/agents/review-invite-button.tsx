"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { sendReviewInvitesAction } from "@/lib/rogue-raise/stakeholders/admin-actions";
import { cn } from "@/lib/utils";

/**
 * Sends stakeholders their review link. Safe to press twice — anyone already
 * asked about the current round of drafts is skipped, and re-running the agent
 * starts a new round that legitimately re-asks.
 */
export function ReviewInviteButton({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await sendReviewInvitesAction(eventId);
              setMessage(
                result.ok
                  ? { kind: "ok", text: result.summary ?? "Sent." }
                  : { kind: "error", text: result.error ?? "That didn't work." },
              );
            })
          }
          className="h-11 text-ink"
        >
          {pending ? "Sending…" : "Email stakeholders the review link"}
        </Button>
      </div>
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
    </div>
  );
}
