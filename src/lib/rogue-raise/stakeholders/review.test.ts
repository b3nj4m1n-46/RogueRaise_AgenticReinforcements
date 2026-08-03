/**
 * Stakeholder draft review, against a REAL local Postgres. Email is mocked.
 */
import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("../integrations/email", () => ({
  getEmailAdapter: () => ({ send: sendMock }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { db } from "../db";
import {
  auditLog,
  events,
  generatedAssets,
  magicLinkTokens,
  organizations,
  repoReviewComments,
  sponsorApplications,
  stakeholders,
} from "../db/schema";
import { generateMagicToken } from "../sponsors/magic-link";
import { redeemStakeholderReviewToken } from "./access";
import { sendReviewInvites } from "./invite";
import {
  loadReviewableAssets,
  loadStakeholderVerdicts,
  needsStakeholderReview,
} from "./review";
import { submitStakeholderReview } from "./review-actions";
import { initialReviewFormState } from "./review-state";

const createdOrgIds: string[] = [];

interface Fixture {
  eventId: string;
  stakeholderIds: string[];
  stakeholderNames: string[];
  researchAssetId: string;
  marketingAssetId: string;
  token: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Review Org ${suffix}` })
    .returning({ id: organizations.id });
  createdOrgIds.push(org.id);

  const [application] = await db
    .insert(sponsorApplications)
    .values({
      orgId: org.id,
      pocName: "Jamie Rivers",
      pocEmail: `poc-${suffix}@example.org`,
      pocPhone: "+15415551234",
      painPoints: "Shelter capacity data lives in spreadsheets.",
      goalsNeeds: "One view of beds tonight.",
      financialCommitmentToDiscuss: true,
      status: "approved",
    })
    .returning({ id: sponsorApplications.id });

  const [event] = await db
    .insert(events)
    .values({
      orgId: org.id,
      sponsorApplicationId: application.id,
      slug: `review-test-${suffix}`,
      title: `Rogue Raise ${suffix}`,
      status: "repo_review",
    })
    .returning({ id: events.id });

  const stakeholderRows = await db
    .insert(stakeholders)
    .values([
      { eventId: event.id, name: "Dana Steward", email: `dana-${suffix}@example.org` },
      { eventId: event.id, name: "Ray Director", email: `ray-${suffix}@example.org` },
    ])
    .returning({ id: stakeholders.id });

  // One stakeholder-reviewed type and one that is admin-only.
  const [research] = await db
    .insert(generatedAssets)
    .values({
      eventId: event.id,
      type: "research_doc",
      title: "What we understand",
      body: "# Research\n\nShelter data is fragmented across four systems.",
      version: 1,
      reviewStatus: "pending",
    })
    .returning({ id: generatedAssets.id });
  const [marketing] = await db
    .insert(generatedAssets)
    .values({
      eventId: event.id,
      type: "social_post",
      platform: "instagram",
      body: "Come build with us.",
      version: 1,
      reviewStatus: "pending",
    })
    .returning({ id: generatedAssets.id });

  const { raw, hash } = generateMagicToken();
  await db.insert(magicLinkTokens).values({
    eventId: event.id,
    role: "stakeholder",
    subjectId: stakeholderRows[0].id,
    email: `dana-${suffix}@example.org`,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  return {
    eventId: event.id,
    stakeholderIds: stakeholderRows.map((s) => s.id),
    stakeholderNames: ["Dana Steward", "Ray Director"],
    researchAssetId: research.id,
    marketingAssetId: marketing.id,
    token: raw,
  };
}

function reviewForm(
  fixture: Fixture,
  overrides: Record<string, string> = {},
): FormData {
  const data = new FormData();
  data.set("event_id", fixture.eventId);
  data.set("token", fixture.token);
  data.set("asset_id", fixture.researchAssetId);
  data.set("decision", "approve");
  data.set("body", "");
  for (const [k, v] of Object.entries(overrides)) data.set(k, v);
  return data;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ id: "msg" });
});

afterAll(async () => {
  if (createdOrgIds.length) {
    const eventIds = (
      await db
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.orgId, createdOrgIds))
    ).map((e) => e.id);
    if (eventIds.length) {
      await db
        .delete(repoReviewComments)
        .where(inArray(repoReviewComments.eventId, eventIds));
      await db
        .delete(generatedAssets)
        .where(inArray(generatedAssets.eventId, eventIds));
      await db.delete(stakeholders).where(inArray(stakeholders.eventId, eventIds));
      await db
        .delete(magicLinkTokens)
        .where(inArray(magicLinkTokens.eventId, eventIds));
      await db.delete(auditLog).where(inArray(auditLog.eventId, eventIds));
      await db.delete(events).where(inArray(events.id, eventIds));
    }
    await db
      .delete(sponsorApplications)
      .where(inArray(sponsorApplications.orgId, createdOrgIds));
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
  }
  await db.$client.end();
});

describe("needsStakeholderReview", () => {
  it("covers the context-research documents and nothing else", () => {
    for (const type of [
      "research_doc",
      "stakeholder_preferences",
      "example_prd",
      "setup_agent_instructions",
    ]) {
      expect(needsStakeholderReview(type)).toBe(true);
    }
    for (const type of ["social_post", "judge_email", "kickoff_deck", "faq"]) {
      expect(needsStakeholderReview(type)).toBe(false);
    }
  });
});

describe("loadReviewableAssets", () => {
  it("shows only the drafts stakeholders are asked to review", async () => {
    const fixture = await createFixture();
    const assets = await loadReviewableAssets(fixture.eventId, "Dana Steward");
    expect(assets.map((a) => a.type)).toEqual(["research_doc"]);
    // The marketing draft is admin-only and must not appear.
    expect(assets.some((a) => a.id === fixture.marketingAssetId)).toBe(false);
  });

  it("shows only the LATEST version of each document", async () => {
    const fixture = await createFixture();
    await db.insert(generatedAssets).values({
      eventId: fixture.eventId,
      type: "research_doc",
      body: "Second draft.",
      version: 2,
      reviewStatus: "pending",
    });

    const assets = await loadReviewableAssets(fixture.eventId, "Dana Steward");
    expect(assets).toHaveLength(1);
    expect(assets[0].version).toBe(2);
  });

  it("surfaces this stakeholder's own decision back to them", async () => {
    const fixture = await createFixture();
    await submitStakeholderReview(initialReviewFormState, reviewForm(fixture));

    const own = await loadReviewableAssets(fixture.eventId, "Dana Steward");
    expect(own[0].ownDecision).toBe("approve");

    const other = await loadReviewableAssets(fixture.eventId, "Ray Director");
    expect(other[0].ownDecision).toBeNull();
    // But they can see that a colleague weighed in.
    expect(other[0].comments).toHaveLength(1);
  });
});

describe("submitStakeholderReview", () => {
  it("records an approval with an audit row naming the person", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { body: "This matches what we told you." }),
    );
    expect(result.ok).toBe(true);

    const [comment] = await db
      .select()
      .from(repoReviewComments)
      .where(eq(repoReviewComments.eventId, fixture.eventId));
    expect(comment.assetId).toBe(fixture.researchAssetId);
    expect(comment.authorRole).toBe("stakeholder");
    expect(comment.authorLabel).toBe("Dana Steward");
    expect(comment.decision).toBe("approve");

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventId, fixture.eventId),
          eq(auditLog.action, "generated_asset.stakeholder_approve"),
        ),
      );
    expect(audit.actor).toBe(`stakeholder:${fixture.stakeholderIds[0]}`);
  });

  it("refuses 'needs changes' with no explanation", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "request_changes", body: "" }),
    );
    // A re-run needs something to work with — the same rule the admin gate
    // holds itself to.
    expect(result.ok).toBe(false);
    expect(result.formError).toContain("what needs changing");
  });

  it("accepts a plain comment with no decision", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "", body: "One thought about section 2." }),
    );
    expect(result.ok).toBe(true);

    const [comment] = await db
      .select()
      .from(repoReviewComments)
      .where(eq(repoReviewComments.eventId, fixture.eventId));
    expect(comment.decision).toBeNull();
  });

  it("refuses an empty submission entirely", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "", body: "" }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a draft that isn't part of the stakeholder review", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { asset_id: fixture.marketingAssetId }),
    );
    expect(result.ok).toBe(false);
    expect(result.formError).toContain("isn't part of your review");
  });

  it("refuses another event's draft", async () => {
    const [a, b] = await Promise.all([createFixture(), createFixture()]);
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(a, { asset_id: b.researchAssetId }),
    );
    // Scoped in the query, so it is simply not found.
    expect(result.ok).toBe(false);
    expect(result.formError).toContain("couldn't find that document");
  });

  it("refuses without a valid token", async () => {
    const fixture = await createFixture();
    const result = await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { token: "nope" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("loadStakeholderVerdicts", () => {
  it("reports the latest decision per person, not one per comment", async () => {
    const fixture = await createFixture();
    await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "request_changes", body: "Wrong department." }),
    );
    await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "approve", body: "Fixed, thanks." }),
    );

    const verdict = (await loadStakeholderVerdicts(fixture.eventId)).get(
      fixture.researchAssetId,
    );
    // Someone who changes their mind replaces their own earlier verdict.
    expect(verdict?.decisions).toHaveLength(1);
    expect(verdict?.approvals).toBe(1);
    expect(verdict?.changesRequested).toBe(0);
  });

  it("counts an outstanding request for changes", async () => {
    const fixture = await createFixture();
    await submitStakeholderReview(
      initialReviewFormState,
      reviewForm(fixture, { decision: "request_changes", body: "Not our data." }),
    );
    const verdict = (await loadStakeholderVerdicts(fixture.eventId)).get(
      fixture.researchAssetId,
    );
    expect(verdict?.changesRequested).toBe(1);
  });

  it("has nothing to report before anyone reviews", async () => {
    const fixture = await createFixture();
    expect((await loadStakeholderVerdicts(fixture.eventId)).size).toBe(0);
  });
});

describe("redeemStakeholderReviewToken", () => {
  it("works WITHOUT can_access_portal", async () => {
    const fixture = await createFixture();
    // Review happens months before the portal opens; requiring the portal flag
    // would make it impossible by construction.
    const rows = await db
      .select()
      .from(stakeholders)
      .where(eq(stakeholders.eventId, fixture.eventId));
    expect(rows.every((s) => !s.canAccessPortal)).toBe(true);

    const access = await redeemStakeholderReviewToken({
      rawToken: fixture.token,
      eventId: fixture.eventId,
    });
    expect(access.ok).toBe(true);
  });

  it("refuses a token from another event", async () => {
    const [a, b] = await Promise.all([createFixture(), createFixture()]);
    const access = await redeemStakeholderReviewToken({
      rawToken: b.token,
      eventId: a.eventId,
    });
    expect(access.ok).toBe(false);
  });
});

describe("sendReviewInvites", () => {
  it("emails each stakeholder once per round of drafts", async () => {
    const fixture = await createFixture();
    expect(await sendReviewInvites(fixture.eventId, "wr-admin")).toMatchObject({
      ok: true,
      sent: 2,
    });
    expect(await sendReviewInvites(fixture.eventId, "wr-admin")).toMatchObject({
      ok: true,
      sent: 0,
      skipped: 2,
    });

    // A re-run of the agent is a NEW round and legitimately re-asks.
    await db.insert(generatedAssets).values({
      eventId: fixture.eventId,
      type: "research_doc",
      body: "Second draft.",
      version: 2,
      reviewStatus: "pending",
    });
    expect(await sendReviewInvites(fixture.eventId, "wr-admin")).toMatchObject({
      ok: true,
      sent: 2,
    });
  });

  it("refuses when there is nothing drafted yet", async () => {
    const fixture = await createFixture();
    await db
      .delete(generatedAssets)
      .where(eq(generatedAssets.eventId, fixture.eventId));
    const outcome = await sendReviewInvites(fixture.eventId, "wr-admin");
    expect(outcome).toMatchObject({ ok: false });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("never puts a raw token in the audit log", async () => {
    const fixture = await createFixture();
    await sendReviewInvites(fixture.eventId, "wr-admin");
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventId, fixture.eventId));
    expect(JSON.stringify(rows)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
});
