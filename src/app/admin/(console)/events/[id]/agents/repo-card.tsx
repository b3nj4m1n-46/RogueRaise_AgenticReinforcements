"use client";

/**
 * Context-repo provisioning card.
 *
 * Blockers are shown *before* the button, not discovered by pressing it — the
 * whole point of the review gate is that a staff member can see what still
 * needs a decision.
 */
import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { initialAdminEventState } from "@/lib/rogue-raise/events/state";
import { provisionRepoAction } from "@/lib/rogue-raise/repo/admin-actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="h-11">
      {pending ? "Building…" : label}
    </Button>
  );
}

export function RepoCard({
  eventId,
  blockers,
  repoUrl,
  pullRequestUrl,
  isPublic,
  canProvision,
  phaseReason,
}: {
  eventId: string;
  blockers: string[];
  repoUrl: string | null;
  pullRequestUrl: string | null;
  isPublic: boolean;
  canProvision: boolean;
  phaseReason: string | null;
}) {
  const [state, action] = useActionState(provisionRepoAction, initialAdminEventState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.formError) errorRef.current?.focus();
  }, [state.formError, state.version]);

  const ready = canProvision && blockers.length === 0;

  return (
    <section
      aria-labelledby="repo-card"
      className="flex flex-col gap-4 rounded-lg border border-wr-olive-green/25 p-5"
    >
      <div>
        <h2
          id="repo-card"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          Context repository
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink/70">
          Turns the approved documents into a real GitHub repo with a pull
          request. It stays private until the repo review is approved.
        </p>
      </div>

      <p
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={
          state.formError
            ? "rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-ink outline-none"
            : "sr-only"
        }
      >
        {state.formError ?? ""}
      </p>
      <p
        role="status"
        className={
          state.notice && !state.formError
            ? "rounded-md border border-wr-olive-green/50 bg-secondary/50 p-3 text-sm text-ink"
            : "sr-only"
        }
      >
        {state.notice ?? ""}
      </p>

      {repoUrl ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-ink/60">Repository</dt>
          <dd className="text-ink/90">
            <a href={repoUrl} className="underline underline-offset-4 break-all">
              {repoUrl}
            </a>{" "}
            <span className="text-ink/60">({isPublic ? "public" : "private"})</span>
          </dd>
          {pullRequestUrl ? (
            <>
              <dt className="text-ink/60">Pull request</dt>
              <dd className="text-ink/90">
                <a
                  href={pullRequestUrl}
                  className="underline underline-offset-4 break-all"
                >
                  {pullRequestUrl}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {!canProvision ? (
        <p className="text-sm text-ink/60">{phaseReason}</p>
      ) : blockers.length > 0 ? (
        <div className="text-sm">
          <p className="font-medium text-ink">Before the repo can be built:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {blockers.map((blocker) => (
              <li key={blocker} className="flex gap-2 text-ink/80">
                <span aria-hidden="true" className="font-mono text-ink/60">
                  ○
                </span>
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {repoUrl ? (
        <p className="text-sm">
          <Link
            href={`/admin/events/${eventId}/repo-review`}
            className="font-medium text-ink underline underline-offset-4"
          >
            Review the repository file by file →
          </Link>
        </p>
      ) : null}

      {ready ? (
        <form action={action}>
          <input type="hidden" name="event_id" value={eventId} />
          <SubmitButton label={repoUrl ? "Update the repository" : "Build the repository"} />
        </form>
      ) : null}
    </section>
  );
}
