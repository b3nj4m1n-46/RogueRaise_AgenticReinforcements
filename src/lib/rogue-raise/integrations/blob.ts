/**
 * File/asset storage seam. Default provider is Vercel Blob (private by default;
 * only explicitly published assets are ever public — PRD §12).
 *
 * Two providers:
 *   - **local** (`local:<key>` refs) — writes under `RR_LOCAL_BLOB_DIR` (default
 *     `.rr-blob/`, gitignored). Selected only when no Blob token is configured
 *     AND we are not in production, so a laptop can run the whole upload flow
 *     with zero credentials.
 *   - **vercel** — wired when `BLOB_READ_WRITE_TOKEN` is set. Not implemented
 *     yet (the first story that needs a deployed upload owns it); it fails loudly
 *     rather than silently degrading to local disk, which would lose files on
 *     every deploy.
 *
 * Callers never build storage paths themselves: `put` returns an opaque `ref`
 * that is what gets persisted (`attachments.blob_url`), and `get`/`del` take
 * that same ref back. Swapping providers is therefore a config change, not a
 * data migration — the portability rule from PRD §3.1.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PutBlobInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  access?: "private" | "public";
}

export interface PutBlobResult {
  /** Opaque reference to persist. Provider-specific; only this module parses it. */
  ref: string;
}

export interface GetBlobResult {
  body: Buffer;
}

export interface BlobAdapter {
  readonly provider: "local" | "vercel";
  put(input: PutBlobInput): Promise<PutBlobResult>;
  get(ref: string): Promise<GetBlobResult>;
  del(ref: string): Promise<void>;
}

const LOCAL_REF_PREFIX = "local:";

/** Keys are generated server-side, but never trust one blindly into a path. */
function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    !/^[A-Za-z0-9/._-]+$/.test(key)
  ) {
    throw new Error("Unsafe blob key");
  }
}

function localRoot(): string {
  return path.resolve(process.env.RR_LOCAL_BLOB_DIR ?? ".rr-blob");
}

function localPathForKey(key: string): string {
  assertSafeKey(key);
  const root = localRoot();
  const resolved = path.resolve(root, key);
  // Belt and braces: the resolved path must stay inside the root.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Unsafe blob key");
  }
  return resolved;
}

function keyFromRef(ref: string): string {
  if (!ref.startsWith(LOCAL_REF_PREFIX)) {
    throw new Error("Not a local blob reference");
  }
  return ref.slice(LOCAL_REF_PREFIX.length);
}

const localBlobAdapter: BlobAdapter = {
  provider: "local",
  async put({ key, body }) {
    const filePath = localPathForKey(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body as Parameters<typeof writeFile>[1]);
    return { ref: `${LOCAL_REF_PREFIX}${key}` };
  },
  async get(ref) {
    return { body: await readFile(localPathForKey(keyFromRef(ref))) };
  },
  async del(ref) {
    try {
      await unlink(localPathForKey(keyFromRef(ref)));
    } catch (err) {
      // Already gone is success — deletion must be idempotent so a retried
      // "remove attachment" never strands the database row.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  },
};

const VERCEL_REF_PREFIX = "vercel:";

/**
 * Vercel Blob.
 *
 * **Private by default** (PRD §12: "File uploads validated and stored private by
 * default; only explicitly published assets are public"). `access: "private"` is
 * the default here, and a caller has to ask for `"public"` explicitly — the
 * opposite of the SDK's own default, deliberately.
 *
 * The stored ref is `vercel:<url>` rather than the bare URL, so this module can
 * tell its own references apart from the local provider's and refuse to read one
 * written by the other. A row written on a laptop must not silently resolve
 * against production storage, or vice versa.
 *
 * ⚠️ This has never run against a real `BLOB_READ_WRITE_TOKEN`. It follows the
 * documented `@vercel/blob` API and is typechecked; smoke-test it the first time
 * the token exists. See HANDOFF.md.
 */
const vercelBlobAdapter: BlobAdapter = {
  provider: "vercel",

  async put(input) {
    assertSafeKey(input.key);
    const { put } = await import("@vercel/blob");
    // The SDK takes Buffer but not a bare Uint8Array; our contract allows both,
    // and `Buffer.from` on a Buffer is a no-op view rather than a copy.
    const body =
      typeof input.body === "string" ? input.body : Buffer.from(input.body);
    const result = await put(input.key, body, {
      access: input.access === "public" ? "public" : "private",
      contentType: input.contentType,
      // Keys are already unique and meaningful (event id + attachment id); a
      // random suffix would make a ref impossible to trace back to its row.
      addRandomSuffix: false,
    });
    return { ref: `${VERCEL_REF_PREFIX}${result.url}` };
  },

  async get(ref) {
    const url = parseVercelRef(ref);
    // `fetch` rather than the SDK's `get`: a private blob's URL is already
    // authorized by the token embedded in it, and this keeps the read path to
    // one round trip.
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${requireBlobToken()}` },
    });
    if (!response.ok) {
      throw new Error(`Blob read failed (${response.status}).`);
    }
    return { body: Buffer.from(await response.arrayBuffer()) };
  },

  async del(ref) {
    const url = parseVercelRef(ref);
    const { del } = await import("@vercel/blob");
    try {
      await del(url);
    } catch (err) {
      // Deleting something already gone is the desired end state, not a fault —
      // this runs when a sponsor removes an attachment, and failing there would
      // strand a row pointing at nothing.
      const message = err instanceof Error ? err.message : String(err);
      if (!/not\s*found/i.test(message)) throw err;
    }
  },
};

function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  return token;
}

function parseVercelRef(ref: string): string {
  if (!ref.startsWith(VERCEL_REF_PREFIX)) {
    // A local ref reaching the Vercel provider means the database and the
    // environment disagree about where files live. Say so rather than 404ing.
    throw new Error(
      "Not a Vercel blob reference — this row was written by a different storage provider.",
    );
  }
  return ref.slice(VERCEL_REF_PREFIX.length);
}

let adapter: BlobAdapter | undefined;

export function getBlobAdapter(): BlobAdapter {
  if (adapter) return adapter;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    adapter = vercelBlobAdapter;
  } else if (process.env.NODE_ENV === "production") {
    // Never silently write user uploads to an ephemeral production filesystem.
    throw new Error(
      "No Blob storage configured: set BLOB_READ_WRITE_TOKEN (production must not use the local disk provider).",
    );
  } else {
    adapter = localBlobAdapter;
  }
  return adapter;
}

/** Test seam — resets the memoized provider selection. */
export function resetBlobAdapter(): void {
  adapter = undefined;
}
