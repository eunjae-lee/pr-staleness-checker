import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
const inputData = process.env;

const GITHUB_TOKEN = inputData.GITHUB_TOKEN;
const REPO_OWNER = "calcom";
const REPO_NAME = "cal.com";
const INCLUDE_DEVIN = inputData.INCLUDE_DEVIN === "true";
const DEVIN_LOGIN = "devin-ai-integration[bot]";

const PRIORITY_LABELS = ["🚨 urgent", "Urgent", "High priority", "high-risk"];

// Function to fetch all organization members
const fetchOrgMembers = async () => {
  const url = `https://api.github.com/orgs/${REPO_OWNER}/members?per_page=100`;
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching org members: ${response.statusText}`);
  }

  const members = await response.json();
  return members.map((member) => member.login);
};

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

  return response.json();
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
  const createdDate = new Date(pr.created_at);
  const now = new Date();
  const age = Math.ceil(Math.abs(now - createdDate) / (1000 * 60 * 60 * 24));

  const [comments, reviews] = await Promise.all([
    fetchPRComments(pr.number),
    fetchPRReviews(pr.number),
  ]);

  const isApproved = reviews.some((review) => review.state === "APPROVED");
  const hasChangesRequested = reviews.some(
    (review) => review.state === "CHANGES_REQUESTED"
  );

  const lastActivity = [
    { date: new Date(pr.created_at) },
    ...comments.map((c) => ({ date: new Date(c.created_at) })),
    ...reviews.map((r) => ({ date: new Date(r.submitted_at) })),
  ].sort((a, b) => b.date - a.date)[0].date;

  const staleness = Math.ceil(
    Math.abs(now - lastActivity) / (1000 * 60 * 60 * 24)
  );

  return {
    age,
    staleness,
    isApproved,
    hasChangesRequested,
  };
};

const PR_STATUS = {
  HIGH_PRIORITY: { priority: 0, label: "🚨 High Priority" },
  NEEDS_FOUNDATION_REVIEW: { priority: 1, label: "⚡ Needs Foundation Review" },
  NEEDS_PLATFORM_REVIEW: { priority: 2, label: "🔧 Needs Platform Review" },
  NEEDS_CONSUMER_REVIEW: { priority: 3, label: "👥 Needs Consumer Review" },
  NEEDS_REVIEW: { priority: 4, label: "👀 Needs Review" },
  CHANGES_REQUESTED: { priority: 5, label: "🔄 Changes requested" },
  APPROVED: { priority: 6, label: "✅ Approved" },
};

const TEAMS = {
  foundation: "foundation",
  platform: "platform",
  consumer: "consumer",
};

const getPRStatus = (pr) => {
  // Check for priority labels first
  if (pr.labels.some((label) => PRIORITY_LABELS.includes(label.name))) {
    return PR_STATUS.HIGH_PRIORITY;
  }

  // Check for team reviews based on CODEOWNERS
  const requestedTeams = pr.requested_teams?.map((team) => team.slug) || [];

  // Check for single-team reviews
  const isOnlyTeamRequested = (team) => {
    const otherTeams = Object.values(TEAMS).filter((t) => t !== team);
    return (
      requestedTeams.includes(team) &&
      !otherTeams.some((t) => requestedTeams.includes(t))
    );
  };

  if (isOnlyTeamRequested(TEAMS.foundation))
    return PR_STATUS.NEEDS_FOUNDATION_REVIEW;
  if (isOnlyTeamRequested(TEAMS.platform))
    return PR_STATUS.NEEDS_PLATFORM_REVIEW;
  if (isOnlyTeamRequested(TEAMS.consumer))
    return PR_STATUS.NEEDS_CONSUMER_REVIEW;

  if (pr.hasChangesRequested) return PR_STATUS.CHANGES_REQUESTED;
  if (pr.isApproved) return PR_STATUS.APPROVED;
  return PR_STATUS.NEEDS_REVIEW;
};

const printPullRequests = async (pullRequests) => {
  if (pullRequests.length === 0) {
    return "No open pull requests.";
  }

  let output = `📊 *Open Pull Requests in ${REPO_OWNER}/${REPO_NAME}*\n\n`;

  const prsWithMetrics = await Promise.all(
    pullRequests.map(async (pr) => {
      const metrics = await calculateMetrics(pr);
      return { ...pr, ...metrics };
    })
  );

  // Group PRs by status
  const groupedPRs = Object.values(PR_STATUS).reduce((acc, status) => {
    acc[status.label] = [];
    return acc;
  }, {});

  prsWithMetrics.forEach((pr) => {
    const status = getPRStatus(pr);
    groupedPRs[status.label].push(pr);
  });

  // Print each group, sorted by staleness within group
  Object.entries(groupedPRs).forEach(([statusLabel, prs]) => {
    if (prs.length === 0) return;

    output += `*${statusLabel}* (${prs.length})\n`;
    prs
      .sort((a, b) => b.staleness - a.staleness)
      .forEach((pr) => {
        if (statusLabel === PR_STATUS.NEEDS_REVIEW.label) {
          // Special format for "Needs Review" section
          const teams = pr.requested_teams?.map((team) => team.name) || [];
          const teamsList = teams.length > 0 ? ` → ${teams.join(", ")}` : "";
          output += `• ${pr.title.trim()} (_${pr.user.login}${teamsList}_) - *${
            pr.age
          }d/${pr.staleness}d* (<${pr.html_url} | #${pr.number}>)\n`;
        } else {
          // Default format for other sections
          output += `• ${pr.title.trim()} (_${pr.user.login}_) - *${pr.age}d/${
            pr.staleness
          }d* (<${pr.html_url} | #${pr.number}>)\n`;
        }
      });
    output += "\n";
  });

  return output;
};

const main = async () => {
  try {
    const [pullRequests, orgMembers] = await Promise.all([
      fetchPullRequests(),
      fetchOrgMembers(),
    ]);

    // Filter out draft PRs and PRs from non-org members (except Devin if enabled)
    const filteredPRs = pullRequests.filter((pr) => {
      if (pr.draft) return false;
      if (INCLUDE_DEVIN && pr.user.login === DEVIN_LOGIN) return true;
      return orgMembers.includes(pr.user.login);
    });

    const output = await printPullRequests(filteredPRs);
    return output;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};

const output = await main();
console.log(output);
