/**
 * Context-repo read model. Plain module (not `"use server"`) — see the note in
 * the other query modules: exports there become POST endpoints.
 */
import { eq } from "drizzle-orm";

import { db } from "../db";
import { contextRepos } from "../db/schema";

export interface ContextRepoView {
  id: string;
  githubRepoUrl: string;
  defaultBranch: string;
  isPublic: boolean;
  openPrUrl: string | null;
  createdAt: string;
}

export async function loadContextRepo(
  eventId: string,
): Promise<ContextRepoView | null> {
  const [row] = await db
    .select()
    .from(contextRepos)
    .where(eq(contextRepos.eventId, eventId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    githubRepoUrl: row.githubRepoUrl,
    defaultBranch: row.defaultBranch,
    isPublic: row.isPublic,
    openPrUrl: row.openPrUrl,
    createdAt: row.createdAt.toISOString(),
  };
}
