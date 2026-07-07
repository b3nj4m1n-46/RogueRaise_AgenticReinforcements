"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  createSponsorApplication,
  type SponsorFinancialMode,
} from "@/lib/rogue-raise/sponsors/actions";
import { initialSponsorFormState } from "@/lib/rogue-raise/sponsors/form-state";
import {
  AMOUNT_REGEX,
  sponsorApplicationSchema,
  stakeholderSchema,
} from "@/lib/rogue-raise/sponsors/schema";

// --- Client-side (UX-only) validation --------------------------------------
// Reuses the shared zod schema so fast inline feedback matches the server's
// authority exactly. The server always re-validates; this never gates submit.

type TopField =
  | "orgName"
  | "pocName"
  | "pocEmail"
  | "pocPhone"
  | "painPoints"
  | "goalsNeeds";

function validateTopField(field: TopField, value: string): string | undefined {
  const result = sponsorApplicationSchema.shape[field].safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function validateStakeholderField(
  field: "name" | "email" | "phone",
  value: string,
): string | undefined {
  const result = stakeholderSchema.shape[field].safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

function validateAmount(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter an amount or choose to discuss it later";
  if (!AMOUNT_REGEX.test(trimmed)) {
    return "Enter a whole or two-decimal amount, e.g. 5000 or 5000.00";
  }
  return undefined;
}

// --- Stakeholder rows -------------------------------------------------------

interface StakeholderRow {
  key: string;
  name: string;
  email: string;
  phone: string;
}

const MAX_STAKEHOLDERS = 20;

function emptyRow(): StakeholderRow {
  // Keyed by a stable, collision-free id (React key only — never rendered to the
  // DOM, so no SSR/hydration mismatch). DOM ids use the row index via `useId`.
  return { key: crypto.randomUUID(), name: "", email: "", phone: "" };
}

// --- Submit button (isolated so `useFormStatus` sees the enclosing form) -----

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        className="h-11 w-full text-base font-semibold sm:w-auto sm:self-start"
      >
        {pending ? "Submitting…" : "Submit application"}
      </Button>
      {/* Pending announced politely for screen readers (paired with aria-busy). */}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "Submitting your application, please wait." : ""}
      </span>
    </div>
  );
}

// --- Form -------------------------------------------------------------------

export interface SponsorFormProps {
  challengeTs: string;
  challengeSig: string;
}

export function SponsorForm({ challengeTs, challengeSig }: SponsorFormProps) {
  const [state, formAction] = useActionState(
    createSponsorApplication,
    initialSponsorFormState,
  );

  const baseId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);

  // Financial commitment mode + amount are controlled so "discuss" can clear the
  // amount and drop it from the tab order (it is unmounted, not just hidden).
  const [mode, setMode] = useState<SponsorFinancialMode>(
    state.values?.financialMode ?? "amount",
  );
  const [amount, setAmount] = useState(state.values?.financialAmount ?? "");

  // Stakeholders live in controlled state, serialized to a hidden JSON input.
  const [rows, setRows] = useState<StakeholderRow[]>(() => {
    const initial = state.values?.stakeholders;
    if (initial && initial.length > 0) {
      return initial.map((s) => ({ key: crypto.randomUUID(), ...s }));
    }
    return [emptyRow()];
  });

  // Touched fields switch a control from "show server error" to "show live
  // client validation" so a corrected field can drop its error immediately.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Visually-hidden polite announcements for add/remove + financial mode.
  const [announcement, setAnnouncement] = useState("");

  // Deferred focus target, applied after the DOM updates. Held in a ref (not
  // state) so the applying effect never itself calls setState; a bumped nonce
  // re-runs the effect even when the same id is scheduled twice.
  const pendingFocusRef = useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  function scheduleFocus(id: string) {
    pendingFocusRef.current = id;
    setFocusNonce((n) => n + 1);
  }

  const serverFieldErrors = state.fieldErrors ?? {};
  const hasServerErrors =
    Boolean(state.formError) || Object.keys(serverFieldErrors).length > 0;

  // Move focus to the error summary whenever the server returns errors.
  useEffect(() => {
    if (hasServerErrors) summaryRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Apply any deferred focus (new stakeholder row, revealed amount field, …).
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null; // ref mutation — not a setState in an effect
    document.getElementById(id)?.focus();
  }, [focusNonce]);

  const stkId = (index: number, field: string) =>
    `${baseId}-stk-${index}-${field}`;

  // Error resolution: once touched, the live client result wins (even when
  // undefined, so a fix clears the stale server error); else fall back to server.
  function errorFor(key: string): string | undefined {
    if (touched[key]) return clientErrors[key];
    return serverFieldErrors[key]?.[0];
  }

  function setTouchedError(key: string, message: string | undefined) {
    setTouched((t) => ({ ...t, [key]: true }));
    setClientErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  // --- Financial mode ---
  function handleModeChange(next: SponsorFinancialMode) {
    setMode(next);
    if (next === "discuss") {
      setAmount("");
      setTouchedError("financialCommitment.amount", undefined);
      setAnnouncement(
        "Amount field hidden. We’ll discuss the amount with you later.",
      );
    } else {
      setAnnouncement("Amount field shown. Enter a dollar amount.");
      scheduleFocus(`${baseId}-financial_amount`);
    }
  }

  // --- Stakeholder mutations ---
  function updateRow(key: string, field: keyof StakeholderRow, value: string) {
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }

  function addStakeholder() {
    if (rows.length >= MAX_STAKEHOLDERS) return;
    const newIndex = rows.length;
    setRows((rs) => [...rs, emptyRow()]);
    setAnnouncement(`Stakeholder ${newIndex + 1} added.`);
    scheduleFocus(stkId(newIndex, "name"));
  }

  function removeStakeholder(key: string) {
    if (rows.length <= 1) return;
    const index = rows.findIndex((r) => r.key === key);
    const nextRows = rows.filter((r) => r.key !== key);
    setRows(nextRows);
    setAnnouncement(`Stakeholder ${index + 1} removed.`);
    // Focus the previous row's Remove button; if none remains focusable
    // (down to a single row, where Remove is hidden), focus its Name field.
    if (nextRows.length <= 1) {
      scheduleFocus(stkId(0, "name"));
    } else {
      const targetIndex = Math.max(0, index - 1);
      scheduleFocus(stkId(targetIndex, "remove"));
    }
  }

  const stakeholdersJson = JSON.stringify(
    rows.map(({ name, email, phone }) => ({ name, email, phone })),
  );

  // --- Error summary items ---
  const summaryItems: { label: string; targetId: string }[] = [];
  const pushSummary = (key: string, label: string, targetId: string) => {
    const msg = serverFieldErrors[key]?.[0];
    if (msg) summaryItems.push({ label: `${label}: ${msg}`, targetId });
  };
  pushSummary("orgName", "Organization name", "org_name");
  pushSummary("pocName", "Your name", "poc_name");
  pushSummary("pocEmail", "Email", "poc_email");
  pushSummary("pocPhone", "Phone", "poc_phone");
  pushSummary("painPoints", "The problem", "pain_points");
  pushSummary("goalsNeeds", "Goals and needs", "goals_needs");
  pushSummary(
    "financialCommitment.amount",
    "Financial commitment",
    `${baseId}-financial_amount`,
  );
  pushSummary(
    "financialCommitment.note",
    "Financial note",
    `${baseId}-financial_note`,
  );
  if (serverFieldErrors["stakeholders"]?.[0]) {
    summaryItems.push({
      label: `Stakeholders: ${serverFieldErrors["stakeholders"][0]}`,
      targetId: stkId(0, "name"),
    });
  }
  for (const key of Object.keys(serverFieldErrors)) {
    const match = key.match(/^stakeholders\.(\d+)\.(name|email|phone)$/);
    if (!match) continue;
    const i = Number(match[1]);
    const field = match[2];
    const msg = serverFieldErrors[key]?.[0];
    if (msg && rows[i]) {
      summaryItems.push({
        label: `Stakeholder ${i + 1} ${field}: ${msg}`,
        targetId: stkId(i, field),
      });
    }
  }

  function focusById(id: string) {
    document.getElementById(id)?.focus();
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-10">
      {/* --- Error summary (focus lands here on server error) --- */}
      {hasServerErrors ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby={`${baseId}-summary-heading`}
          className="rounded-lg border border-destructive bg-destructive/5 p-4 outline-none"
        >
          <h2
            id={`${baseId}-summary-heading`}
            className="text-base font-semibold text-destructive"
          >
            We couldn&rsquo;t submit your application
          </h2>
          {state.formError ? (
            <p className="mt-1 text-sm text-ink">{state.formError}</p>
          ) : null}
          {summaryItems.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-ink">
                Please fix the following:
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {summaryItems.map((item) => (
                  <li key={item.targetId + item.label}>
                    <a
                      href={`#${item.targetId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusById(item.targetId);
                      }}
                      className="font-medium text-destructive underline underline-offset-2"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {/* --- Section 1: Organization --- */}
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Your organization
        </legend>
        <Field
          id="org_name"
          label="Organization name"
          required
          error={errorFor("orgName")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="org_name"
              type="text"
              required
              maxLength={200}
              defaultValue={state.values?.orgName ?? ""}
              onBlur={(e) =>
                setTouchedError("orgName", validateTopField("orgName", e.target.value))
              }
              className="h-11"
            />
          )}
        </Field>
      </fieldset>

      {/* --- Section 2: Primary contact --- */}
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Primary contact
        </legend>
        <Field
          id="poc_name"
          label="Your name"
          required
          error={errorFor("pocName")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="poc_name"
              type="text"
              required
              autoComplete="name"
              maxLength={200}
              defaultValue={state.values?.pocName ?? ""}
              onBlur={(e) =>
                setTouchedError("pocName", validateTopField("pocName", e.target.value))
              }
              className="h-11"
            />
          )}
        </Field>
        <Field
          id="poc_email"
          label="Email"
          required
          error={errorFor("pocEmail")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="poc_email"
              type="email"
              inputMode="email"
              required
              autoComplete="email"
              maxLength={254}
              defaultValue={state.values?.pocEmail ?? ""}
              onBlur={(e) =>
                setTouchedError("pocEmail", validateTopField("pocEmail", e.target.value))
              }
              className="h-11"
            />
          )}
        </Field>
        <Field
          id="poc_phone"
          label="Phone"
          required
          description="Include your country code, e.g. +15415551234."
          error={errorFor("pocPhone")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="poc_phone"
              type="tel"
              inputMode="tel"
              required
              autoComplete="tel"
              placeholder="+15415551234"
              defaultValue={state.values?.pocPhone ?? ""}
              onBlur={(e) =>
                setTouchedError("pocPhone", validateTopField("pocPhone", e.target.value))
              }
              className="h-11"
            />
          )}
        </Field>
      </fieldset>

      {/* --- Section 3: The problem --- */}
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          The problem
        </legend>
        <Field
          id="pain_points"
          label="What problem are you facing?"
          required
          description="Tell us about the pain points a Rogue Raise could help address."
          error={errorFor("painPoints")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="pain_points"
              required
              rows={5}
              maxLength={5000}
              defaultValue={state.values?.painPoints ?? ""}
              onBlur={(e) =>
                setTouchedError(
                  "painPoints",
                  validateTopField("painPoints", e.target.value),
                )
              }
              className="min-h-28"
            />
          )}
        </Field>
        <Field
          id="goals_needs"
          label="What are your goals and needs?"
          required
          description="What would a successful outcome look like for your organization?"
          error={errorFor("goalsNeeds")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="goals_needs"
              required
              rows={5}
              maxLength={5000}
              defaultValue={state.values?.goalsNeeds ?? ""}
              onBlur={(e) =>
                setTouchedError(
                  "goalsNeeds",
                  validateTopField("goalsNeeds", e.target.value),
                )
              }
              className="min-h-28"
            />
          )}
        </Field>
      </fieldset>

      {/* --- Section 4: Financial commitment --- */}
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Financial commitment
        </legend>
        <p className="text-sm text-ink/70">
          Payment is arranged offline. We only need your intended commitment now.
        </p>

        <RadioGroup
          name="financial_mode"
          value={mode}
          onValueChange={(v) => handleModeChange(v as SponsorFinancialMode)}
          aria-label="How would you like to handle the financial commitment?"
          className="gap-2"
        >
          <label
            htmlFor={`${baseId}-mode-amount`}
            className="flex min-h-11 cursor-pointer items-center gap-3 text-ink"
          >
            <RadioGroupItem
              id={`${baseId}-mode-amount`}
              value="amount"
              className="size-5"
            />
            <span>Commit an amount</span>
          </label>
          <label
            htmlFor={`${baseId}-mode-discuss`}
            className="flex min-h-11 cursor-pointer items-center gap-3 text-ink"
          >
            <RadioGroupItem
              id={`${baseId}-mode-discuss`}
              value="discuss"
              className="size-5"
            />
            <span>I&rsquo;d prefer to discuss it</span>
          </label>
        </RadioGroup>

        {mode === "amount" ? (
          <Field
            id={`${baseId}-financial_amount`}
            label="Amount (USD)"
            required
            description="Whole dollars or two decimals, e.g. 5000 or 5000.00."
            error={errorFor("financialCommitment.amount")}
          >
            {(aria) => (
              <Input
                {...aria}
                name="financial_amount"
                type="text"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={(e) =>
                  setTouchedError(
                    "financialCommitment.amount",
                    validateAmount(e.target.value),
                  )
                }
                placeholder="5000"
                className="h-11"
              />
            )}
          </Field>
        ) : null}

        <Field
          id={`${baseId}-financial_note`}
          label="Anything to add about the commitment?"
          error={errorFor("financialCommitment.note")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="financial_note"
              rows={3}
              maxLength={2000}
              defaultValue={state.values?.financialNote ?? ""}
              className="min-h-20"
            />
          )}
        </Field>
      </fieldset>

      {/* --- Section 5: Stakeholders --- */}
      <fieldset className="flex flex-col gap-5 border-0 p-0">
        <legend className="mb-1 font-serif text-2xl font-semibold text-wr-olive-green">
          Stakeholders
        </legend>
        <p className="text-sm text-ink/70">
          The people at your organization we should keep in the loop. Add at least
          one; up to {MAX_STAKEHOLDERS}.
        </p>

        {serverFieldErrors["stakeholders"]?.[0] ? (
          <p className="text-sm font-medium text-destructive">
            {serverFieldErrors["stakeholders"][0]}
          </p>
        ) : null}

        <div className="flex flex-col gap-6">
          {rows.map((row, index) => (
            <fieldset
              key={row.key}
              className="flex flex-col gap-4 rounded-lg border border-input p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <legend className="px-1 text-base font-medium text-ink">
                  Stakeholder {index + 1}
                </legend>
                {rows.length > 1 ? (
                  <Button
                    id={stkId(index, "remove")}
                    type="button"
                    variant="outline"
                    onClick={() => removeStakeholder(row.key)}
                    aria-label={`Remove stakeholder ${index + 1}`}
                    className="h-11 min-w-11 text-ink"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <Field
                id={stkId(index, "name")}
                label="Name"
                required
                error={errorFor(`stakeholders.${index}.name`)}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    type="text"
                    maxLength={200}
                    value={row.name}
                    onChange={(e) => updateRow(row.key, "name", e.target.value)}
                    onBlur={(e) =>
                      setTouchedError(
                        `stakeholders.${index}.name`,
                        validateStakeholderField("name", e.target.value),
                      )
                    }
                    className="h-11"
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={stkId(index, "email")}
                  label="Email"
                  required
                  className="min-w-0"
                  error={errorFor(`stakeholders.${index}.email`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="email"
                      inputMode="email"
                      maxLength={254}
                      value={row.email}
                      onChange={(e) =>
                        updateRow(row.key, "email", e.target.value)
                      }
                      onBlur={(e) =>
                        setTouchedError(
                          `stakeholders.${index}.email`,
                          validateStakeholderField("email", e.target.value),
                        )
                      }
                      className="h-11"
                    />
                  )}
                </Field>
                <Field
                  id={stkId(index, "phone")}
                  label="Phone"
                  required
                  className="min-w-0"
                  error={errorFor(`stakeholders.${index}.phone`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="tel"
                      inputMode="tel"
                      placeholder="+15415551234"
                      value={row.phone}
                      onChange={(e) =>
                        updateRow(row.key, "phone", e.target.value)
                      }
                      onBlur={(e) =>
                        setTouchedError(
                          `stakeholders.${index}.phone`,
                          validateStakeholderField("phone", e.target.value),
                        )
                      }
                      className="h-11"
                    />
                  )}
                </Field>
              </div>
            </fieldset>
          ))}
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            onClick={addStakeholder}
            disabled={rows.length >= MAX_STAKEHOLDERS}
            aria-label="Add another stakeholder"
            className="h-11 text-ink"
          >
            + Add stakeholder
          </Button>
          {rows.length >= MAX_STAKEHOLDERS ? (
            <p className="mt-2 text-sm text-ink/70">
              You&rsquo;ve added the maximum of {MAX_STAKEHOLDERS} stakeholders.
            </p>
          ) : null}
        </div>
      </fieldset>

      {/* Form-level error not tied to a single field. */}
      {state.formError && !hasServerErrors ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.formError}
        </p>
      ) : null}

      {/* Hidden wire fields: serialized stakeholders + signed spam challenge. */}
      <input type="hidden" name="stakeholders_json" value={stakeholdersJson} />
      <input type="hidden" name="challenge_ts" value={challengeTs} />
      <input type="hidden" name="challenge_sig" value={challengeSig} />

      {/* Honeypot — off-screen, hidden from AT, out of the tab order. */}
      <div className="rr-honeypot" aria-hidden="true">
        <Label htmlFor={`${baseId}-contact_time`}>
          Leave this field blank
        </Label>
        <input
          id={`${baseId}-contact_time`}
          type="text"
          name="contact_time"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <SubmitButton />

      {/* Polite live region for add/remove + financial-mode announcements. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </form>
  );
}
