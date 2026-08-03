"use server";

/**
 * Admin sign-in and sign-out (PRD §12).
 *
 * The error copy here is deliberately uniform: a wrong password and an unknown
 * address produce the same sentence, because differing messages turn the form
 * into an oracle for which WR staff addresses exist.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import { ADMIN_ROLE, getAuth, isAuthConfigured } from "../integrations/auth";
import type { SignInState } from "./sign-in-state";

const credentialsSchema = z.object({
  email: z.email("Enter the email address on your White Rabbit account."),
  password: z.string().min(1, "Enter your password."),
});

/** Only ever redirect within this app — an open redirect on a login form is a
 * phishing primitive. */
function safeNext(raw: string): string {
  return raw.startsWith("/admin") && !raw.startsWith("//") ? raw : "/admin/events";
}

const GENERIC_FAILURE =
  "That email address and password don't match a White Rabbit admin account.";

export async function signInAdmin(
  prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));
  const version = (prevState.version ?? 0) + 1;

  if (!isAuthConfigured()) {
    return {
      ok: false,
      email,
      version,
      error:
        "Sign-in isn't configured in this environment. Set BETTER_AUTH_SECRET and BETTER_AUTH_URL.",
    };
  }

  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, email, version, error: parsed.error.issues[0].message };
  }

  try {
    const result = await getAuth().api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
      // Better Auth writes the session cookie onto the response for us.
      asResponse: false,
      returnHeaders: false,
    });

    // Authenticated, but not staff. The session exists at this point; that is
    // fine — every admin surface checks the ROLE, not merely the session.
    if (result?.user?.role !== ADMIN_ROLE) {
      return { ok: false, email, version, error: GENERIC_FAILURE };
    }
  } catch {
    // Better Auth throws APIError on bad credentials, a disabled sign-up, or a
    // banned account. All of them are the same sentence on purpose.
    return { ok: false, email, version, error: GENERIC_FAILURE };
  }

  redirect(next);
}

export async function signOutAdmin(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (err) {
    // A failed sign-out must not strand someone on a page they can't leave.
    console.error("[admin] sign-out failed", err);
  }
  redirect("/admin/sign-in");
}
