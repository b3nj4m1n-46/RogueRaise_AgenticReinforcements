"use client";

/**
 * Project submission form (PRD §7.1).
 *
 * Written for 3:55 PM on a Sunday: short, no autosave ceremony, and every
 * error keeps what was typed. The team roster is the only repeatable part.
 */
import { useId, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitProject } from "@/lib/rogue-raise/submissions/actions";
import { initialSubmissionFormState } from "@/lib/rogue-raise/submissions/form-state";
import { MAX_TEAM_MEMBERS } from "@/lib/rogue-raise/submissions/schema";

interface MemberRow {
  key: string;
  name: string;
  email: string;
  /**
   * The submitter's own row. Not removable: the server puts them on their own
   * team regardless, so a Remove button here would be a lie the form tells.
   */
  isSubmitter?: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending}
      className="h-12 w-full text-base font-semibold sm:w-auto sm:self-start"
    >
      {pending ? "Submitting…" : "Submit our project"}
    </Button>
  );
}

export function SubmissionForm({
  eventId,
  token,
  submitter,
}: {
  eventId: string;
  token: string;
  submitter: { firstName: string; lastName: string; email: string };
}) {
  const baseId = useId();
  const [state, action] = useActionState(submitProject, initialSubmissionFormState);

  const [members, setMembers] = useState<MemberRow[]>(() => {
    const existing = state.values?.members;
    if (existing?.length) {
      // After a validation round-trip the flag is gone from the wire, so the
      // submitter is re-identified by their own email.
      return existing.map((m) => ({
        key: crypto.randomUUID(),
        ...m,
        isSubmitter: m.email.trim().toLowerCase() === submitter.email.toLowerCase(),
      }));
    }
    // The submitter is on their own team — pre-filled so nobody forgets.
    return [
      {
        key: crypto.randomUUID(),
        name: `${submitter.firstName} ${submitter.lastName}`.trim(),
        email: submitter.email,
        isSubmitter: true,
      },
    ];
  });

  const errorFor = (key: string) => state.fieldErrors?.[key]?.[0];
  const membersJson = JSON.stringify(
    members.map(({ name, email }) => ({ name, email })),
  );

  return (
    <form action={action} noValidate className="flex flex-col gap-8">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="members_json" value={membersJson} />

      {state.formError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm text-ink"
        >
          {state.formError}
        </p>
      ) : null}

      <Field
        id={`${baseId}-team`}
        label="Team name"
        required
        description="We call you up by this at pitches."
        error={errorFor("teamName")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="team_name"
            maxLength={120}
            defaultValue={state.values?.teamName ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <Field
        id={`${baseId}-summary`}
        label="What did you build?"
        required
        description="A few sentences. The judges read this before you pitch."
        error={errorFor("projectSummary")}
      >
        {(aria) => (
          <Textarea
            {...aria}
            name="project_summary"
            rows={6}
            maxLength={5000}
            defaultValue={state.values?.projectSummary ?? ""}
            className="min-h-32"
          />
        )}
      </Field>

      <Field
        id={`${baseId}-repo`}
        label="GitHub repository"
        required
        description="https://github.com/your-team/project"
        error={errorFor("repoUrl")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="repo_url"
            type="url"
            inputMode="url"
            placeholder="https://github.com/your-team/project"
            defaultValue={state.values?.repoUrl ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <Field
        id={`${baseId}-pitch`}
        label="Slides or a demo video"
        description="Optional — putting them in the repo is easier and we'd rather you did."
        error={errorFor("pitchMaterialsUrl")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="pitch_materials_url"
            type="url"
            inputMode="url"
            defaultValue={state.values?.pitchMaterialsUrl ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Who&rsquo;s on the team
        </legend>
        <p className="text-sm text-ink/70">
          Everyone who built this, so we can call you all up and credit you.
        </p>
        {errorFor("members") ? (
          <p className="text-sm font-medium text-destructive">{errorFor("members")}</p>
        ) : null}

        {members.map((member, index) => (
          <div
            key={member.key}
            className="grid gap-3 rounded-lg border border-input p-3 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Field
              id={`${baseId}-m-${index}-name`}
              label={`Name ${index + 1}`}
              required
              className="min-w-0"
              error={errorFor(`members.${index}.name`)}
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={member.name}
                  onChange={(e) =>
                    setMembers((rows) =>
                      rows.map((r) =>
                        r.key === member.key ? { ...r, name: e.target.value } : r,
                      ),
                    )
                  }
                  className="h-11"
                />
              )}
            </Field>
            <Field
              id={`${baseId}-m-${index}-email`}
              label="Email"
              required
              className="min-w-0"
              error={errorFor(`members.${index}.email`)}
            >
              {(aria) => (
                <Input
                  {...aria}
                  type="email"
                  inputMode="email"
                  value={member.email}
                  onChange={(e) =>
                    setMembers((rows) =>
                      rows.map((r) =>
                        r.key === member.key ? { ...r, email: e.target.value } : r,
                      ),
                    )
                  }
                  className="h-11"
                />
              )}
            </Field>
            {members.length > 1 && !member.isSubmitter ? (
              <Button
                type="button"
                variant="outline"
                aria-label={`Remove team member ${index + 1}`}
                onClick={() =>
                  setMembers((rows) => rows.filter((r) => r.key !== member.key))
                }
                className="h-11 self-end text-ink"
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}

        <div>
          <Button
            type="button"
            variant="outline"
            disabled={members.length >= MAX_TEAM_MEMBERS}
            onClick={() =>
              setMembers((rows) => [
                ...rows,
                { key: crypto.randomUUID(), name: "", email: "" },
              ])
            }
            className="h-11 text-ink"
          >
            + Add a team member
          </Button>
        </div>
      </fieldset>

      <SubmitButton />
    </form>
  );
}
