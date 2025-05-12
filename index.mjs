import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
const inputData = process.env;

const GITHUB_TOKEN = inputData.GITHUB_TOKEN;
const REPO_OWNER = "calcom";
const REPO_NAME = "cal.com";
const TEAM_NAME = inputData.TEAM_NAME;
const INCLUDE_DEVIN = inputData.INCLUDE_DEVIN === "true";

const DEVIN_LOGIN = "devin-ai-integration[bot]";

// Get team members from environment variables
const TEAM_MEMBERS =
  inputData.TEAM_MEMBERS?.split(",").map((username) => username.trim()) || [];

if (TEAM_MEMBERS.length === 0) {
  console.error("No team members specified in .env file");
  process.exit(1);
}

const fetchPullRequests = async () => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=100`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching PRs: ${response.statusText}`);
  }

  const pullRequests = await response.json();

  // Filter PRs with the new conditions:
  // 1. PRs from team members (not in draft)
  // 2. OR PRs from Devin (if enabled) where at least one assignee is a team member
  return pullRequests.filter((pr) => {
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
};

const fetchPRComments = async (prNumber) => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/comments`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching PR comments: ${response.statusText}`);
  }

  return response.json();
};

const fetchPRReviews = async (prNumber) => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/reviews`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching PR reviews: ${response.statusText}`);
  }

  return response.json();
};

const calculateMetrics = async (pr) => {
  // Calculate age
  const createdDate = new Date(pr.created_at);
  const now = new Date();
  const age = Math.ceil(Math.abs(now - createdDate) / (1000 * 60 * 60 * 24));

  // Fetch comments and reviews
  const [comments, reviews] = await Promise.all([
    fetchPRComments(pr.number),
    fetchPRReviews(pr.number),
  ]);

  // Get review status from all reviews
  const isApproved = reviews.some((review) => review.state === "APPROVED");
  const hasChangesRequested = reviews.some(
    (review) => review.state === "CHANGES_REQUESTED"
  );

  // Calculate staleness using existing logic
  const teamActivity = [
    ...comments.map((c) => ({
      date: new Date(c.created_at),
      user: c.user.login,
    })),
    ...reviews.map((r) => ({
      date: new Date(r.submitted_at),
      user: r.user.login,
    })),
  ]
    .filter(
      (activity) =>
        TEAM_MEMBERS.includes(activity.user) && activity.user !== pr.user.login
    )
    .sort((a, b) => b.date - a.date);

  const staleness =
    teamActivity.length > 0
      ? Math.ceil(Math.abs(now - teamActivity[0].date) / (1000 * 60 * 60 * 24))
      : age;

  return {
    age,
    staleness,
    isApproved,
    hasChangesRequested,
  };
};

const PR_STATUS = {
  NEEDS_REVIEW: { priority: 0, label: "👀 Needs review" },
  CHANGES_REQUESTED: { priority: 1, label: "🔄 Changes requested" },
  APPROVED: { priority: 2, label: "✅ Approved" },
};

const getPRStatus = (pr) => {
  if (pr.hasChangesRequested) return PR_STATUS.CHANGES_REQUESTED;
  if (pr.isApproved) return PR_STATUS.APPROVED;
  return PR_STATUS.NEEDS_REVIEW;
};

const printPullRequests = async (pullRequests) => {
  let output = "";

  if (pullRequests.length === 0) {
    return "No open pull requests from team members.";
  }

  output += `📊 *Open Pull Requests from ${TEAM_NAME} Team Members*\n\n`;

  // Process all PRs in parallel
  const prsWithMetrics = await Promise.all(
    pullRequests.map(async (pr) => {
      const metrics = await calculateMetrics(pr);
      return { ...pr, ...metrics };
    })
  );

  // Group PRs by status
  const groupedPRs = {
    [PR_STATUS.NEEDS_REVIEW.label]: [],
    [PR_STATUS.CHANGES_REQUESTED.label]: [],
    [PR_STATUS.APPROVED.label]: [],
  };

  prsWithMetrics.forEach((pr) => {
    const status = getPRStatus(pr);
    groupedPRs[status.label].push(pr);
  });

  // Print each group, sorted by staleness within group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    output += `*${statusLabel}*\n`;
    prs
      .sort((a, b) => b.staleness - a.staleness)
      .forEach((pr) => {
        output +=
          `• *${pr.title.trim()}*\n` +
          `  by ${pr.user.login} • Age: ${pr.age}d • Stale: ${pr.staleness}d\n` +
          `  ${pr.html_url}\n\n`;
      });
  });

  return output;
};

const main = async () => {
  try {
    const pullRequests = await fetchPullRequests();
    const output = await printPullRequests(pullRequests);
    return output;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};

const output = await main();
console.log(output);

// return { message: output };
