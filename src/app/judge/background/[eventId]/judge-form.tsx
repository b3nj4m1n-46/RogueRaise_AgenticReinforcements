"use client";

/**
 * Judge background form (PRD §5.3.4). A short, single-submit form — unlike the
 * sponsor intake, there is little here and a judge fills it in one sitting.
 *
 * The criteria-questions field is deliberately last and clearly labelled as
 * reaching real people: it is the invitation to push back on how the work will
 * be judged, which is the point of asking judges early rather than late.
 */
import { useEffect, useId, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveJudgeBackground } from "@/lib/rogue-raise/judges/actions";
import { initialJudgeFormState } from "@/lib/rogue-raise/judges/form-state";

function SubmitButton({ complete }: { complete: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending}
      className="h-11 w-full text-base font-semibold sm:w-auto sm:self-start"
    >
      {pending ? "Saving…" : complete ? "Save changes" : "Send this to White Rabbit"}
    </Button>
  );
}

export interface JudgeFormProps {
  eventId: string;
  token: string;
  organizationName: string;
  initial: {
    name: string;
    title: string;
    bio: string;
    expertiseTags: string[];
    introPreference: string;
    criteriaQuestions: string;
    complete: boolean;
  };
}

export function JudgeForm({ eventId, token, organizationName, initial }: JudgeFormProps) {
  const baseId = useId();
  const [state, action] = useActionState(saveJudgeBackground, initialJudgeFormState);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.formError) errorRef.current?.focus();
  }, [state.formError, state.version]);

  const errorFor = (key: string) => state.fieldErrors?.[key]?.[0];
  const complete = state.complete ?? initial.complete;

  return (
    <form action={action} noValidate className="flex flex-col gap-8">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="token" value={token} />

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
      <p
        role="status"
        className={
          state.status === "saved"
            ? "rounded-lg border border-wr-olive-green/50 bg-secondary/50 p-4 text-sm text-ink"
            : "sr-only"
        }
      >
        {state.status === "saved"
          ? "Saved — thank you. You can come back to this link and change anything."
          : ""}
      </p>

      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          How we introduce you
        </legend>

        <Field id={`${baseId}-name`} label="Your name" required error={errorFor("name")}>
          {(aria) => (
            <Input
              {...aria}
              name="name"
              defaultValue={initial.name}
              maxLength={200}
              className="h-11"
            />
          )}
        </Field>

        <Field
          id={`${baseId}-title`}
          label="Title and organization"
          description="However you'd like it read out — e.g. “Data Lead, Jackson County Health Department”."
          error={errorFor("title")}
        >
          {(aria) => (
            <Input {...aria} name="title" defaultValue={initial.title} className="h-11" />
          )}
        </Field>

        <Field
          id={`${baseId}-bio`}
          label="A short bio"
          description="A few sentences. This is read at kickoff and printed beside your name."
          error={errorFor("bio")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="bio"
              rows={5}
              defaultValue={initial.bio}
              className="min-h-28"
            />
          )}
        </Field>

        <Field
          id={`${baseId}-tags`}
          label="Areas you know well"
          description="Comma-separated. Helps us pair you with the right pitches."
          error={errorFor("expertiseTags")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="expertise_tags"
              defaultValue={initial.expertiseTags.join(", ")}
              className="h-11"
            />
          )}
        </Field>

        <Field
          id={`${baseId}-intro`}
          label="Anything you'd like said — or not said — when you're introduced"
          error={errorFor("introPreference")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="intro_preference"
              rows={3}
              defaultValue={initial.introPreference}
              className="min-h-20"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Questions about how the work is judged
        </legend>
        <p className="max-w-prose text-sm text-ink/70">
          The criteria come from {organizationName} and they aren&rsquo;t settled.
          If something is unclear, or you&rsquo;d judge it differently, say so —
          this goes to White Rabbit and to {organizationName} directly, and
          someone will reply to you.
        </p>
        <Field
          id={`${baseId}-questions`}
          label="Your questions"
          error={errorFor("criteriaQuestions")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="criteria_questions"
              rows={5}
              defaultValue={initial.criteriaQuestions}
              className="min-h-28"
            />
          )}
        </Field>
      </fieldset>

      <SubmitButton complete={complete} />
    </form>
  );
}
