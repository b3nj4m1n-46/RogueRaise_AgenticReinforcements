import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { listAssets, loadAsset } from "@/lib/rogue-raise/agents/queries";
import { loadAdminEvent } from "@/lib/rogue-raise/events/queries";
import {
  loadStakeholderVerdicts,
  needsStakeholderReview,
} from "@/lib/rogue-raise/stakeholders/review";

import { AssetReview } from "./asset-review";

export const metadata = { title: "Draft · Rogue Raise" };
export const dynamic = "force-dynamic";

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  edit_requested: "Edits requested",
  rejected: "Rejected",
};

function assetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default async function AdminAssetPage({
  params,
}: {
  params: Promise<{ id: string; assetId: string }>;
}) {
  const { id, assetId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(assetId).success) {
    notFound();
  }

  const [event, asset] = await Promise.all([loadAdminEvent(id), loadAsset(assetId)]);
  if (!event || !asset) notFound();

  // An asset id from another event must not render under this event's URL.
  const siblings = await listAssets(id);
  if (!siblings.some((a) => a.id === asset.id)) notFound();

  // Same key as the version counter: (type, platform).
  const sameType = siblings.filter(
    (a) => a.type === asset.type && a.platform === asset.platform,
  );
  const isLatest = sameType[0]?.id === asset.id;
  const others = sameType.filter((a) => a.id !== asset.id);

  // PRD §11.2 names stakeholders in this agent's review gate. Their verdict
  // doesn't gate the button — a busy stakeholder must not be able to stall an
  // event — but approving over an outstanding "needs changes" should be a
  // deliberate act, so it is stated here rather than left to be discovered.
  const stakeholderReviewed = needsStakeholderReview(asset.type);
  const verdict = stakeholderReviewed
    ? (await loadStakeholderVerdicts(id)).get(asset.id)
    : undefined;

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href={`/admin/events/${id}/agents`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          ← Agents for {event.organizationName}
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {assetTypeLabel(asset.type)}
        </p>
        <h1 className="font-serif text-3xl font-semibold text-ink sm:text-4xl">
          {asset.title ?? assetTypeLabel(asset.type)}
        </h1>
        <p className="text-sm text-ink/70">
          Version {asset.version} ·{" "}
          {REVIEW_STATUS_LABELS[asset.reviewStatus] ?? asset.reviewStatus} ·{" "}
          {asset.agentRunId === null
            ? "written by a person"
            : "drafted by an agent"}
          {isLatest ? "" : " · superseded"}
        </p>
        {asset.reviewNote ? (
          <p className="max-w-prose whitespace-pre-wrap rounded-md border border-input bg-muted/40 p-3 text-sm text-ink/80">
            {asset.reviewNote}
          </p>
        ) : null}
      </header>

      {stakeholderReviewed ? (
        <section
          aria-labelledby="stakeholder-review"
          className={
            verdict && verdict.changesRequested > 0
              ? "flex flex-col gap-3 rounded-lg border-2 border-ink bg-muted/60 p-5"
              : "flex flex-col gap-3 rounded-lg border border-wr-olive-green/25 p-5"
          }
        >
          <h2
            id="stakeholder-review"
            className="font-serif text-xl font-semibold text-ink"
          >
            What the stakeholders said
          </h2>
          {!verdict || verdict.decisions.length === 0 ? (
            <p className="max-w-prose text-ink/80">
              Nobody outside White Rabbit has looked at this yet. This document
              describes the sponsor&rsquo;s own problem back to them and then goes
              to every volunteer — send the review link from the agents page
              before approving, unless there&rsquo;s a reason not to.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {verdict.decisions.map((entry) => (
                  <li
                    key={`${entry.label}-${entry.at}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  >
                    <span className="font-medium text-ink">
                      {entry.label ?? "A stakeholder"}
                    </span>
                    <span
                      className={
                        entry.decision === "approve"
                          ? "text-ink/70"
                          : "font-medium text-ink"
                      }
                    >
                      {entry.decision === "approve"
                        ? "said it looks right"
                        : "asked for changes"}
                    </span>
                  </li>
                ))}
              </ul>
              {verdict.changesRequested > 0 ? (
                <p className="max-w-prose font-medium text-ink">
                  Someone has asked for changes. Read their comments on the
                  review page before approving this — or re-run the agent with
                  their feedback.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <AssetReview
        assetId={asset.id}
        title={asset.title ?? ""}
        body={asset.body ?? ""}
        reviewStatus={asset.reviewStatus}
        isLatest={isLatest}
      />

      <section aria-labelledby="content" className="flex flex-col gap-3">
        <h2 id="content" className="font-serif text-2xl font-semibold text-wr-olive-green">
          The draft
        </h2>
        {asset.body ? (
          <div className="overflow-x-auto rounded-lg border border-input bg-background p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm text-ink">
              {asset.body}
            </pre>
          </div>
        ) : null}

        {asset.blobUrl ? (
          <p className="text-sm">
            <a
              href={`/admin/events/${id}/assets/${asset.id}/download`}
              className="font-medium text-ink underline underline-offset-4"
            >
              Download the file →
            </a>{" "}
            <span className="text-ink/60">
              Re-run the agent to regenerate it.
            </span>
          </p>
        ) : null}

        {!asset.body && !asset.blobUrl ? (
          <p className="text-ink/60">This asset has no content.</p>
        ) : null}
      </section>

      {others.length > 0 ? (
        <section aria-labelledby="versions" className="flex flex-col gap-3">
          <h2
            id="versions"
            className="font-serif text-2xl font-semibold text-wr-olive-green"
          >
            Other versions
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {others.map((other) => (
              <li key={other.id}>
                <Link
                  href={`/admin/events/${id}/assets/${other.id}`}
                  className="font-medium text-ink underline underline-offset-4"
                >
                  Version {other.version}
                </Link>
                <span className="ml-2 text-ink/60">
                  {REVIEW_STATUS_LABELS[other.reviewStatus] ?? other.reviewStatus}
                  {other.agentRunId === null ? " · edited by a person" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
