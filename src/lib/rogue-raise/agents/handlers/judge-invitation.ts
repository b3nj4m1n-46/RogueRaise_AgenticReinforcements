/**
 * Judge invitation agent (PRD §5.3.3).
 *
 * Drafts one letter per judge in a single `judge_email` asset, marked up so the
 * send step can split it. Nothing is sent here — the draft goes through the same
 * review gate as every other agent output, and sending is a separate, explicit
 * admin action.
 */
import { loadAdminEvent } from "../../events/queries";
import { describeSchedule, formatWeekendLabel } from "../../intake/schedule";
import { listJudges } from "../../judges/queries";
import type { AgentHandler } from "../registry";
import { buildJudgeInvitationPrompt } from "./judge-invitation-prompts";

export const judgeInvitationHandler: AgentHandler = async (ctx) => {
  const detail = await loadAdminEvent(ctx.event.id);
  if (!detail) throw new Error("Event not found.");

  const judges = await listJudges(ctx.event.id);
  if (judges.length === 0) {
    throw new Error(
      "No judges have been named yet — the sponsor adds them in their intake form.",
    );
  }
  if (detail.criteria.length === 0) {
    // The letter's whole point is the criteria; drafting without them would
    // produce a letter that can't do its job.
    throw new Error(
      "No evaluative criteria yet — a judge invitation has to say what they'll be scoring against.",
    );
  }

  const { system, prompt } = buildJudgeInvitationPrompt({
    eventTitle: detail.title,
    organizationName: detail.organizationName,
    painPoints: detail.application?.painPoints ?? "",
    goalsNeeds: detail.application?.goalsNeeds ?? "",
    scheduleLines: detail.confirmedFridayKickoffAt
      ? describeSchedule(new Date(detail.confirmedFridayKickoffAt))
      : [],
    weekendLabel: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
    locationName: detail.locationName,
    locationAddress: detail.locationAddress,
    criteria: detail.criteria.map((c) => ({
      label: c.label,
      description: c.description,
      weight: c.weight,
    })),
    judges: judges.map((j) => ({ name: j.name, email: j.email })),
  });

  const steer = ctx.additionalInstructions
    ? `${system}\n\nADDITIONAL INSTRUCTIONS FROM WHITE RABBIT (follow these over the general guidance above):\n${ctx.additionalInstructions}`
    : system;

  ctx.log(`Drafting invitations for ${judges.length} judge(s).`);
  const result = await ctx.ai.generate({ system: steer, prompt, maxOutputTokens: 8000 });

  return {
    assets: [
      {
        type: "judge_email",
        title: `Judge invitations — ${detail.organizationName}`,
        body: result.text,
      },
    ],
    costTokens: result.usage.totalTokens,
    summary: `Drafted invitations for ${judges.length} judge(s).`,
  };
};
