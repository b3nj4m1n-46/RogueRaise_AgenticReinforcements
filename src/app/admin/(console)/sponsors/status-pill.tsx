import { cn } from "@/lib/utils";

/**
 * Shared presenters for the sponsor curation queue + detail views. Kept in one
 * module so the table, the mobile card list, and the detail header all render
 * status and financial values identically.
 */

/** The four `sponsor_app_status` values the admin UI reasons about. */
export type QueueStatus = "submitted" | "under_review" | "approved" | "rejected";

/**
 * Status → label + pill colours. Every pill is ALWAYS text-labelled (never
 * colour-only) and honours the globals.css contrast contract:
 *   - submitted → ink on `secondary` (#eceadf)     — ink ≈ 15:1
 *   - under review → muted-foreground on `muted`    — ≈ 5.15:1
 *   - approved → white on `primary` (#697939)       — ≈ 4.78:1
 *   - rejected → white on `destructive` (#b91c1c)   — ≈ 6.19:1
 * Never white text on the base olive (which is graphical-role only).
 */
export const STATUS_META: Record<QueueStatus, { label: string; pill: string }> = {
  submitted: {
    label: "Submitted",
    pill: "bg-secondary text-secondary-foreground",
  },
  under_review: {
    label: "Under review",
    pill: "bg-muted text-muted-foreground",
  },
  approved: {
    label: "Approved",
    pill: "bg-primary text-primary-foreground",
  },
  rejected: {
    label: "Rejected",
    pill: "bg-destructive text-destructive-foreground",
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: QueueStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        meta.pill,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * Financial commitment from the stored `numeric(12,2)` string.
 *   - `toDiscuss` → "To discuss"
 *   - `null`      → "—"
 *   - otherwise USD, dropping trailing `.00` for whole dollars.
 * Parsed with `Number` only for formatting — the string stays the source of
 * truth so no float precision is ever persisted.
 */
export function formatFinancial(
  amount: string | null,
  toDiscuss: boolean,
): string {
  if (toDiscuss) return "To discuss";
  if (amount === null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  // Whole dollars drop ".00"; any cents render as exactly two digits
  // (min 0 / max 2 would show "5000.50" as "$5,000.5").
  const whole = Number.isInteger(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Human date, e.g. "Jul 7, 2026". `null` → "—". */
export function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
