"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInAdmin } from "@/lib/rogue-raise/admin/sign-in-actions";
import { initialSignInState } from "@/lib/rogue-raise/admin/sign-in-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending}
      className="h-12 w-full text-base font-semibold"
    >
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function SignInForm({ next }: { next: string }) {
  const baseId = useId();
  const [state, action] = useActionState(signInAdmin, initialSignInState);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/5 p-3 text-sm text-ink"
        >
          {state.error}
        </p>
      ) : null}

      <Field id={`${baseId}-email`} label="Email" required>
        {(aria) => (
          <Input
            {...aria}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            defaultValue={state.email ?? ""}
            className="h-11"
          />
        )}
      </Field>

      <Field id={`${baseId}-password`} label="Password" required>
        {(aria) => (
          <Input
            {...aria}
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-11"
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
