import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Field — a hand-written label + control + help/error wrapper (we intentionally
 * do NOT use shadcn's react-hook-form `Field`, which conflicts with server
 * actions). It owns the a11y wiring so callers can't forget it:
 *
 *   - `<label htmlFor>` bound to the control `id`
 *   - a visible "(required)" marker (never color/`*`-only)
 *   - `aria-describedby` stitched from the description + error message ids
 *   - `aria-invalid` when an error is present
 *
 * The control is a render-prop child so the aria props land on the real element
 * (input/textarea/etc.) with full type-safety and no `cloneElement` guesswork.
 */
export interface FieldControlAria {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

export interface FieldProps {
  /** Stable id — used for the control, `htmlFor`, and error-summary anchors. */
  id: string;
  label: React.ReactNode;
  required?: boolean;
  /** Static helper text rendered above the control's errors. */
  description?: React.ReactNode;
  /** First error message for this field (server or client). */
  error?: string;
  className?: string;
  children: (aria: FieldControlAria) => React.ReactNode;
}

export function Field({
  id,
  label,
  required = false,
  description,
  error,
  className,
  children,
}: FieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="text-ink">
        <span>{label}</span>
        {required ? (
          <span className="font-normal text-muted-foreground">(required)</span>
        ) : (
          <span className="font-normal text-muted-foreground">(optional)</span>
        )}
      </Label>

      {description ? (
        <p id={descriptionId} className="text-sm text-ink/70">
          {description}
        </p>
      ) : null}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
