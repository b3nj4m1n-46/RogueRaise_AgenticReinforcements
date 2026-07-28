/**
 * Download a generated file asset (currently the kickoff deck).
 *
 * Behind the `/admin/*` middleware gate, scoped by event AND asset so an id
 * from another event can't be fetched under this URL. Served as a download with
 * `nosniff`, like every other file this platform hands out.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/rogue-raise/db";
import { generatedAssets } from "@/lib/rogue-raise/db/schema";
import { getBlobAdapter } from "@/lib/rogue-raise/integrations/blob";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const CONTENT_TYPES: Record<string, string> = {
  kickoff_deck:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXTENSIONS: Record<string, string> = { kickoff_deck: "pptx" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id: eventId, assetId } = await context.params;
  if (
    !z.uuid().safeParse(eventId).success ||
    !z.uuid().safeParse(assetId).success
  ) {
    return notFound();
  }

  const [asset] = await db
    .select({
      type: generatedAssets.type,
      blobUrl: generatedAssets.blobUrl,
      version: generatedAssets.version,
    })
    .from(generatedAssets)
    .where(
      and(eq(generatedAssets.id, assetId), eq(generatedAssets.eventId, eventId)),
    )
    .limit(1);
  if (!asset?.blobUrl) return notFound();

  let body: Buffer;
  try {
    ({ body } = await getBlobAdapter().get(asset.blobUrl));
  } catch (err) {
    console.error("[admin] asset download failed", err);
    return notFound();
  }

  const extension = EXTENSIONS[asset.type] ?? "bin";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": CONTENT_TYPES[asset.type] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${asset.type}-v${asset.version}.${extension}"`,
      "content-length": String(body.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
