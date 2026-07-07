/**
 * File/asset storage seam. Default provider is Vercel Blob (private by default;
 * only explicitly published assets are public — PRD §12).
 */
export interface PutBlobInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  access?: "private" | "public";
}

export interface PutBlobResult {
  url: string;
}

export interface BlobAdapter {
  put(input: PutBlobInput): Promise<PutBlobResult>;
}

const unconfiguredBlobAdapter: BlobAdapter = {
  async put() {
    throw new Error(
      "Blob adapter not configured (set BLOB_READ_WRITE_TOKEN and wire the Vercel Blob implementation).",
    );
  },
};

export function getBlobAdapter(): BlobAdapter {
  return unconfiguredBlobAdapter;
}
