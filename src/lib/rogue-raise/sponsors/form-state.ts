import type { SponsorFormState } from "./actions";

/**
 * Initial `useActionState` state for the public sponsor form.
 *
 * Lives OUTSIDE `actions.ts` because that module is `"use server"`, and Next only
 * allows a `"use server"` file to export async functions — a value export like
 * this one throws at runtime:
 *   A "use server" file can only export async functions, found object.
 * The `SponsorFormState` type still comes from `actions.ts` (type-only import,
 * fully erased, so no runtime dependency cycle).
 */
export const initialSponsorFormState: SponsorFormState = { ok: false };
