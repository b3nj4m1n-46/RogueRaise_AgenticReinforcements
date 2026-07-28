"use client";

/**
 * Moves focus to a result region after a server action settles.
 *
 * Two things make this necessary, and they compound:
 *
 *   1. React calls `form.reset()` once an action settles, which desyncs
 *      controlled inputs (see CLAUDE.md). The fix is to remount the form with
 *      `key={version}` — but a remount destroys the focused element, dropping
 *      focus to `<body>`.
 *   2. An error rendered above the form is silent to a screen reader and
 *      invisible to someone zoomed in past it.
 *
 * Focusing the result region solves both: focus lands somewhere meaningful
 * instead of the document start, and the message is read because focus moved
 * to it — which is more reliable than a live region that was mounted already
 * populated.
 *
 * The region must be focusable (`tabIndex={-1}`) and OUTSIDE any keyed subtree,
 * or it is torn down along with the form before this runs.
 */
import { useEffect, useRef, type RefObject } from "react";

export function useActionFocus<T extends HTMLElement>(
  version: number | undefined,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const lastVersion = useRef(version);

  useEffect(() => {
    // Only on a NEW result — not on mount, and not on unrelated re-renders.
    if (version === undefined || version === lastVersion.current) return;
    lastVersion.current = version;
    ref.current?.focus();
  }, [version]);

  return ref;
}
