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
  fetchCommunityPRsBySearch,
} from "./common";

// Get team members from environment variables
const TEAM_MEMBERS: string[] =
  inputData.TEAM_MEMBERS?.split(",").map((username) => username.trim()) || [];

if (TEAM_MEMBERS.length === 0) {
  console.error("No team members specified in .env file");
  process.exit(1);
}

// Performance configuration constants
const COMMUNITY_PR_CONCURRENCY_LIMIT = 10;
const METRICS_CONCURRENCY_LIMIT = 15;

// Optimized function to fetch community PRs with parallel processing
const fetchCommunityPRs = async (): Promise<GitHubPullRequest[]> => {
  try {
    // Use the common utility function to fetch community PRs
    const allSearchResults = await fetchCommunityPRsBySearch({});

    // Process PRs in parallel with concurrency limit
    const concurrencyLimit = COMMUNITY_PR_CONCURRENCY_LIMIT;
    const communityPRsWithTeamCodeOwners: GitHubPullRequest[] = [];

    // Process PRs in batches to avoid overwhelming the API
    for (let i = 0; i < allSearchResults.length; i += concurrencyLimit) {
      const batch = allSearchResults.slice(i, i + concurrencyLimit);

      const batchResults = await Promise.allSettled(
        batch.map(async (pr) => {
          try {
            // Only fetch files to check code owners (skip PR details since we have basic info)
            const files = await fetchPRFiles(pr.number);
            const codeOwnerTeams = getCodeOwnerTeams(files, CODEOWNER_RULES);

            // Check if any code owner team matches our team name (case insensitive)
            const hasTeamAsCodeOwner = codeOwnerTeams.some(
              (team) => team.toLowerCase() === TEAM_NAME.toLowerCase()
            );

            if (hasTeamAsCodeOwner) {
              // Use the search result PR data and add files info
              return {
                ...pr,
                isCommunityPR: true,
                files,
                codeOwnerTeams,
              } as GitHubPullRequest;
            }
            return null;
          } catch (error) {
            console.warn(`Error processing PR ${pr.number}:`, error);
            return null;
          }
        })
      );

      // Filter out failed requests and null results
      const validResults = batchResults
        .filter(
          (result): result is PromiseFulfilledResult<GitHubPullRequest> =>
            result.status === "fulfilled" && result.value !== null
        )
        .map((result) => result.value);

      communityPRsWithTeamCodeOwners.push(...validResults);
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

  // Process all PRs in parallel with concurrency limit
  const concurrencyLimit = METRICS_CONCURRENCY_LIMIT;
  const prsWithMetrics: GitHubPullRequest[] = [];

  for (let i = 0; i < pullRequests.length; i += concurrencyLimit) {
    const batch = pullRequests.slice(i, i + concurrencyLimit);

    const batchResults = await Promise.allSettled(
      batch.map(async (pr) => {
        try {
          const metrics = await calculateMetrics(pr);
          return { ...pr, ...metrics };
        } catch (error) {
          console.warn(`Error calculating metrics for PR ${pr.number}:`, error);
          return {
            ...pr,
            age: 0,
            staleness: 0,
            isApproved: false,
            hasChangesRequested: false,
          };
        }
      })
    );

    // Process results with proper type checking
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        prsWithMetrics.push(result.value);
      }
    }
  }

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

    // Fetch team PRs and community PRs in parallel
    const [teamPRs, communityPRs] = await Promise.all([
      fetchPullRequests(),
      fetchCommunityPRs(),
    ]);

    // Filter PRs with the team conditions:
    // 1. PRs from team members (not in draft)
    // 2. OR PRs from Devin (if enabled) where at least one assignee is a team member
    const filteredTeamPRs = teamPRs.filter((pr) => {
      // Skip draft PRs
      if (pr.draft) {
        return false;
      }

      // If PR is from a team member, include it
      if (TEAM_MEMBERS.includes(pr.user.login)) {
        return true;
      }

      // If Devin is included and PR is from Devin, check assignees
      if (INCLUDE_DEVIN && pr.user.login === DEVIN_LOGIN) {
        return pr.assignees.some((assignee) =>
          TEAM_MEMBERS.includes(assignee.login)
        );
      }

      return false;
    });

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
