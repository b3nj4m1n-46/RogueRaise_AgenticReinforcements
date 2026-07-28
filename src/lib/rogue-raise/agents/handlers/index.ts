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
import { kickoffDeckHandler } from "./kickoff-deck";
import {
  landingPageHandler,
  outreachHandler,
  socialMarketingHandler,
} from "./marketing";

let registered = false;

export function registerAgentHandlers(): void {
  if (registered) return;
  registered = true;
  registerAgentHandler("context_research_repo", contextResearchHandler);
  registerAgentHandler("judge_invitation_email", judgeInvitationHandler);
  registerAgentHandler("kickoff_deck", kickoffDeckHandler);
  registerAgentHandler("tech_sponsor_press_outreach", outreachHandler);
  registerAgentHandler("social_marketing", socialMarketingHandler);
  registerAgentHandler("landing_page_content", landingPageHandler);
  // M9: submission_categorizer
}
