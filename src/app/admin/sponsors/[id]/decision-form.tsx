"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  approveSponsorApplication,
  rejectSponsorApplication,
} from "@/lib/rogue-raise/sponsors/admin-actions";
import {
  initialAdminDecisionState,
  type AdminDecisionState,
} from "@/lib/rogue-raise/sponsors/admin-decision-state";

type DecisionAction = (
  state: AdminDecisionState,
  formData: FormData,
) => Promise<AdminDecisionState>;

type PanelKind = "approve" | "reject";

/**
 * Decision island. Two triggers (Approve = filled primary, Reject = outline with
 * destructive label) each expand an inline, labelled confirm panel. Only one
 * panel is open at a time. Focus moves into the panel heading on open and back
 * to the trigger on Cancel/Esc. Confirm submits through `useActionState`; a
 * server failure re-renders the panel (no redirect) with a focus-managed error.
 */
export function DecisionForm({ applicationId }: { applicationId: string }) {
  const [openKind, setOpenKind] = useState<PanelKind | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <DecisionPanel
        applicationId={applicationId}
        action={approveSponsorApplication}
        triggerLabel="Approve application"
        triggerVariant="default"
        triggerClassName="h-9"
        heading="Approve this application?"
        blurb="Approving emails the primary contact their intake invitation and moves the event into intake. Add an optional internal note for the WR team."
        confirmLabel="Confirm approval"
        confirmPendingLabel="Approving…"
        confirmVariant="default"
        isOpen={openKind === "approve"}
        onOpen={() => setOpenKind("approve")}
        onClose={() => setOpenKind(null)}
      />
      <DecisionPanel
        applicationId={applicationId}
        action={rejectSponsorApplication}
        triggerLabel="Reject application"
        triggerVariant="outline"
        triggerClassName="h-9 text-destructive hover:text-destructive"
        heading="Reject this application?"
        blurb="Rejecting sends the applicant a courteous decline and closes the event. This is final and cannot be undone."
        confirmLabel="Confirm rejection"
        confirmPendingLabel="Rejecting…"
        confirmAriaLabel="Confirm rejection — this cannot be undone"
        confirmVariant="destructive"
        isOpen={openKind === "reject"}
        onOpen={() => setOpenKind("reject")}
        onClose={() => setOpenKind(null)}
      />
    </div>
  );
}

interface DecisionPanelProps {
  applicationId: string;
  action: DecisionAction;
  triggerLabel: string;
  triggerVariant: "default" | "outline";
  triggerClassName?: string;
  heading: string;
  blurb: string;
  confirmLabel: string;
  confirmPendingLabel: string;
  confirmAriaLabel?: string;
  confirmVariant: "default" | "destructive";
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function DecisionPanel({
  applicationId,
  action,
  triggerLabel,
  triggerVariant,
  triggerClassName,
  heading,
  blurb,
  confirmLabel,
  confirmPendingLabel,
  confirmAriaLabel,
  confirmVariant,
  isOpen,
  onOpen,
  onClose,
}: DecisionPanelProps) {
  const [state, formAction] = useActionState(action, initialAdminDecisionState);

  const triggerId = useId();
  const panelId = useId();
  const headingId = useId();
  const noteId = useId();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // On open, move focus into the panel heading (tabIndex=-1) so keyboard/AT
  // users land inside the confirm affordance, not adrift after the trigger.
  useEffect(() => {
    if (isOpen) headingRef.current?.focus();
  }, [isOpen]);

  // On a server failure, pull focus to the (already-present) error region so the
  // assertive message is both announced and where the caret sits.
  const formError = state.formError;
  useEffect(() => {
    if (isOpen && formError) errorRef.current?.focus();
  }, [isOpen, formError]);

  const noteError = state.fieldErrors?.note?.[0];

  function returnFocusToTrigger() {
    // Trigger is always mounted (outside the form) — focus it before React
    // unmounts the panel so focus never falls to <body>.
    document.getElementById(triggerId)?.focus();
  }

  function close() {
    onClose();
    returnFocusToTrigger();
  }

  return (
    <div>
      <Button
        id={triggerId}
        type="button"
        variant={triggerVariant}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => (isOpen ? close() : onOpen())}
        className={triggerClassName}
      >
        {triggerLabel}
      </Button>

      {isOpen ? (
        <form
          action={formAction}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          className="mt-3 rounded-lg border border-wr-olive-green/30 bg-muted/30 p-4"
        >
          <div
            role="group"
            id={panelId}
            aria-labelledby={headingId}
            className="flex flex-col gap-3"
          >
            <h3
              ref={headingRef}
              id={headingId}
              tabIndex={-1}
              className="font-serif text-lg font-semibold text-ink outline-none"
            >
              {heading}
            </h3>
            <p className="text-sm text-ink/80">{blurb}</p>

            {/*
              Live regions rendered as soon as the panel paints (before any
              message), so injecting content later is announced:
                - role="alert"  → assertive server error (focus target)
                - role="status" → polite pending announcement (in ConfirmButton)
            */}
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="outline-none empty:hidden"
            >
              {formError ? (
                <p className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                  {formError}
                </p>
              ) : null}
            </div>

            {/* Only the application id crosses the boundary — the action resolves
                the event and decision server-side. */}
            <input type="hidden" name="application_id" value={applicationId} />

            <Field
              id={noteId}
              label="Internal note"
              description="Only WR staff can see this — it is never shared with the applicant."
              error={noteError}
            >
              {(aria) => (
                <Textarea
                  {...aria}
                  name="note"
                  rows={3}
                  maxLength={2000}
                  className="min-h-20 bg-background"
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <ConfirmButton
                label={confirmLabel}
                pendingLabel={confirmPendingLabel}
                ariaLabel={confirmAriaLabel}
                variant={confirmVariant}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                className="h-9 text-ink"
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ConfirmButton({
  label,
  pendingLabel,
  ariaLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  ariaLabel?: string;
  variant: "default" | "destructive";
}) {
  // Inside the <form>, so useFormStatus reports THIS submission's pending state.
  const { pending } = useFormStatus();
  return (
    <>
      <Button
        type="submit"
        variant={variant}
        aria-label={ariaLabel}
        disabled={pending}
        aria-busy={pending}
        className="h-9"
      >
        {pending ? pendingLabel : label}
      </Button>
      {/* Polite pending announcement, paired with aria-busy on the button. */}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "Recording your decision, please wait." : ""}
      </span>
    </>
  );
}
