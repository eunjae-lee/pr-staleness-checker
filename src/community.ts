import {
  inputData,
  INCLUDE_DEVIN,
  DEVIN_LOGIN,
  GitHubPullRequest,
  PRStatus,
  CODEOWNER_RULES,
  initializeCodeowners,
  fetchOrgMembers,
  calculateMetrics,
  formatAuthorName,
  formatPRLine,
  groupAndSortPRs,
  fetchCommunityPRsBySearch,
} from "./common";

// Performance configuration constants
const METRICS_CONCURRENCY_LIMIT = 15;

// Helper function to check if PR meets the attention criteria
const meetsAttentionCriteria = (pr: GitHubPullRequest): boolean => {
  // Must be open and ready for review (not draft, or draft for over a week with no activity)
  if (pr.draft) {
    // If it's a draft, check if it's been a draft for over a week with no activity
    const draftAge = pr.age || 0;
    const staleness = pr.staleness || 0;

    // If draft is over 7 days old and has no activity in 7+ days
    return draftAge >= 7 && staleness >= 7;
  }

  // For non-draft PRs, just check if there's no activity in 7+ days
  return (pr.staleness || 0) >= 7;
};

const PR_STATUS: Record<string, PRStatus> = {
  NEEDS_ATTENTION: { priority: 0, label: "🚨 Needs Attention" },
  DRAFT_NEEDS_ATTENTION: { priority: 1, label: "📝 Draft Needs Attention" },
};

const getPRStatus = (pr: GitHubPullRequest): PRStatus => {
  if (pr.draft) {
    return PR_STATUS.DRAFT_NEEDS_ATTENTION;
  }
  return PR_STATUS.NEEDS_ATTENTION;
};

const printCommunityPRs = async (
  pullRequests: GitHubPullRequest[]
): Promise<string> => {
  let output = "";

  if (pullRequests.length === 0) {
    return "No community PRs need attention at this time.";
  }

  output += `🌍 *Community PRs Needing Attention*\n\n`;

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

  // Filter PRs that meet attention criteria
  const prsNeedingAttention = prsWithMetrics.filter(meetsAttentionCriteria);

  if (prsNeedingAttention.length === 0) {
    return "No community PRs need attention at this time.";
  }

  // Sort by oldest first and limit to top 5
  const top5OldestPRs = prsNeedingAttention
    .sort((a, b) => (b.age || 0) - (a.age || 0)) // Sort by oldest first
    .slice(0, 5);

  // Group PRs by status
  const groupedPRs = groupAndSortPRs(top5OldestPRs, PR_STATUS, getPRStatus);

  // Print each group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    output += `*${statusLabel}* (${prs.length})\n`;

    prs.forEach((pr) => {
      output += formatPRLine(pr) + "\n";
    });
    output += "\n";
  });

  // Add summary
  const totalCommunityPRs = prsWithMetrics.length;
  const attentionNeeded = prsNeedingAttention.length;
  const showingCount = top5OldestPRs.length;

  output += `📊 *Summary*\n`;
  output += `• Total community PRs analyzed: ${totalCommunityPRs}\n`;
  output += `• PRs needing attention: ${attentionNeeded}\n`;
  output += `• Showing top ${showingCount} oldest PRs needing attention\n`;

  return output;
};

const fetchCommunityPRsForAttention = async (): Promise<
  GitHubPullRequest[]
> => {
  try {
    // Fetch org members to exclude them from community PRs
    const orgMembers = await fetchOrgMembers();

    // Fetch community PRs with specific criteria
    const communityPRs = await fetchCommunityPRsBySearch({
      additionalSearchCriteria: ["sort:created-asc"], // Get oldest first
      maxPages: 3, // Fetch more pages to get a good sample
      perPage: 100,
      excludeDrafts: false, // Include drafts to check if they need attention
    });

    // Filter out org members and Devin, mark as community PRs
    const filteredCommunityPRs = communityPRs
      .filter(
        (pr) =>
          !orgMembers.includes(pr.user.login) && pr.user.login !== DEVIN_LOGIN
      )
      .map((pr) => ({
        ...pr,
        isCommunityPR: true,
      }));

    return filteredCommunityPRs;
  } catch (error) {
    console.error("Error fetching community PRs for attention:", error);
    return [];
  }
};

const main = async (): Promise<string> => {
  try {
    // Fetch community PRs that might need attention
    const communityPRs = await fetchCommunityPRsForAttention();

    const output = await printCommunityPRs(communityPRs);

    return output;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Error: ${errorMessage}`;
  }
};

const output = await main();
console.log(output);
