/**
 * Admin download for an intake attachment.
 *
 * The sponsor-facing route is magic-link gated; staff have no such token, so
 * this parallel route sits behind the `/admin/*` middleware gate instead. It is
 * otherwise identical: scoped by event AND kind, served as a download with
 * `nosniff`, never inline.
 *
 * When real admin auth lands, this route inherits it automatically — the gate is
 * the middleware, not anything written here.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { checkAdmin } from "@/lib/rogue-raise/admin/guard";
import { db } from "@/lib/rogue-raise/db";
import { attachments } from "@/lib/rogue-raise/db/schema";
import { INTAKE_ATTACHMENT_KIND } from "@/lib/rogue-raise/intake/constants";
import { getBlobAdapter } from "@/lib/rogue-raise/integrations/blob";

export const dynamic = "force-dynamic";

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  // Route handlers do NOT render layouts, so the console's layout guard
  // never runs here. Without this check the only protection would be the
  // middleware's cookie-presence test — and this serves a private file.
  // A 404 rather than a 403: an unauthorized caller learns nothing about
  // whether the file exists.
  if (!(await checkAdmin()).ok) return notFound();

  const { id: eventId, attachmentId } = await context.params;
  if (
    !z.uuid().safeParse(eventId).success ||
    !z.uuid().safeParse(attachmentId).success
  ) {
    return notFound();
  }

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
    console.error("[admin] attachment read failed", err);
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
