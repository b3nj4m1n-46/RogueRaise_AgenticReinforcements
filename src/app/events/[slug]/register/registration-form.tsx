"use client";

/**
 * Participant registration form (PRD §6.2).
 *
 * The GitHub field carries the PRD's requirement plainly: someone without an
 * account gets a link and permission to come back, rather than a dead end.
 */
import { useEffect, useId, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerParticipant } from "@/lib/rogue-raise/participants/actions";
import { initialRegistrationState } from "@/lib/rogue-raise/participants/form-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        className="h-12 w-full text-base font-semibold sm:w-auto sm:self-start"
      >
        {pending ? "Registering…" : "Register to build"}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "Registering, please wait." : ""}
      </span>
    </div>
  );
}

export function RegistrationForm({
  eventSlug,
  challengeTs,
  challengeSig,
}: {
  eventSlug: string;
  challengeTs: string;
  challengeSig: string;
}) {
  const baseId = useId();
  const [state, action] = useActionState(registerParticipant, initialRegistrationState);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.formError || state.fieldErrors) errorRef.current?.focus();
  }, [state]);

  const errorFor = (key: string) => state.fieldErrors?.[key]?.[0];

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="event_slug" value={eventSlug} />
      <input type="hidden" name="challenge_ts" value={challengeTs} />
      <input type="hidden" name="challenge_sig" value={challengeSig} />

      <div
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={
          state.formError
            ? "rounded-lg border border-destructive bg-destructive/5 p-4 text-sm text-ink outline-none"
            : "sr-only"
        }
      >
        {state.formError ?? ""}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={`${baseId}-first`}
          label="First name"
          required
          className="min-w-0"
          error={errorFor("firstName")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="first_name"
              autoComplete="given-name"
              defaultValue={state.values?.firstName ?? ""}
              className="h-11"
            />
          )}
        </Field>
        <Field
          id={`${baseId}-last`}
          label="Last name"
          required
          className="min-w-0"
          error={errorFor("lastName")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="last_name"
              autoComplete="family-name"
              defaultValue={state.values?.lastName ?? ""}
              className="h-11"
            />
          )}
        </Field>
      </div>

      <Field
        id={`${baseId}-email`}
        label="Email"
        required
        description="Where your confirmation and the rules go."
        error={errorFor("email")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue={state.values?.email ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <Field
        id={`${baseId}-github`}
        label="GitHub username"
        required
        description="So we can add you to the event organization. A profile URL works too."
        error={errorFor("githubUsername")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="github_username"
            autoComplete="username"
            placeholder="octocat"
            defaultValue={state.values?.githubUsername ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <p className="max-w-prose text-sm text-ink/70">
        Don&rsquo;t have a GitHub account?{" "}
        <a
          href="https://github.com/signup"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-ink underline underline-offset-4"
        >
          Create a free one
        </a>{" "}
        — it takes a minute — then come back to this page and finish registering.
      </p>

      {/* Honeypot — off-screen, hidden from AT, out of the tab order. */}
      <div className="rr-honeypot" aria-hidden="true">
        <Label htmlFor={`${baseId}-contact_time`}>Leave this field blank</Label>
        <input
          id={`${baseId}-contact_time`}
          type="text"
          name="contact_time"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
