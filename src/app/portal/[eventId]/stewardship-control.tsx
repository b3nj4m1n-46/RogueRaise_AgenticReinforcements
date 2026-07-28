"use client";

/**
 * The handoff bridge (PRD §8.3) — where a stakeholder commits to carrying a
 * project forward.
 *
 * Rendered as radios rather than a dropdown on purpose: all four options and
 * what each one means should be readable without an interaction, because the
 * difference between "adopting" and "stewarding" is exactly what the person
 * needs to think about.
 */
import { useState, useTransition } from "react";

import { markStewardship } from "@/lib/rogue-raise/portal/actions";
import { STEWARDSHIP_CHOICES } from "@/lib/rogue-raise/portal/stewardship";
import { cn } from "@/lib/utils";

export function StewardshipControl({
  eventId,
  token,
  submissionId,
  teamName,
  current,
}: {
  eventId: string;
  token: string;
  submissionId: string;
  teamName: string;
  current: string;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const choose = (next: string) => {
    const previous = value;
    // Optimistic: the click IS the decision, and a radio that doesn't move
    // until a round-trip finishes feels broken. Reverted on failure.
    setValue(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await markStewardship({
        eventId,
        token,
        submissionId,
        stewardship: next,
      });
      if (result.ok) {
        setSaved(true);
      } else {
        setValue(previous);
        setError(result.error ?? "That didn't save. Please try again.");
      }
    });
  };

  return (
    <fieldset className="border-0 p-0" disabled={pending}>
      <legend className="mb-2 font-medium text-ink">
        What happens to this now?
      </legend>
      <div className="flex flex-col gap-2">
        {STEWARDSHIP_CHOICES.map((choice) => {
          const id = `${submissionId}-${choice.value}`;
          const checked = value === choice.value;
          return (
            <label
              key={choice.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                checked
                  ? "border-ink bg-ink/5"
                  : "border-wr-olive-green/30 hover:bg-muted",
              )}
            >
              <input
                type="radio"
                id={id}
                name={`stewardship-${submissionId}`}
                value={choice.value}
                checked={checked}
                onChange={() => choose(choice.value)}
                className="mt-1 size-4 accent-wr-olive-green"
              />
              <span>
                <span className="block font-medium text-ink">{choice.label}</span>
                <span className="block text-sm text-ink/70">
                  {choice.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <p role="status" aria-live="polite" className="mt-2 text-sm text-ink/70">
        {pending
          ? "Saving…"
          : saved
            ? `Recorded for ${teamName}. You can change this any time.`
            : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
