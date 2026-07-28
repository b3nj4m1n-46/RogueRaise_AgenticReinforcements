/**
 * Constants shared by the intake actions and the intake read model. Plain
 * module: `"use server"` files may only export async functions, so every value
 * export has to live somewhere like this (see CLAUDE.md).
 */

/** `attachments.kind` for the files the intake form owns. */
export const INTAKE_ATTACHMENT_KIND = "intake_supplementary";

/**
 * Audit actor for POC-driven changes. There is no per-person identity until
 * Better Auth lands; the magic-link TOKEN ID recorded in `metadata` is the
 * closest thing to one, and it is safe to store (a token id is not a token).
 */
export const ACTOR_SPONSOR_POC = "sponsor_poc";
