import {
  inputData,
  INCLUDE_DEVIN,
  DEVIN_LOGIN,
  GitHubPullRequest,
  PRStatus,
  CODEOWNER_RULES,
  initializeCodeowners,
  fetchOrgMembers,
  fetchPRFiles,
  getCodeOwnerTeams,
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

// Helper function to check if draft is stuck for over a week
const isDraftStuck = (pr: GitHubPullRequest): boolean => {
  if (!pr.draft) return false;
  const draftAge = pr.age || 0;
  const staleness = pr.staleness || 0;
  return draftAge >= 7 && staleness >= 7;
};

// Helper function to check if PR has changes requested but no follow-up
const hasChangesRequestedNoFollowUp = (pr: GitHubPullRequest): boolean => {
  if (!pr.hasChangesRequested) return false;
  const staleness = pr.staleness || 0;
  // Consider it needs follow-up if there's been no activity for 3+ days after changes requested
  return staleness >= 3;
};

// Helper function to check if PR is approved but waiting to be merged
const isApprovedWaitingMerge = (pr: GitHubPullRequest): boolean => {
  if (!pr.isApproved) return false;
  const staleness = pr.staleness || 0;
  // Consider it waiting if approved but no activity for 2+ days
  return staleness >= 2;
};

const PR_STATUS: Record<string, PRStatus> = {
  NEEDS_ATTENTION: { priority: 0, label: "🚨 Needs Attention" },
  DRAFT_STUCK: { priority: 1, label: "📝 Draft Stuck (1+ week)" },
  CHANGES_REQUESTED_NO_FOLLOWUP: {
    priority: 2,
    label: "🔄 Changes Requested - No Follow-up",
  },
  APPROVED_WAITING_MERGE: {
    priority: 3,
    label: "✅ Approved - Waiting to Merge",
  },
};

const getPRStatus = (pr: GitHubPullRequest): PRStatus => {
  if (isDraftStuck(pr)) {
    return PR_STATUS.DRAFT_STUCK;
  }
  if (hasChangesRequestedNoFollowUp(pr)) {
    return PR_STATUS.CHANGES_REQUESTED_NO_FOLLOWUP;
  }
  if (isApprovedWaitingMerge(pr)) {
    return PR_STATUS.APPROVED_WAITING_MERGE;
  }
  if (meetsAttentionCriteria(pr)) {
    return PR_STATUS.NEEDS_ATTENTION;
  }
  // Default fallback
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

  // Filter PRs that meet any of our attention criteria
  const prsNeedingAttention = prsWithMetrics.filter(
    (pr) =>
      meetsAttentionCriteria(pr) ||
      isDraftStuck(pr) ||
      hasChangesRequestedNoFollowUp(pr) ||
      isApprovedWaitingMerge(pr)
  );

  if (prsNeedingAttention.length === 0) {
    return "No community PRs need attention at this time.";
  }

  // Sort by oldest first and limit to top 10 (increased to accommodate more sections)
  const top10OldestPRs = prsNeedingAttention
    .sort((a, b) => (b.age || 0) - (a.age || 0)) // Sort by oldest first
    .slice(0, 10);

  // Group PRs by status
  const groupedPRs = groupAndSortPRs(top10OldestPRs, PR_STATUS, getPRStatus);

  // Print each group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    output += `*${statusLabel}* (${prs.length})\n`;

    prs.forEach((pr) => {
      // Add additional info about code owners if available
      const additionalInfo = pr.codeOwnerTeams
        ? ` → ${pr.codeOwnerTeams.join("🛡️ or ")}🛡️`
        : "";
      output += formatPRLine(pr, additionalInfo) + "\n";
    });
    output += "\n";
  });

  // Add summary with breakdown
  const totalCommunityPRs = prsWithMetrics.length;
  const attentionNeeded = prsNeedingAttention.length;
  const showingCount = top10OldestPRs.length;

  const draftStuckCount = prsNeedingAttention.filter(isDraftStuck).length;
  const changesRequestedCount = prsNeedingAttention.filter(
    hasChangesRequestedNoFollowUp
  ).length;
  const approvedWaitingCount = prsNeedingAttention.filter(
    isApprovedWaitingMerge
  ).length;
  const generalAttentionCount = prsNeedingAttention.filter(
    (pr) =>
      meetsAttentionCriteria(pr) &&
      !isDraftStuck(pr) &&
      !hasChangesRequestedNoFollowUp(pr) &&
      !isApprovedWaitingMerge(pr)
  ).length;

  output += `📊 *Summary*\n`;
  output += `• Total community PRs analyzed: ${totalCommunityPRs}\n`;
  output += `• PRs needing attention: ${attentionNeeded}\n`;
  output += `• Drafts stuck (1+ week): ${draftStuckCount}\n`;
  output += `• Changes requested - no follow-up: ${changesRequestedCount}\n`;
  output += `• Approved - waiting to merge: ${approvedWaitingCount}\n`;
  output += `• General attention needed: ${generalAttentionCount}\n`;
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

    // Process PRs to add code owner information
    const communityPRsWithCodeOwners: GitHubPullRequest[] = [];

    for (const pr of communityPRs) {
      // Skip org members and Devin
      if (orgMembers.includes(pr.user.login) || pr.user.login === DEVIN_LOGIN) {
        continue;
      }

      try {
        // Fetch files to determine code owners
        const files = await fetchPRFiles(pr.number);
        const codeOwnerTeams = getCodeOwnerTeams(files, CODEOWNER_RULES);

        communityPRsWithCodeOwners.push({
          ...pr,
          isCommunityPR: true,
          files,
          codeOwnerTeams,
        });
      } catch (error) {
        console.warn(`Error processing community PR ${pr.number}:`, error);
        // Still include the PR even if we can't get code owners
        communityPRsWithCodeOwners.push({
          ...pr,
          isCommunityPR: true,
          files: [],
          codeOwnerTeams: [],
        });
      }
    }

    return communityPRsWithCodeOwners;
  } catch (error) {
    console.error("Error fetching community PRs for attention:", error);
    return [];
  }
};

const main = async (): Promise<string> => {
  try {
    // Initialize CODEOWNERS first
    await initializeCodeowners();

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
