import {
  inputData,
  TEAM_NAME,
  INCLUDE_DEVIN,
  DEVIN_LOGIN,
  GitHubPullRequest,
  PRStatus,
  CODEOWNER_RULES,
  initializeCodeowners,
  fetchOrgMembers,
  fetchPullRequests,
  fetchPRFiles,
  getCodeOwnerTeams,
  calculateMetrics,
  formatAuthorName,
  enhancePRWithMetrics,
  formatPRLine,
  groupAndSortPRs,
} from "./common";

// Get team members from environment variables
const TEAM_MEMBERS: string[] =
  inputData.TEAM_MEMBERS?.split(",").map((username) => username.trim()) || [];

if (TEAM_MEMBERS.length === 0) {
  console.error("No team members specified in .env file");
  process.exit(1);
}

// Function to fetch community PRs (excluding team members and org members)
const fetchCommunityPRs = async (): Promise<GitHubPullRequest[]> => {
  try {
    // Fetch org members first
    const orgMembers = await fetchOrgMembers();

    // Combine team members and org members for exclusion
    const excludedUsers = [
      ...new Set([...TEAM_MEMBERS, DEVIN_LOGIN, ...orgMembers]),
    ];

    // Build the search query excluding all team and org members
    const excludeAuthors = excludedUsers
      .map((user) => `-author:${user}`)
      .join("+");
    const searchQuery = `is:pr+is:open+repo:calcom/cal.com+${excludeAuthors}`;

    const url = `https://api.github.com/search/issues?q=${searchQuery}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `token ${inputData.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching community PRs: ${response.statusText}`);
    }

    const searchResults = (await response.json()) as {
      items: GitHubPullRequest[];
    };

    // Filter PRs that have code owners matching the team
    const communityPRsWithTeamCodeOwners: GitHubPullRequest[] = [];

    for (const pr of searchResults.items) {
      // Get detailed PR info and files
      const prDetailUrl = `https://api.github.com/repos/calcom/cal.com/pulls/${pr.number}`;
      const prDetailResponse = await fetch(prDetailUrl, {
        headers: {
          Authorization: `token ${inputData.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (prDetailResponse.ok) {
        const prDetail = (await prDetailResponse.json()) as GitHubPullRequest;

        // Fetch PR files to check code owners
        const files = await fetchPRFiles(pr.number);
        const codeOwnerTeams = getCodeOwnerTeams(files, CODEOWNER_RULES);

        // Check if any code owner team matches our team name (case insensitive)
        const hasTeamAsCodeOwner = codeOwnerTeams.some(
          (team) => team.toLowerCase() === TEAM_NAME.toLowerCase()
        );

        if (hasTeamAsCodeOwner) {
          // Mark as community PR and add files info
          prDetail.isCommunityPR = true;
          prDetail.files = files;
          prDetail.codeOwnerTeams = codeOwnerTeams;
          communityPRsWithTeamCodeOwners.push(prDetail);
        }
      }
    }

    return communityPRsWithTeamCodeOwners;
  } catch (error) {
    console.error("Error fetching community PRs:", error);
    return [];
  }
};

const PR_STATUS: Record<string, PRStatus> = {
  NEEDS_REVIEW: { priority: 0, label: "👀 Needs review" },
  CHANGES_REQUESTED: { priority: 1, label: "🔄 Changes requested" },
  APPROVED: { priority: 2, label: "✅ Approved" },
  COMMUNITY_PR: { priority: 3, label: "🌍 Community PRs" },
};

const getPRStatus = (pr: GitHubPullRequest): PRStatus => {
  // Check if it's a community PR first
  if (pr.isCommunityPR) return PR_STATUS.COMMUNITY_PR;

  if (pr.hasChangesRequested) return PR_STATUS.CHANGES_REQUESTED;
  if (pr.isApproved) return PR_STATUS.APPROVED;
  return PR_STATUS.NEEDS_REVIEW;
};

const printPullRequests = async (
  pullRequests: GitHubPullRequest[]
): Promise<string> => {
  let output = "";

  if (pullRequests.length === 0) {
    return "No open pull requests found.";
  }

  output += `📊 *Open Pull Requests for ${TEAM_NAME} Team*\n\n`;

  // Process all PRs in parallel
  const prsWithMetrics = await Promise.all(
    pullRequests.map(async (pr) => {
      const metrics = await calculateMetrics(pr);
      return { ...pr, ...metrics };
    })
  );

  // Group PRs by status using utility function
  const groupedPRs = groupAndSortPRs(prsWithMetrics, PR_STATUS, getPRStatus);

  // Print each group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    output += `*${statusLabel}* (${prs.length})\n`;
    prs.forEach((pr) => {
      const additionalInfo =
        pr.isCommunityPR && pr.codeOwnerTeams
          ? ` → ${pr.codeOwnerTeams.join("🛡️ or ")}🛡️`
          : "";
      output += formatPRLine(pr, additionalInfo) + "\n";
    });
    output += "\n";
  });

  return output;
};

const main = async (): Promise<string> => {
  try {
    // Initialize CODEOWNERS first
    await initializeCodeowners();

    const teamPRs = await fetchPullRequests();

    // Filter PRs with the team conditions:
    // 1. PRs from team members (not in draft)
    // 2. OR PRs from Devin (if enabled) where at least one assignee is a team member
    const filteredTeamPRs = teamPRs.filter((pr) => {
      // Skip draft PRs
      if (pr.draft) return false;

      // If PR is from a team member, include it
      if (TEAM_MEMBERS.includes(pr.user.login)) return true;

      // If Devin is included and PR is from Devin, check assignees
      if (INCLUDE_DEVIN && pr.user.login === DEVIN_LOGIN) {
        // Check if any assignee is a team member
        return pr.assignees.some((assignee) =>
          TEAM_MEMBERS.includes(assignee.login)
        );
      }

      return false;
    });

    const communityPRs = await fetchCommunityPRs();

    // Combine both team PRs and community PRs
    const allPRs = [...filteredTeamPRs, ...communityPRs];

    const output = await printPullRequests(allPRs);

    return output;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error: ${errorMessage}`;
  }
};

const output = await main();
console.log(output);
