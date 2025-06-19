import {
  inputData,
  INCLUDE_DEVIN,
  DEVIN_LOGIN,
  PRIORITY_LABELS,
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

const PR_STATUS: Record<string, PRStatus> = {
  HIGH_PRIORITY: { priority: 0, label: "🚨 High Priority" },
  NEEDS_FOUNDATION_REVIEW: {
    priority: 1,
    label: "⚡ Needs Foundation Review",
  },
  NEEDS_PLATFORM_REVIEW: { priority: 2, label: "🔧 Needs Platform Review" },
  NEEDS_CONSUMER_REVIEW: { priority: 3, label: "👥 Needs Consumer Review" },
  NEEDS_REVIEW: { priority: 4, label: "👀 Needs Review" },
  CHANGES_REQUESTED: { priority: 5, label: "🔄 Changes requested" },
  APPROVED: { priority: 6, label: "✅ Approved" },
  COMMUNITY_PRS: { priority: 7, label: "🌟 Community PRs" },
};

const TEAMS = {
  foundation: "Foundation",
  platform: "Platform",
  consumer: "Consumer",
};

// Helper function to format team list for "Needs Review" section
const formatTeamList = (
  pr: GitHubPullRequest,
  codeOwnerTeams: string[]
): string => {
  const teams =
    pr.requested_teams?.map((team) => {
      const isCodeOwner = codeOwnerTeams.includes(team.slug.toLowerCase());
      return isCodeOwner ? `${team.name}🛡️` : team.name;
    }) || [];
  return teams.length > 0 ? ` → ${teams.join(" or ")}` : "";
};

const getPRStatus = (pr: GitHubPullRequest, orgMembers: string[]): PRStatus => {
  // Check for priority labels first
  if (pr.labels.some((label) => PRIORITY_LABELS.includes(label.name))) {
    return PR_STATUS.HIGH_PRIORITY;
  }

  const files = pr.files || [];
  const codeOwnerTeams = getCodeOwnerTeams(files, CODEOWNER_RULES);
  const codeOwnerTeamsLower = codeOwnerTeams.map((t) => t.toLowerCase());
  const onlyOneCodeOwner = codeOwnerTeamsLower.length === 1;

  // Check if this is a pre-marked community PR
  if (pr.isCommunityPR) {
    return PR_STATUS.COMMUNITY_PRS;
  }

  // If PR has changes requested or is approved, show that status regardless of code owners
  if (pr.hasChangesRequested) return PR_STATUS.CHANGES_REQUESTED;
  if (pr.isApproved) return PR_STATUS.APPROVED;

  // Check if Foundation is the only code owner
  const hasFoundation = codeOwnerTeamsLower.includes(
    TEAMS.foundation.toLowerCase()
  );
  if (hasFoundation && onlyOneCodeOwner) {
    return PR_STATUS.NEEDS_FOUNDATION_REVIEW;
  }

  // Check for Platform
  const hasPlatform = codeOwnerTeamsLower.includes(
    TEAMS.platform.toLowerCase()
  );
  if (hasPlatform && onlyOneCodeOwner) {
    return PR_STATUS.NEEDS_PLATFORM_REVIEW;
  }

  // Check for Consumer
  const hasConsumer = codeOwnerTeamsLower.includes(
    TEAMS.consumer.toLowerCase()
  );
  if (hasConsumer && onlyOneCodeOwner) {
    return PR_STATUS.NEEDS_CONSUMER_REVIEW;
  }

  // If no code owners or other combinations, it goes to general review
  return PR_STATUS.NEEDS_REVIEW;
};

const printPullRequests = async (
  pullRequests: GitHubPullRequest[],
  orgMembers: string[]
): Promise<string[]> => {
  if (pullRequests.length === 0) {
    return ["No open pull requests."];
  }

  const sections: string[] = [];
  const title = "📊 *Open Pull Requests in calcom/cal.com*\n";

  // PRs already have metrics calculated
  const prsWithMetrics = pullRequests;

  // Group PRs by status using utility function
  const groupedPRs = groupAndSortPRs(prsWithMetrics, PR_STATUS, (pr) =>
    getPRStatus(pr, orgMembers)
  );

  // Print each group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    // Skip the NEEDS_REVIEW section now
    if (statusLabel === PR_STATUS.NEEDS_REVIEW.label) return;

    let sectionOutput = `*${statusLabel}* (${prs.length})\n`;
    prs.forEach((pr) => {
      if (statusLabel === PR_STATUS.NEEDS_REVIEW.label) {
        // Get code owner teams for this PR
        const codeOwnerTeams = getCodeOwnerTeams(
          pr.files || [],
          CODEOWNER_RULES
        ).map((t) => t.toLowerCase());

        // Special format for "Needs Review" section
        const teamsList = formatTeamList(pr, codeOwnerTeams);
        sectionOutput += formatPRLine(pr, teamsList) + "\n";
      } else {
        // Default format for other sections
        sectionOutput += formatPRLine(pr) + "\n";
      }
    });
    sections.push(sectionOutput);
  });

  // Combine title with first section if there are any sections
  if (sections.length > 0) {
    sections[0] = title + "\n" + sections[0];
  }

  return sections;
};

const fetchApprovedCommunityPRs = async (
  orgMembers: string[]
): Promise<GitHubPullRequest[]> => {
  return await fetchCommunityPRsBySearch(["review:approved"]);
};

const main = async (): Promise<string[]> => {
  try {
    // Initialize CODEOWNERS first
    await initializeCodeowners();

    const [pullRequests, orgMembers] = await Promise.all([
      fetchPullRequests(),
      fetchOrgMembers(),
    ]);

    const approvedCommunityPRs = await fetchApprovedCommunityPRs(orgMembers);

    // Filter org member and Devin PRs (normal processing)
    const orgMemberAndDevinPRs = pullRequests.filter((pr) => {
      if (pr.draft) return false;
      if (INCLUDE_DEVIN && pr.user.login === DEVIN_LOGIN) return true;
      return orgMembers.includes(pr.user.login);
    });

    // Calculate metrics for org member/Devin PRs
    const orgPRsWithMetrics = await Promise.all(
      orgMemberAndDevinPRs.map(async (pr) => {
        return await enhancePRWithMetrics(pr);
      })
    );

    // Process approved community PRs (much smaller list)
    const communityPRsWithMetrics = await Promise.all(
      approvedCommunityPRs.map(async (pr) => {
        return await enhancePRWithMetrics(pr);
      })
    );

    // Filter community PRs to only those that need Foundation/Consumer approval
    const validCommunityPRs = communityPRsWithMetrics
      .filter((pr) => {
        const codeOwnerTeams = getCodeOwnerTeams(
          pr.files || [],
          CODEOWNER_RULES
        );
        const codeOwnerTeamsLower = codeOwnerTeams.map((t) => t.toLowerCase());
        const hasFoundation = codeOwnerTeamsLower.includes(
          TEAMS.foundation.toLowerCase()
        );
        const hasConsumer = codeOwnerTeamsLower.includes(
          TEAMS.consumer.toLowerCase()
        );
        return hasFoundation || hasConsumer;
      })
      .map((pr) => ({ ...pr, isCommunityPR: true })); // Mark as community PR

    // Combine all PRs
    const allPRs = [...orgPRsWithMetrics, ...validCommunityPRs];
    return await printPullRequests(allPRs, orgMembers);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return [];
  }
};

const output = (await main()).join("---\n");
console.log(output);
