"use client";

/**
 * The intake form island (PRD §5.2.2).
 *
 * Two things drive the design:
 *
 * 1. **It auto-saves.** The draft is NOT an HTML `<form>` — edits live in client
 *    state and a debounced effect dispatches the server action directly. That
 *    keeps the attachment forms (which ARE real forms, one per file action) out
 *    of an illegal nested-form situation, and it means a save never navigates.
 *
 * 2. **A save must never lose typing.** The client validates with the SAME zod
 *    schema the server uses and holds back the autosave while a row is invalid,
 *    so the "not saved" state is always explained by a visible field error. On a
 *    server rejection the values stay exactly where they are.
 */
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  removeIntakeAttachment,
  saveIntake,
  uploadIntakeAttachment,
} from "@/lib/rogue-raise/intake/actions";
import {
  evaluateCompleteness,
  factsFromDraft,
} from "@/lib/rogue-raise/intake/completeness";
import { initialIntakeFormState } from "@/lib/rogue-raise/intake/form-state";
import type { IntakeAttachmentView } from "@/lib/rogue-raise/intake/queries";
import {
  DEFAULT_KICKOFF_HOUR,
  describeSchedule,
  formatWeekendLabel,
  isFridayDate,
  MAX_KICKOFF_HOUR,
  MIN_KICKOFF_HOUR,
  buildFridayKickoff,
} from "@/lib/rogue-raise/intake/schedule";
import {
  dropBlankRows,
  intakeDraftSchema,
  MAX_CRITERIA,
  MAX_DATE_OPTIONS,
  MAX_JUDGES,
  MAX_TECH_SPONSORS,
  parseTags,
  TECH_SPONSOR_STATUSES,
  type IntakeDraft,
} from "@/lib/rogue-raise/intake/schema";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "@/lib/rogue-raise/intake/uploads";

const AUTOSAVE_DELAY_MS = 1500;

// --- Row helpers ------------------------------------------------------------
// Every repeatable row carries a client-only `key` so React identity survives
// reordering and removal. It is stripped before anything is sent to the server.

type Keyed<T> = T & { key: string };

function keyed<T>(rows: T[]): Keyed<T>[] {
  return rows.map((row) => ({ ...row, key: crypto.randomUUID() }));
}

/** Client-only `key` is stripped before anything crosses to the server. */
function strip<T extends { key: string }>(rows: T[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.key;
    return copy;
  });
}

type JudgeRow = Keyed<{ name: string; email: string; phone: string }>;
type CriterionRow = Keyed<{ label: string; description: string; weight: string }>;
type DateRow = Keyed<{ date: string; kickoffHour: number }>;
type SponsorRow = Keyed<{
  name: string;
  offering: string;
  contactName: string;
  contactEmail: string;
  status: string;
}>;

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const KICKOFF_HOURS = Array.from(
  { length: MAX_KICKOFF_HOUR - MIN_KICKOFF_HOUR + 1 },
  (_, i) => MIN_KICKOFF_HOUR + i,
);

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

// --- Section shell ----------------------------------------------------------

function Section({
  id,
  title,
  vital,
  description,
  children,
}: {
  id: string;
  title: string;
  vital?: boolean;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      // `scroll-mt` clears the sticky save bar when a progress link jumps here.
      className="flex flex-col gap-5 scroll-mt-28"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id={`${id}-heading`}
            className="font-serif text-2xl font-semibold text-wr-olive-green"
          >
            {title}
          </h2>
          {vital ? (
            <span className="rounded-full border border-wr-olive-green px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-wr-olive-green">
              Vital
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-prose text-sm text-ink/70">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function RowCard({
  legend,
  onRemove,
  removeLabel,
  removeId,
  children,
}: {
  legend: string;
  onRemove?: () => void;
  removeLabel: string;
  removeId: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-input p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="px-1 text-base font-medium text-ink">{legend}</legend>
        {onRemove ? (
          <Button
            id={removeId}
            type="button"
            variant="outline"
            onClick={onRemove}
            aria-label={removeLabel}
            className="h-11 min-w-11 text-ink"
          >
            Remove
          </Button>
        ) : null}
      </div>
      {children}
    </fieldset>
  );
}

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      aria-busy={pending}
      className="h-11 text-ink"
    >
      {pending ? "Uploading…" : "Upload file"}
    </Button>
  );
}

function RemoveFileButton({ filename }: { filename: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      aria-busy={pending}
      aria-label={`Remove ${filename}`}
      className="h-11 min-w-11 text-ink"
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}

// --- Form -------------------------------------------------------------------

export interface IntakeFormProps {
  eventId: string;
  token: string;
  initialDraft: IntakeDraft;
  initialAttachments: IntakeAttachmentView[];
}

export function IntakeForm({
  eventId,
  token,
  initialDraft,
  initialAttachments,
}: IntakeFormProps) {
  const baseId = useId();

  const [saveState, saveAction, savePending] = useActionState(
    saveIntake,
    initialIntakeFormState,
  );
  const [uploadState, uploadAction] = useActionState(
    uploadIntakeAttachment,
    initialIntakeFormState,
  );
  const [removeState, removeAction] = useActionState(
    removeIntakeAttachment,
    initialIntakeFormState,
  );

  // --- Draft state ---
  const [judges, setJudges] = useState<JudgeRow[]>(() =>
    keyed(
      initialDraft.judges.map((j) => ({
        name: j.name,
        email: j.email,
        phone: j.phone ?? "",
      })),
    ),
  );
  const [criteria, setCriteria] = useState<CriterionRow[]>(() =>
    keyed(
      initialDraft.criteria.map((c) => ({
        label: c.label,
        description: c.description ?? "",
        weight: c.weight ?? "",
      })),
    ),
  );
  const [dates, setDates] = useState<DateRow[]>(() => keyed(initialDraft.dateOptions));
  const [sponsors, setSponsors] = useState<SponsorRow[]>(() =>
    keyed(
      initialDraft.techSponsors.map((s) => ({
        name: s.name,
        offering: s.offering ?? "",
        contactName: s.contactName ?? "",
        contactEmail: s.contactEmail ?? "",
        status: s.status,
      })),
    ),
  );
  const [budgetAmount, setBudgetAmount] = useState(
    initialDraft.awardsBudget.amount ?? "",
  );
  const [budgetNote, setBudgetNote] = useState(initialDraft.awardsBudget.note ?? "");
  const [supplementaryInfo, setSupplementaryInfo] = useState(
    initialDraft.supplementaryInfo ?? "",
  );
  const [techStack, setTechStack] = useState(initialDraft.stakeholderTechStack ?? "");
  const [tagsInput, setTagsInput] = useState(
    (initialDraft.stakeholderTechTags ?? []).join(", "),
  );

  const [dirty, setDirty] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Deferred focus for newly added / removed rows (ref, so the effect that
  // applies it never itself sets state).
  const pendingFocusRef = useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const scheduleFocus = useCallback((id: string) => {
    pendingFocusRef.current = id;
    setFocusNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    document.getElementById(id)?.focus();
  }, [focusNonce]);

  // --- Assembled draft (exactly what the server will receive) ---
  const draft = useMemo(
    () => ({
      judges: dropBlankRows(strip(judges)),
      criteria: dropBlankRows(strip(criteria)),
      dateOptions: dropBlankRows(strip(dates)),
      techSponsors: dropBlankRows(strip(sponsors)),
      awardsBudget: { amount: budgetAmount, note: budgetNote },
      supplementaryInfo,
      stakeholderTechStack: techStack,
      stakeholderTechTags: parseTags(tagsInput),
    }),
    [
      judges,
      criteria,
      dates,
      sponsors,
      budgetAmount,
      budgetNote,
      supplementaryInfo,
      techStack,
      tagsInput,
    ],
  );

  // --- Live validation with the shared schema ---
  const parsed = useMemo(() => intakeDraftSchema.safeParse(draft), [draft]);
  const clientErrors = useMemo(() => {
    if (parsed.success) return {} as Record<string, string>;
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((p) => String(p)).join(".");
      errors[key] ??= issue.message;
    }
    return errors;
  }, [parsed]);

  const serverFieldErrors = saveState.fieldErrors ?? {};
  const errorFor = (path: string): string | undefined =>
    clientErrors[path] ?? serverFieldErrors[path]?.[0];

  // --- Progress ---
  const attachments = initialAttachments;
  const completeness = useMemo(() => {
    const facts = parsed.success
      ? factsFromDraft(parsed.data, attachments.length)
      : {
          dateOptionCount: draft.dateOptions.length,
          supplementaryInfo,
          attachmentCount: attachments.length,
          stakeholderTechStack: techStack,
          judgeCount: draft.judges.length,
          criteriaCount: draft.criteria.length,
          techSponsorCount: draft.techSponsors.length,
          awardsBudgetAmount: budgetAmount,
          awardsBudgetNote: budgetNote,
        };
    return evaluateCompleteness(facts);
  }, [
    parsed,
    attachments.length,
    draft,
    supplementaryInfo,
    techStack,
    budgetAmount,
    budgetNote,
  ]);

  // --- Saving ---
  const submit = useCallback(() => {
    const formData = new FormData();
    formData.set("event_id", eventId);
    formData.set("token", token);
    formData.set("intake_json", JSON.stringify(draft));
    // Dispatched outside a <form>, so the transition is ours to open — without
    // it React warns and `isPending` never flips.
    startTransition(() => saveAction(formData));
    setDirty(false);
  }, [draft, eventId, token, saveAction]);

  // Debounced autosave. Held back while the draft is invalid so "not saved" is
  // always paired with a visible field error rather than being a mystery.
  useEffect(() => {
    if (!dirty || !parsed.success) return;
    const timer = setTimeout(submit, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, parsed.success, submit]);

  // Last line of defence against losing work in a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = () => setDirty(true);

  function update<T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    key: string,
    field: keyof T,
    value: T[keyof T],
  ) {
    setter((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    touch();
  }

  // --- Save-status copy ---
  const saveStatusText = savePending
    ? "Saving…"
    : dirty
      ? parsed.success
        ? "Unsaved changes"
        : "Not saved — fix the highlighted fields"
      : saveState.status === "error"
        ? "Not saved"
        : saveState.savedAt
          ? `Saved at ${formatClock(saveState.savedAt)}`
          : "Nothing to save yet";

  const notice = uploadState.notice ?? removeState.notice;
  const actionError =
    saveState.status === "error"
      ? saveState.formError
      : (uploadState.status === "error" ? uploadState.formError : undefined) ??
        (removeState.status === "error" ? removeState.formError : undefined);

  const errorRef = useRef<HTMLDivElement>(null);
  const errorVersion =
    (saveState.version ?? 0) + (uploadState.version ?? 0) + (removeState.version ?? 0);
  useEffect(() => {
    if (actionError) errorRef.current?.focus();
    // Keyed on the version counter so an identical repeated error still
    // re-announces and re-focuses.
  }, [actionError, errorVersion]);

  return (
    <div className="flex flex-col gap-12">
      {/* --- Progress --- */}
      <aside
        aria-labelledby={`${baseId}-progress-heading`}
        className="rounded-lg border border-input bg-secondary/40 p-5"
      >
        <h2
          id={`${baseId}-progress-heading`}
          className="font-serif text-xl font-semibold text-ink"
        >
          What we still need
        </h2>
        <p className="mt-1 text-sm text-ink/70">
          {completeness.requiredMetCount} of {completeness.requiredTotal} vital
          sections complete.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {completeness.required.map((req) => (
            <li key={req.key} className="flex gap-2 text-sm">
              <span aria-hidden="true" className="font-mono text-ink/70">
                {req.met ? "✓" : "○"}
              </span>
              <span>
                <a
                  href={`#${req.key}`}
                  className="font-medium text-ink underline underline-offset-4"
                >
                  {req.label}
                </a>{" "}
                <span className="text-ink/70">
                  {req.met ? "— done" : `— still needed. ${req.hint}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink/70">
          These also help, but they don&rsquo;t hold anything up:{" "}
          {completeness.optional
            .map((o) => `${o.label}${o.met ? " (done)" : ""}`)
            .join(", ")}
          .
        </p>
      </aside>

      {/* --- Save state (persistent live regions, rendered on first paint) --- */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-3 border-b border-input bg-background/95 px-2 py-3 backdrop-blur">
        <Button
          type="button"
          onClick={submit}
          disabled={savePending || !parsed.success}
          aria-busy={savePending}
          className="h-11"
        >
          Save now
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-ink/70">
          {saveStatusText}
        </p>
        {completeness.complete ? (
          <p className="text-sm font-medium text-wr-olive-green">
            All vital details are in.
          </p>
        ) : null}
      </div>

      <div
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={
          actionError
            ? "rounded-lg border border-destructive bg-destructive/5 p-4 text-sm text-ink outline-none"
            : "sr-only"
        }
      >
        {actionError ?? ""}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {notice ?? ""}
      </div>

      {/* --- Weekends (VITAL) --- */}
      <Section
        id="potential_dates"
        title="Possible weekends"
        vital
        description="Every Rogue Raise runs Friday evening to Sunday evening. Offer as many weekends as you can — we'll confirm one with you."
      >
        <div className="flex flex-col gap-6">
          {dates.map((row, index) => {
            const valid = isFridayDate(row.date || "");
            return (
              <RowCard
                key={row.key}
                legend={`Weekend ${index + 1}`}
                removeId={`${baseId}-date-${index}-remove`}
                removeLabel={`Remove weekend ${index + 1}`}
                onRemove={() => {
                  setDates((rows) => rows.filter((r) => r.key !== row.key));
                  setAnnouncement(`Weekend ${index + 1} removed.`);
                  touch();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`${baseId}-date-${index}-date`}
                    label="Friday of that weekend"
                    required
                    error={errorFor(`dateOptions.${index}.date`)}
                  >
                    {(aria) => (
                      <Input
                        {...aria}
                        type="date"
                        value={row.date}
                        onChange={(e) =>
                          update(setDates, row.key, "date", e.target.value)
                        }
                        className="h-11"
                      />
                    )}
                  </Field>
                  <Field
                    id={`${baseId}-date-${index}-hour`}
                    label="Kickoff time"
                    error={errorFor(`dateOptions.${index}.kickoffHour`)}
                  >
                    {(aria) => (
                      <select
                        {...aria}
                        value={row.kickoffHour}
                        onChange={(e) =>
                          update(
                            setDates,
                            row.key,
                            "kickoffHour",
                            Number(e.target.value),
                          )
                        }
                        className="h-11 rounded-md border border-input bg-transparent px-3 text-base text-ink"
                      >
                        {KICKOFF_HOURS.map((hour) => (
                          <option key={hour} value={hour}>
                            {hourLabel(hour)}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>

                {valid ? (
                  <div className="rounded-md bg-secondary/50 p-3 text-sm text-ink/80">
                    <p className="font-medium text-ink">
                      {formatWeekendLabel(
                        buildFridayKickoff(row.date, row.kickoffHour),
                      )}
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {describeSchedule(
                        buildFridayKickoff(row.date, row.kickoffHour),
                      ).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </RowCard>
            );
          })}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 text-ink"
            disabled={dates.length >= MAX_DATE_OPTIONS}
            onClick={() => {
              const index = dates.length;
              setDates((rows) => [
                ...rows,
                { key: crypto.randomUUID(), date: "", kickoffHour: DEFAULT_KICKOFF_HOUR },
              ]);
              setAnnouncement(`Weekend ${index + 1} added.`);
              scheduleFocus(`${baseId}-date-${index}-date`);
              touch();
            }}
          >
            + Add a weekend
          </Button>
        </div>
      </Section>

      {/* --- Supporting context (VITAL) --- */}
      <Section
        id="supplementary_info"
        title="Supporting context"
        vital
        description="Anything that helps builders understand the problem: data samples, reports, screenshots, links. Write it here, attach files, or both."
      >
        <Field
          id={`${baseId}-supplementary`}
          label="What should builders know?"
          error={errorFor("supplementaryInfo")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              rows={6}
              value={supplementaryInfo}
              onChange={(e) => {
                setSupplementaryInfo(e.target.value);
                touch();
              }}
              className="min-h-32"
            />
          )}
        </Field>

        <div className="flex flex-col gap-3 rounded-lg border border-input p-4">
          <h3 className="text-base font-medium text-ink">Attached files</h3>
          {attachments.length === 0 ? (
            <p className="text-sm text-ink/70">No files attached yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-input pb-2 last:border-0"
                >
                  <span className="text-sm text-ink">
                    <a
                      href={`/sponsor/intake/${eventId}/attachments/${file.id}?token=${encodeURIComponent(token)}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {file.filename}
                    </a>
                    <span className="ml-2 text-ink/60">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </span>
                  <form action={removeAction}>
                    <input type="hidden" name="event_id" value={eventId} />
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="attachment_id" value={file.id} />
                    <RemoveFileButton filename={file.filename} />
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={uploadAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="token" value={token} />
            <div className="grid gap-1.5">
              <Label htmlFor={`${baseId}-file`} className="text-ink">
                <span>Add a file</span>
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <input
                id={`${baseId}-file`}
                type="file"
                name="file"
                accept={UPLOAD_ACCEPT_ATTRIBUTE}
                aria-describedby={`${baseId}-file-help`}
                className="text-sm text-ink file:mr-3 file:h-11 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:text-sm file:text-ink"
              />
              <p id={`${baseId}-file-help`} className="text-sm text-ink/70">
                {UPLOAD_ACCEPT_ATTRIBUTE.replaceAll(".", "").replaceAll(",", ", ")} ·
                up to {Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB. Files stay
                private to White Rabbit and your team.
              </p>
            </div>
            <UploadButton />
          </form>
        </div>
      </Section>

      {/* --- Tech stack (VITAL) --- */}
      <Section
        id="stakeholder_tech_stack"
        title="Your technical stack"
        vital
        description="What you already run, and what you'd want to keep running. This becomes the 'build toward this' brief for participants."
      >
        <Field
          id={`${baseId}-tech-stack`}
          label="Describe your stack and preferences"
          required
          error={errorFor("stakeholderTechStack")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              rows={6}
              value={techStack}
              onChange={(e) => {
                setTechStack(e.target.value);
                touch();
              }}
              className="min-h-32"
            />
          )}
        </Field>
        <Field
          id={`${baseId}-tech-tags`}
          label="Key technologies"
          description="Comma-separated, e.g. Postgres, Django, Azure."
          error={errorFor("stakeholderTechTags")}
        >
          {(aria) => (
            <Input
              {...aria}
              type="text"
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                touch();
              }}
              className="h-11"
            />
          )}
        </Field>
      </Section>

      {/* --- Judges --- */}
      <Section
        id="judges"
        title="Judges"
        description="People who'll evaluate what gets built. We'll email them an invitation and a short background form — so we need this before invitations can go out."
      >
        <div className="flex flex-col gap-6">
          {judges.map((row, index) => (
            <RowCard
              key={row.key}
              legend={`Judge ${index + 1}`}
              removeId={`${baseId}-judge-${index}-remove`}
              removeLabel={`Remove judge ${index + 1}`}
              onRemove={() => {
                setJudges((rows) => rows.filter((r) => r.key !== row.key));
                setAnnouncement(`Judge ${index + 1} removed.`);
                touch();
              }}
            >
              <Field
                id={`${baseId}-judge-${index}-name`}
                label="Name"
                required
                error={errorFor(`judges.${index}.name`)}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    type="text"
                    value={row.name}
                    onChange={(e) => update(setJudges, row.key, "name", e.target.value)}
                    className="h-11"
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={`${baseId}-judge-${index}-email`}
                  label="Email"
                  required
                  className="min-w-0"
                  error={errorFor(`judges.${index}.email`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="email"
                      inputMode="email"
                      value={row.email}
                      onChange={(e) =>
                        update(setJudges, row.key, "email", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
                <Field
                  id={`${baseId}-judge-${index}-phone`}
                  label="Phone"
                  className="min-w-0"
                  description="E.164, e.g. +15415551234."
                  error={errorFor(`judges.${index}.phone`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="tel"
                      inputMode="tel"
                      value={row.phone}
                      onChange={(e) =>
                        update(setJudges, row.key, "phone", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
              </div>
            </RowCard>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 text-ink"
            disabled={judges.length >= MAX_JUDGES}
            onClick={() => {
              const index = judges.length;
              setJudges((rows) => [
                ...rows,
                { key: crypto.randomUUID(), name: "", email: "", phone: "" },
              ]);
              setAnnouncement(`Judge ${index + 1} added.`);
              scheduleFocus(`${baseId}-judge-${index}-name`);
              touch();
            }}
          >
            + Add a judge
          </Button>
        </div>
      </Section>

      {/* --- Criteria --- */}
      <Section
        id="evaluative_criteria"
        title="Evaluative criteria"
        description="What matters most when judging the work. Each becomes a 1–5 question on the judging form. Weights are relative — they don't have to add to 100."
      >
        <div className="flex flex-col gap-6">
          {criteria.map((row, index) => (
            <RowCard
              key={row.key}
              legend={`Criterion ${index + 1}`}
              removeId={`${baseId}-criterion-${index}-remove`}
              removeLabel={`Remove criterion ${index + 1}`}
              onRemove={() => {
                setCriteria((rows) => rows.filter((r) => r.key !== row.key));
                setAnnouncement(`Criterion ${index + 1} removed.`);
                touch();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                <Field
                  id={`${baseId}-criterion-${index}-label`}
                  label="Name"
                  required
                  className="min-w-0"
                  error={errorFor(`criteria.${index}.label`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="text"
                      value={row.label}
                      onChange={(e) =>
                        update(setCriteria, row.key, "label", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
                <Field
                  id={`${baseId}-criterion-${index}-weight`}
                  label="Weight"
                  className="min-w-0"
                  error={errorFor(`criteria.${index}.weight`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="text"
                      inputMode="decimal"
                      value={row.weight}
                      onChange={(e) =>
                        update(setCriteria, row.key, "weight", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
              </div>
              <Field
                id={`${baseId}-criterion-${index}-description`}
                label="What does a strong result look like?"
                error={errorFor(`criteria.${index}.description`)}
              >
                {(aria) => (
                  <Textarea
                    {...aria}
                    rows={3}
                    value={row.description}
                    onChange={(e) =>
                      update(setCriteria, row.key, "description", e.target.value)
                    }
                    className="min-h-20"
                  />
                )}
              </Field>
            </RowCard>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 text-ink"
            disabled={criteria.length >= MAX_CRITERIA}
            onClick={() => {
              const index = criteria.length;
              setCriteria((rows) => [
                ...rows,
                { key: crypto.randomUUID(), label: "", description: "", weight: "" },
              ]);
              setAnnouncement(`Criterion ${index + 1} added.`);
              scheduleFocus(`${baseId}-criterion-${index}-label`);
              touch();
            }}
          >
            + Add a criterion
          </Button>
        </div>
      </Section>

      {/* --- Awards budget --- */}
      <Section
        id="awards_budget"
        title="Awards budget"
        description="Anything you'd like to put toward prizes. Payment is arranged offline."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${baseId}-budget-amount`}
            label="Amount (USD)"
            className="min-w-0"
            error={errorFor("awardsBudget.amount")}
          >
            {(aria) => (
              <Input
                {...aria}
                type="text"
                inputMode="decimal"
                placeholder="1500"
                value={budgetAmount}
                onChange={(e) => {
                  setBudgetAmount(e.target.value);
                  touch();
                }}
                className="h-11"
              />
            )}
          </Field>
        </div>
        <Field
          id={`${baseId}-budget-note`}
          label="Anything to add?"
          error={errorFor("awardsBudget.note")}
        >
          {(aria) => (
            <Textarea
              {...aria}
              rows={3}
              value={budgetNote}
              onChange={(e) => {
                setBudgetNote(e.target.value);
                touch();
              }}
              className="min-h-20"
            />
          )}
        </Field>
      </Section>

      {/* --- Technical sponsors --- */}
      <Section
        id="technical_sponsors"
        title="Technical sponsors"
        description="Partners providing tools, credits, or API access for the weekend."
      >
        <p className="max-w-prose rounded-md border border-input bg-secondary/40 p-3 text-sm text-ink/80">
          Please describe what they&rsquo;re providing — never paste API keys,
          tokens, or passwords here. We&rsquo;ll collect credentials separately and
          they are never written into a repository.
        </p>
        <div className="flex flex-col gap-6">
          {sponsors.map((row, index) => (
            <RowCard
              key={row.key}
              legend={`Technical sponsor ${index + 1}`}
              removeId={`${baseId}-sponsor-${index}-remove`}
              removeLabel={`Remove technical sponsor ${index + 1}`}
              onRemove={() => {
                setSponsors((rows) => rows.filter((r) => r.key !== row.key));
                setAnnouncement(`Technical sponsor ${index + 1} removed.`);
                touch();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={`${baseId}-sponsor-${index}-name`}
                  label="Organization"
                  required
                  className="min-w-0"
                  error={errorFor(`techSponsors.${index}.name`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="text"
                      value={row.name}
                      onChange={(e) =>
                        update(setSponsors, row.key, "name", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
                <Field
                  id={`${baseId}-sponsor-${index}-status`}
                  label="Where things stand"
                  className="min-w-0"
                  error={errorFor(`techSponsors.${index}.status`)}
                >
                  {(aria) => (
                    <select
                      {...aria}
                      value={row.status}
                      onChange={(e) =>
                        update(setSponsors, row.key, "status", e.target.value)
                      }
                      className="h-11 rounded-md border border-input bg-transparent px-3 text-base text-ink"
                    >
                      {TECH_SPONSOR_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status[0].toUpperCase() + status.slice(1)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <Field
                id={`${baseId}-sponsor-${index}-offering`}
                label="What are they providing?"
                error={errorFor(`techSponsors.${index}.offering`)}
              >
                {(aria) => (
                  <Textarea
                    {...aria}
                    rows={2}
                    value={row.offering}
                    onChange={(e) =>
                      update(setSponsors, row.key, "offering", e.target.value)
                    }
                    className="min-h-16"
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={`${baseId}-sponsor-${index}-contact-name`}
                  label="Contact name"
                  className="min-w-0"
                  error={errorFor(`techSponsors.${index}.contactName`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="text"
                      value={row.contactName}
                      onChange={(e) =>
                        update(setSponsors, row.key, "contactName", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
                <Field
                  id={`${baseId}-sponsor-${index}-contact-email`}
                  label="Contact email"
                  className="min-w-0"
                  error={errorFor(`techSponsors.${index}.contactEmail`)}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="email"
                      inputMode="email"
                      value={row.contactEmail}
                      onChange={(e) =>
                        update(setSponsors, row.key, "contactEmail", e.target.value)
                      }
                      className="h-11"
                    />
                  )}
                </Field>
              </div>
            </RowCard>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            className="h-11 text-ink"
            disabled={sponsors.length >= MAX_TECH_SPONSORS}
            onClick={() => {
              const index = sponsors.length;
              setSponsors((rows) => [
                ...rows,
                {
                  key: crypto.randomUUID(),
                  name: "",
                  offering: "",
                  contactName: "",
                  contactEmail: "",
                  status: "proposed",
                },
              ]);
              setAnnouncement(`Technical sponsor ${index + 1} added.`);
              scheduleFocus(`${baseId}-sponsor-${index}-name`);
              touch();
            }}
          >
            + Add a technical sponsor
          </Button>
        </div>
      </Section>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
