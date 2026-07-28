/**
 * Private download for an intake attachment.
 *
 * Files are stored privately (PRD §12) — there is no public Blob URL to hand
 * out, so every read comes through here and is gated on the same magic-link
 * redemption the form itself uses. The attachment is looked up by id AND event
 * AND kind, so a valid token for one event can never fetch another's file.
 *
 * Uploaded bytes are treated as hostile: served as a download, never inline,
 * with `nosniff` so a browser can't be talked into rendering one as HTML on our
 * own origin.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/rogue-raise/db";
import { attachments } from "@/lib/rogue-raise/db/schema";
import { redeemIntakeToken } from "@/lib/rogue-raise/intake/access";
import { INTAKE_ATTACHMENT_KIND } from "@/lib/rogue-raise/intake/constants";
import { getBlobAdapter } from "@/lib/rogue-raise/integrations/blob";

export const dynamic = "force-dynamic";

/** Everything that isn't a successful, authorized fetch looks identical. */
function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** RFC 5987 filename, with a plain-ASCII fallback for older clients. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string; attachmentId: string }> },
) {
  const { eventId, attachmentId } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? "";

  // A malformed id must 404, not reach Postgres and throw on a uuid cast.
  if (!z.uuid().safeParse(attachmentId).success) return notFound();

  const access = await redeemIntakeToken({ eventId, rawToken: token });
  if (!access.ok) return notFound();

  const [row] = await db
    .select({
      blobUrl: attachments.blobUrl,
      filename: attachments.filename,
      contentType: attachments.contentType,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.eventId, eventId),
        eq(attachments.kind, INTAKE_ATTACHMENT_KIND),
      ),
    )
    .limit(1);
  if (!row) return notFound();

  let body: Buffer;
  try {
    ({ body } = await getBlobAdapter().get(row.blobUrl));
  } catch (err) {
    console.error("[intake] attachment read failed", err);
    return notFound();
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": row.contentType ?? "application/octet-stream",
      "content-disposition": contentDisposition(row.filename ?? "attachment"),
      "content-length": String(body.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
