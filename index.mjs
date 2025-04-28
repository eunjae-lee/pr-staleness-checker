import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = "calcom";
const REPO_NAME = "cal.com";
const TEAM_NAME = process.env.TEAM_NAME;

// Get team members from environment variables
const TEAM_MEMBERS =
  process.env.TEAM_MEMBERS?.split(",").map((username) => username.trim()) || [];

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

  // Filter PRs to only show:
  // 1. PRs from team members
  // 2. Not in draft state
  return pullRequests.filter(
    (pr) => TEAM_MEMBERS.includes(pr.user.login) && !pr.draft
  );
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
  if (pullRequests.length === 0) {
    console.log("No open pull requests from team members.");
    return;
  }

  console.log(`📊 *Open Pull Requests from ${TEAM_NAME} Team Members*\n`);

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

    console.log(`*${statusLabel}*`);
    prs
      .sort((a, b) => b.staleness - a.staleness)
      .forEach((pr) => {
        console.log(
          `• *${pr.title.trim()}*\n` +
            `  by ${pr.user.login} • Age: ${pr.age}d • Stale: ${pr.staleness}d\n` +
            `  ${pr.html_url}\n`
        );
      });
  });
};

const main = async () => {
  try {
    const pullRequests = await fetchPullRequests();
    await printPullRequests(pullRequests);
  } catch (error) {
    console.error("Error:", error.message);
  }
};

main();
