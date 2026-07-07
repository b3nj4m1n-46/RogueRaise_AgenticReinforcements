/**
 * GitHub seam. A GitHub App (not a PAT) creates repos in the WR org, pushes
 * commits, and opens PRs for the context-repo agent, and reads LOC/category stats
 * (PRD §3 / §5.3.1 / §8). Secrets are never committed to generated repos.
 */
export interface CreateRepoInput {
  name: string;
  description?: string;
  isPrivate: boolean;
}

export interface GithubRepoRef {
  url: string;
  defaultBranch: string;
}

export interface GithubAdapter {
  createRepo(input: CreateRepoInput): Promise<GithubRepoRef>;
}

const unconfiguredGithubAdapter: GithubAdapter = {
  async createRepo() {
    throw new Error(
      "GitHub adapter not configured (set RR_GITHUB_* app credentials and RR_GITHUB_ORG).",
    );
  },
};

export function getGithubAdapter(): GithubAdapter {
  return unconfiguredGithubAdapter;
}
