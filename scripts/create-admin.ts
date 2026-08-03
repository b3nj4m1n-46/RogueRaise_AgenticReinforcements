/**
 * Creates (or promotes) a White Rabbit admin account.
 *
 * Sign-up is disabled in the app on purpose — an open sign-up form on a console
 * that can email every participant is not a thing to ship — so the first admin
 * has to come from somewhere. This is that somewhere.
 *
 *   npm run admin:create -- staff@whiterabbitashland.com "Jamie Rivers"
 *
 * The password is read from RR_ADMIN_INITIAL_PASSWORD, or generated and printed
 * once. It is never written to a file, and the account is created through Better
 * Auth so the password is hashed by the same code path that verifies it.
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../src/lib/rogue-raise/db";
import { user } from "../src/lib/rogue-raise/db/auth-schema";
import { ADMIN_ROLE, getAuth } from "../src/lib/rogue-raise/integrations/auth";

function usage(message: string): never {
  console.error(`${message}

Usage: npm run admin:create -- <email> "<full name>"

Environment:
  DATABASE_URL              required
  BETTER_AUTH_SECRET        required
  BETTER_AUTH_URL           required
  RR_ADMIN_INITIAL_PASSWORD optional; generated if unset`);
  process.exit(1);
}

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !email.includes("@")) usage("Give an email address.");
  if (!name) usage("Give the person's full name.");

  const password =
    process.env.RR_ADMIN_INITIAL_PASSWORD ?? randomBytes(18).toString("base64url");
  const generated = !process.env.RR_ADMIN_INITIAL_PASSWORD;

  const [existing] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing) {
    // Promote rather than fail: re-running this to grant admin to an account
    // that already exists is the common case after the first time.
    if (existing.role === ADMIN_ROLE) {
      console.log(`${email} is already an admin. Nothing to do.`);
    } else {
      await db
        .update(user)
        .set({ role: ADMIN_ROLE, updatedAt: new Date() })
        .where(eq(user.id, existing.id));
      console.log(`Promoted ${email} to ${ADMIN_ROLE}.`);
    }
    await db.$client.end();
    return;
  }

  // Through Better Auth's own API so the password is hashed by the same code
  // that will verify it. `disableSignUp` blocks the HTTP route, not this.
  await getAuth().api.createUser({
    body: { email, password, name, role: ADMIN_ROLE },
  });

  console.log(`Created admin ${email}.`);
  if (generated) {
    console.log(`\n  Password: ${password}\n`);
    console.log("Shown once. Save it now, then change it after signing in.");
  }
  await db.$client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
