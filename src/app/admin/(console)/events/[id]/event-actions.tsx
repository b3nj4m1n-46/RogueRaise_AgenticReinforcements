"use client";

/**
 * Admin actions for one event: confirm the weekend, reissue the sponsor's
 * intake link.
 *
 * Both are real `<form>` submissions (no autosave here — these are deliberate,
 * consequential acts), and both share one pair of live regions so a result is
 * announced once, wherever it came from. Confirming a weekend after
 * registration has opened asks for an extra confirmation rather than being
 * blocked: staff are allowed to fix a date, they just shouldn't do it by accident.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  confirmEventWeekend,
  resendIntakeInvite,
} from "@/lib/rogue-raise/events/admin-actions";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";

export interface WeekendChoice {
  id: string;
  label: string;
  lines: string[];
  isConfirmed: boolean;
}

function SubmitButton({
  children,
  pendingLabel,
  variant = "default",
}: {
  children: React.ReactNode;
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
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function EventActions({
  eventId,
  weekends,
  canConfirm,
  lateConfirm,
  canReissue,
  pocEmail,
}: {
  eventId: string;
  weekends: WeekendChoice[];
  canConfirm: boolean;
  lateConfirm: boolean;
  canReissue: boolean;
  pocEmail: string | null;
}) {
  const baseId = useId();
  const [confirmState, confirmAction] = useActionState(
    confirmEventWeekend,
    initialAdminEventState,
  );
  const [resendState, resendAction] = useActionState(
    resendIntakeInvite,
    initialAdminEventState,
  );

  // Which panel is expanded, remembered together with the action version it was
  // opened at. Deriving "open" from that pair means a result auto-closes the
  // panel without an effect that writes state (cascading renders).
  const [openPanel, setOpenPanel] = useState<{ key: string; at: number } | null>(
    null,
  );

  const notice = confirmState.notice ?? resendState.notice;
  const error = confirmState.formError ?? resendState.formError;
  const version = (confirmState.version ?? 0) + (resendState.version ?? 0);

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
    // Version in the deps so a repeated identical error still moves focus.
  }, [error, version]);

  const isOpen = (key: string) => openPanel?.key === key && openPanel.at === version;
  const toggle = (key: string) =>
    setOpenPanel(isOpen(key) ? null : { key, at: version });

  return (
    <div className="flex flex-col gap-6">
      {/* Persistent live regions, rendered on first paint. */}
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

      <section aria-labelledby={`${baseId}-weekend-heading`} className="flex flex-col gap-4">
        <h2
          id={`${baseId}-weekend-heading`}
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          The weekend
        </h2>

        {weekends.length === 0 ? (
          <p className="text-ink/70">
            No weekends offered yet — the sponsor adds these in their intake form.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {weekends.map((weekend) => (
              <li
                key={weekend.id}
                className="rounded-lg border border-wr-olive-green/25 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-lg font-semibold text-ink">
                      {weekend.label}
                      {weekend.isConfirmed ? (
                        <span className="ml-2 rounded-full bg-primary px-2 py-0.5 align-middle font-mono text-xs uppercase tracking-wide text-primary-foreground">
                          Confirmed
                        </span>
                      ) : null}
                    </p>
                    <ul className="mt-2 flex flex-col gap-0.5 text-sm text-ink/80">
                      {weekend.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>

                  {canConfirm && !weekend.isConfirmed ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 text-ink"
                      aria-expanded={isOpen(`confirm:${weekend.id}`)}
                      aria-controls={`${baseId}-confirm-${weekend.id}`}
                      onClick={() => toggle(`confirm:${weekend.id}`)}
                    >
                      Confirm this weekend
                    </Button>
                  ) : null}
                </div>

                {isOpen(`confirm:${weekend.id}`) ? (
                  <form
                    id={`${baseId}-confirm-${weekend.id}`}
                    action={confirmAction}
                    role="group"
                    aria-label={`Confirm ${weekend.label}`}
                    className="mt-4 flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
                  >
                    <input type="hidden" name="event_id" value={eventId} />
                    <input type="hidden" name="date_option_id" value={weekend.id} />
                    <p className="text-sm text-ink">
                      {lateConfirm
                        ? "Registration is already open, so participants have been told these dates. Changing the weekend now means telling them again."
                        : "This becomes the event weekend everywhere — emails, the deck, and the landing page all read from it."}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <SubmitButton pendingLabel="Confirming…">
                        {lateConfirm ? "Change the weekend anyway" : "Confirm weekend"}
                      </SubmitButton>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 text-ink"
                        onClick={() => setOpenPanel(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {!canConfirm && weekends.length > 0 ? (
          <p className="text-sm text-ink/60">
            This event is past the point where the weekend can be changed here.
          </p>
        ) : null}
      </section>

      {canReissue ? (
        <section
          aria-labelledby={`${baseId}-link-heading`}
          className="flex flex-col gap-3 rounded-lg border border-wr-olive-green/25 p-4"
        >
          <h2
            id={`${baseId}-link-heading`}
            className="font-serif text-xl font-semibold text-ink"
          >
            Sponsor&rsquo;s intake link
          </h2>
          <p className="max-w-prose text-sm text-ink/70">
            Sends {pocEmail ?? "the sponsor contact"} a fresh link to their intake
            form. Any link we sent earlier stops working immediately.
          </p>

          {isOpen("resend") ? (
            <form
              action={resendAction}
              role="group"
              aria-label="Reissue the intake link"
              className="flex flex-col gap-3 rounded-md border border-wr-olive-green/40 bg-secondary/40 p-4"
            >
              <input type="hidden" name="event_id" value={eventId} />
              <p className="text-sm text-ink">
                Use this when the original email never arrived or the link has
                expired. Their answers so far are kept.
              </p>
              <div className="flex flex-wrap gap-3">
                <SubmitButton pendingLabel="Sending…">Send a fresh link</SubmitButton>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 text-ink"
                  onClick={() => setOpenPanel(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button
                type="button"
                variant="outline"
                className="h-11 text-ink"
                aria-expanded={isOpen("resend")}
                onClick={() => toggle("resend")}
              >
                Reissue intake link
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
