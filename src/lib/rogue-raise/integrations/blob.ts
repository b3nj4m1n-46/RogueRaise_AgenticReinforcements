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

const unwiredVercelBlobAdapter: BlobAdapter = {
  provider: "vercel",
  async put() {
    throw new Error(
      "Vercel Blob provider is not wired yet (BLOB_READ_WRITE_TOKEN is set). Install @vercel/blob and implement the provider in lib/rogue-raise/integrations/blob.ts — see HANDOFF.md.",
    );
  },
  async get() {
    throw new Error("Vercel Blob provider is not wired yet.");
  },
  async del() {
    throw new Error("Vercel Blob provider is not wired yet.");
  },
};

let adapter: BlobAdapter | undefined;

export function getBlobAdapter(): BlobAdapter {
  if (adapter) return adapter;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    adapter = unwiredVercelBlobAdapter;
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
