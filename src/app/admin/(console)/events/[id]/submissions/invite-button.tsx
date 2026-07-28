"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { sendSubmissionInvitesAction } from "@/lib/rogue-raise/submissions/admin-actions";
import { cn } from "@/lib/utils";

/**
 * Fires the bulk submission invite. Pressing it twice is safe — the send skips
 * anyone who already holds a live link — and the result says so explicitly so a
 * staff member isn't left guessing whether they just double-emailed the room.
 */
export function InviteButton({
  eventId,
  disabledReason,
}: {
  eventId: string;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          disabled={pending || Boolean(disabledReason)}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await sendSubmissionInvitesAction(eventId);
              setMessage(
                result.ok
                  ? { kind: "ok", text: result.summary ?? "Sent." }
                  : { kind: "error", text: result.error ?? "That didn't work." },
              );
            })
          }
          className="h-11"
        >
          {pending ? "Sending…" : "Email submission links"}
        </Button>
      </div>
      {disabledReason ? (
        <p className="text-sm text-ink/70">{disabledReason}</p>
      ) : null}
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
