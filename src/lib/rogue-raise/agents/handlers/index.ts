/**
 * Handler registration. Importing this module registers every implemented
 * agent; anything in the catalog without a registration here reports "isn't
 * implemented yet" rather than failing obscurely.
 *
 * Import it for its side effect from anything that runs agents (the admin
 * actions do), and add one line per agent as the remaining catalog entries land.
 */
import { registerAgentHandler } from "../registry";
import { contextResearchHandler } from "./context-research";
import { judgeInvitationHandler } from "./judge-invitation";

let registered = false;

export function registerAgentHandlers(): void {
  if (registered) return;
  registered = true;
  registerAgentHandler("context_research_repo", contextResearchHandler);
  registerAgentHandler("judge_invitation_email", judgeInvitationHandler);
  // M5: kickoff_deck
  // M6: tech_sponsor_press_outreach, social_marketing, landing_page_content
  // M9: submission_categorizer
}
