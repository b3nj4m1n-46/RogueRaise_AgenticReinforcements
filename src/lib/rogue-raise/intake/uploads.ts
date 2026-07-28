/**
 * Upload validation for intake supporting documents (PRD §5.2.2: "Files → Blob…
 * virus/type-validated, size-limited").
 *
 * Three independent checks must AGREE before a byte is stored:
 *   1. the file extension is on the allowlist,
 *   2. the browser-declared MIME type is compatible with that extension
 *      (an absent or generic `application/octet-stream` is tolerated — browsers
 *      routinely send it — but a *contradictory* type is rejected),
 *   3. the actual leading bytes match the extension's signature. Plain-text
 *      formats have no signature, so they are checked for binary content instead.
 *
 * Content sniffing is what makes the first two checks meaningful: renaming
 * `payload.exe` to `notes.pdf` fails at step 3.
 *
 * MALWARE SCANNING is deliberately NOT implemented here. There is no scanner in
 * the stack yet; pretending otherwise would be worse than saying so. `scanUpload`
 * below is the single seam a real scanner (ClamAV sidecar, a hosted API) hooks
 * into, and the storage path already assumes files are untrusted: they are stored
 * privately, never executed, never served from our own origin as HTML, and always
 * downloaded with `Content-Disposition: attachment` + `nosniff`.
 */
import { randomUUID } from "node:crypto";

/** 10 MB per file — comfortably fits a spreadsheet or a scanned report. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Per-event ceiling; keeps one intake from becoming a file dump. */
export const MAX_ATTACHMENTS_PER_EVENT = 20;

interface AllowedType {
  /** Canonical content type we store and serve back. */
  contentType: string;
  /** MIME types a browser might plausibly declare for this extension. */
  acceptedMimes: string[];
  /** Leading-byte signatures; `null` means "text-like, sniff for binary instead". */
  signatures: number[][] | null;
}

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06], // empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned archive
];

const ALLOWED_TYPES: Record<string, AllowedType> = {
  pdf: {
    contentType: "application/pdf",
    acceptedMimes: ["application/pdf"],
    signatures: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  png: {
    contentType: "image/png",
    acceptedMimes: ["image/png"],
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  jpg: {
    contentType: "image/jpeg",
    acceptedMimes: ["image/jpeg", "image/jpg"],
    signatures: [[0xff, 0xd8, 0xff]],
  },
  jpeg: {
    contentType: "image/jpeg",
    acceptedMimes: ["image/jpeg", "image/jpg"],
    signatures: [[0xff, 0xd8, 0xff]],
  },
  docx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    acceptedMimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    signatures: ZIP_SIGNATURES,
  },
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    acceptedMimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    signatures: ZIP_SIGNATURES,
  },
  csv: {
    contentType: "text/csv",
    acceptedMimes: ["text/csv", "text/plain", "application/csv"],
    signatures: null,
  },
  txt: {
    contentType: "text/plain",
    acceptedMimes: ["text/plain"],
    signatures: null,
  },
  md: {
    contentType: "text/markdown",
    acceptedMimes: ["text/markdown", "text/plain", "text/x-markdown"],
    signatures: null,
  },
  json: {
    contentType: "application/json",
    acceptedMimes: ["application/json", "text/plain", "text/json"],
    signatures: null,
  },
};

/** Generic types a browser sends when it simply doesn't know. Never conclusive. */
const UNKNOWN_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

/** Comma-separated list for the file input's `accept` attribute. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export type UploadRejection =
  | "empty"
  | "too_large"
  | "too_many"
  | "bad_extension"
  | "mime_mismatch"
  | "content_mismatch";

export interface UploadValidationResult {
  ok: boolean;
  reason?: UploadRejection;
  /** User-facing message; safe to render verbatim. */
  message?: string;
  /** Canonical content type to store when `ok`. */
  contentType?: string;
  extension?: string;
}

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Strip any path components a browser may include; keep it renderable. */
export function safeDisplayFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").trim();
  // Strip control characters, which would mangle a Content-Disposition header.
  const printable = Array.from(base).filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f;
  });
  return printable.join("").slice(0, 255) || "attachment";
}

function startsWithSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((b, i) => bytes[i] === b);
}

/** Text formats: reject NUL bytes / non-UTF-8, which mean it isn't really text. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

export function validateUpload(input: {
  filename: string;
  declaredContentType: string;
  size: number;
  bytes: Uint8Array;
  existingCount: number;
}): UploadValidationResult {
  if (input.existingCount >= MAX_ATTACHMENTS_PER_EVENT) {
    return {
      ok: false,
      reason: "too_many",
      message: `You can attach up to ${MAX_ATTACHMENTS_PER_EVENT} files. Remove one to add another.`,
    };
  }
  if (input.size <= 0 || input.bytes.length === 0) {
    return { ok: false, reason: "empty", message: "That file is empty." };
  }
  if (input.size > MAX_UPLOAD_BYTES || input.bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: `Files must be under ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const extension = extensionOf(input.filename);
  const allowed = ALLOWED_TYPES[extension];
  if (!allowed) {
    return {
      ok: false,
      reason: "bad_extension",
      message: `We accept ${ALLOWED_EXTENSIONS.join(", ")} files.`,
    };
  }

  const declared = input.declaredContentType.split(";")[0].trim().toLowerCase();
  if (!UNKNOWN_MIMES.has(declared) && !allowed.acceptedMimes.includes(declared)) {
    return {
      ok: false,
      reason: "mime_mismatch",
      message: "That file's type doesn't match its extension.",
    };
  }

  const contentOk = allowed.signatures
    ? allowed.signatures.some((sig) => startsWithSignature(input.bytes, sig))
    : looksLikeText(input.bytes);
  if (!contentOk) {
    return {
      ok: false,
      reason: "content_mismatch",
      message: `That file doesn't look like a real .${extension} file.`,
    };
  }

  return { ok: true, contentType: allowed.contentType, extension };
}

/**
 * Storage key. The user's filename NEVER appears in the path (it is kept in
 * `attachments.filename` for display); the key is a random UUID under the event,
 * so keys are unguessable and collision-free.
 */
export function buildAttachmentKey(eventId: string, extension: string): string {
  return `intake/${eventId}/${randomUUID()}.${extension}`;
}

/**
 * Malware-scanning seam. Returns `clean` today because nothing is wired — this
 * is the ONE place a scanner gets added, and callers already treat the answer as
 * authoritative, so wiring it later requires no changes at the call sites.
 */
export async function scanUpload(bytes: Uint8Array): Promise<{ clean: boolean }> {
  void bytes; // Nothing inspects the bytes yet — see the module header.
  return { clean: true };
}
