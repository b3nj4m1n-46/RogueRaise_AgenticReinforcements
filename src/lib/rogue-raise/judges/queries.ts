/**
 * Judge read model. Plain module — not `"use server"`, whose exports become
 * POST endpoints.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "../db";
import { judges } from "../db/schema";

export interface JudgeView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  bio: string | null;
  expertiseTags: string[];
  introPreference: string | null;
  criteriaQuestions: string | null;
  headshotBlobUrl: string | null;
  backgroundCompletedAt: string | null;
}

export async function listJudges(eventId: string): Promise<JudgeView[]> {
  const rows = await db
    .select()
    .from(judges)
    .where(eq(judges.eventId, eventId))
    .orderBy(asc(judges.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    title: row.title,
    bio: row.bio,
    expertiseTags: row.expertiseTags ?? [],
    introPreference: row.introPreference,
    criteriaQuestions: row.criteriaQuestions,
    headshotBlobUrl: row.headshotBlobUrl,
    backgroundCompletedAt: row.backgroundCompletedAt?.toISOString() ?? null,
  }));
}
