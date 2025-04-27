import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = "calcom";
const REPO_NAME = "cal.com";

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

  // Combine comments and reviews, filtering for team member activity
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

  // Calculate staleness (days since last team member activity)
  const staleness =
    teamActivity.length > 0
      ? Math.ceil(Math.abs(now - teamActivity[0].date) / (1000 * 60 * 60 * 24))
      : age; // If no team activity, staleness equals age

  return { age, staleness };
};

const printPullRequests = async (pullRequests) => {
  if (pullRequests.length === 0) {
    console.log("No open pull requests from team members.");
    return;
  }

  console.log("Open Pull Requests from Team Members:\n");
  console.log(
    "| PR Title | Author | Age (days) | Staleness (days) | Status | URL |"
  );
  console.log("|:---|:---|:---|:---|:---|:---|");

  // Process all PRs in parallel
  const prsWithMetrics = await Promise.all(
    pullRequests.map(async (pr) => {
      const metrics = await calculateMetrics(pr);
      const status = pr.draft ? "📝 Draft" : "🔍 In Review";
      return { ...pr, ...metrics, status };
    })
  );

  // Sort by staleness (most stale first)
  prsWithMetrics
    .sort((a, b) => b.staleness - a.staleness)
    .forEach((pr) => {
      console.log(
        `| ${pr.title} | ${pr.user.login} | ${pr.age} | ${pr.staleness} | ${pr.status} | ${pr.html_url} |`
      );
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
