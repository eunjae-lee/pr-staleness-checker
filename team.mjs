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

// Move these to the top level, after other constants
let CODEOWNER_RULES = [];

// Global API call counter
let API_CALL_COUNT = 0;

const initializeCodeowners = async () => {
  const content = await fetchCodeowners();
  CODEOWNER_RULES = parseCodeowners(content);
};

// Helper function to format PR author name
const formatAuthorName = (pr) => {
  if (pr.user.login === DEVIN_LOGIN) {
    // For Devin PRs, show "DevinAI & assignee"
    if (pr.assignees && pr.assignees.length > 0) {
      // Use the first assignee if multiple exist
      return `DevinAI & ${pr.assignees[0].login}`;
    }
    return "DevinAI";
  }
  return pr.user.login;
};

// Get team members from environment variables
const TEAM_MEMBERS =
  inputData.TEAM_MEMBERS?.split(",").map((username) => username.trim()) || [];

if (TEAM_MEMBERS.length === 0) {
  console.error("No team members specified in .env file");
  process.exit(1);
}

// Function to fetch all organization members
const fetchOrgMembers = async () => {
  const url = `https://api.github.com/orgs/${REPO_OWNER}/members?per_page=100`;
  API_CALL_COUNT++; // Increment counter
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
  API_CALL_COUNT++; // Increment counter
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
  API_CALL_COUNT++; // Increment counter
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
  API_CALL_COUNT++; // Increment counter
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

const fetchCodeowners = async () => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/.github/CODEOWNERS`;
  API_CALL_COUNT++; // Increment counter
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching CODEOWNERS: ${response.statusText}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content, "base64").toString();
  return content;
};

const parseCodeowners = (content) => {
  const rules = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [pattern, ...owners] = trimmed.split(/\s+/);
    // Only include team rules
    const teams = owners
      .filter((owner) => owner.startsWith("@calcom/"))
      .map((owner) => owner.replace("@calcom/", ""));

    if (teams.length > 0) {
      rules.push({ pattern, teams });
    }
  }

  return rules;
};

// https://github.com/dytab/affected-codeowners/blob/main/src/codeowners/parse-pattern.ts
const parsePattern = (pattern) => {
  // Handle specific edge cases first
  if (pattern.includes("***")) {
    throw new Error("pattern cannot contain three consecutive asterisks");
  } else if (pattern === "") {
    throw new Error("empty pattern");
  } else if (pattern === "/") {
    // "/" doesn't match anything
    return new RegExp("^$");
  }

  let segments = pattern.split("/");

  if (segments[0] === "") {
    // Leading slash: match is relative to root
    segments = segments.slice(1);
  } else {
    // No leading slash - check for a single segment pattern
    if (
      segments.length === 1 ||
      (segments.length === 2 && segments[1] === "")
    ) {
      if (segments[0] !== "**") {
        segments = ["**", ...segments];
      }
    }
  }

  if (segments.length > 1 && segments[segments.length - 1] === "") {
    // Trailing slash is equivalent to "/**"
    segments[segments.length - 1] = "**";
  }

  const lastSegIndex = segments.length - 1;
  const separator = "/";
  let needSlash = false;
  const re = ["^"];

  segments.forEach((seg, i) => {
    switch (seg) {
      case "**":
        if (i === 0 && i === lastSegIndex) {
          // If the pattern is just "**", match everything
          re.push(".+");
        } else if (i === 0) {
          // If the pattern starts with "**", match any leading path segment
          re.push(`(?:.+${separator})?`);
          needSlash = false;
        } else if (i === lastSegIndex) {
          // If the pattern ends with "**", match any trailing path segment
          re.push(`${separator}.*`);
        } else {
          // Match zero or more path segments
          re.push(`(?:${separator}.+)?`);
          needSlash = true;
        }
        break;

      case "*":
        if (needSlash) {
          re.push(separator);
        }
        // Match any characters except the separator
        re.push(`[^${separator}]+`);
        needSlash = true;
        break;

      default: {
        if (needSlash) {
          re.push(separator);
        }

        let escape = false;
        for (const ch of seg) {
          if (escape) {
            escape = false;
            // escape the next char
            re.push(ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            continue;
          }

          switch (ch) {
            case "\\":
              escape = true;
              break;
            case "*":
              // Multi-character wildcard
              re.push(`[^${separator}]*`);
              break;
            case "?":
              // Single-character wildcard
              re.push(`[^${separator}]`);
              break;
            default:
              // escape if necessary
              re.push(ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
              break;
          }
        }

        if (i === lastSegIndex) {
          // match descendent paths
          re.push(`(?:${separator}.*)?`);
        }

        needSlash = true;
      }
    }
  });

  re.push("$");
  return new RegExp(re.join(""));
};

const getCodeOwnerTeams = (files, codeownerRules) => {
  const requiredTeams = new Set();

  for (const file of files) {
    for (const rule of codeownerRules) {
      if (parsePattern(rule.pattern).test(file.filename)) {
        // Add the teams directly from CODEOWNERS
        rule.teams.forEach((team) => requiredTeams.add(team));
      }
    }
  }

  return Array.from(requiredTeams);
};

const fetchPRFiles = async (prNumber) => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/files`;
  API_CALL_COUNT++; // Increment counter
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching PR files: ${response.statusText}`);
  }

  return response.json();
};

// Function to fetch community PRs (excluding team members and org members)
const fetchCommunityPRs = async () => {
  try {
    // Fetch org members first
    const orgMembers = await fetchOrgMembers();

    // Combine team members and org members for exclusion
    const excludedUsers = [
      ...new Set([...TEAM_MEMBERS, DEVIN_LOGIN, ...orgMembers]),
    ];
    console.log("💡 excludedUsers", JSON.stringify(excludedUsers, null, 2));

    // Build the search query excluding all team and org members
    const excludeAuthors = excludedUsers
      .map((user) => `-author:${user}`)
      .join("+");
    const searchQuery = `is:pr+is:open+repo:${REPO_OWNER}/${REPO_NAME}+${excludeAuthors}`;

    const url = `https://api.github.com/search/issues?q=${searchQuery}`;

    API_CALL_COUNT++; // Increment counter
    const response = await fetch(url, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching community PRs: ${response.statusText}`);
    }

    const searchResults = await response.json();
    console.log("💡 searchResults", JSON.stringify(searchResults, null, 2));

    // Filter PRs that have code owners matching the team
    const communityPRsWithTeamCodeOwners = [];

    for (const pr of searchResults.items) {
      // Get detailed PR info and files
      const prDetailUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${pr.number}`;
      API_CALL_COUNT++; // Increment counter
      const prDetailResponse = await fetch(prDetailUrl, {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (prDetailResponse.ok) {
        const prDetail = await prDetailResponse.json();

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

    console.log(
      "💡 communityPRsWithTeamReviews",
      JSON.stringify(communityPRsWithTeamCodeOwners, null, 2)
    );
    return communityPRsWithTeamCodeOwners;
  } catch (error) {
    console.error("Error fetching community PRs:", error);
    return [];
  }
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
  const latestReviewsByUser = reviews.reduce((acc, review) => {
    // Keep only the latest review from each user
    if (
      !acc[review.user.login] ||
      new Date(review.submitted_at) >
        new Date(acc[review.user.login].submitted_at)
    ) {
      acc[review.user.login] = review;
    }
    return acc;
  }, {});

  // Check latest reviews only
  const activeReviews = Object.values(latestReviewsByUser);
  const isApproved = activeReviews.some(
    (review) => review.state === "APPROVED"
  );
  const hasChangesRequested = activeReviews.some(
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
  COMMUNITY_PR: { priority: 3, label: "🌍 Community PRs" },
};

const getPRStatus = (pr) => {
  // Check if it's a community PR first
  if (pr.isCommunityPR) return PR_STATUS.COMMUNITY_PR;

  if (pr.hasChangesRequested) return PR_STATUS.CHANGES_REQUESTED;
  if (pr.isApproved) return PR_STATUS.APPROVED;
  return PR_STATUS.NEEDS_REVIEW;
};

const printPullRequests = async (pullRequests) => {
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

  // Group PRs by status
  const groupedPRs = {
    [PR_STATUS.NEEDS_REVIEW.label]: [],
    [PR_STATUS.CHANGES_REQUESTED.label]: [],
    [PR_STATUS.APPROVED.label]: [],
    [PR_STATUS.COMMUNITY_PR.label]: [],
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
        // Show code owner info for community PRs
        let additionalInfo = "";
        if (pr.isCommunityPR && pr.codeOwnerTeams) {
          additionalInfo = ` • Code owners: ${pr.codeOwnerTeams.join(", ")}`;
        }

        output +=
          `• *${pr.title.trim()}*\n` +
          `  by ${formatAuthorName(pr)} • Age: ${pr.age}d • Stale: ${
            pr.staleness
          }d${additionalInfo}\n` +
          `  ${pr.html_url}\n\n`;
      });
  });

  return output;
};

const main = async () => {
  try {
    // Initialize CODEOWNERS first
    await initializeCodeowners();

    const teamPRs = await fetchPullRequests();
    const communityPRs = await fetchCommunityPRs();

    // Combine both team PRs and community PRs
    const allPRs = [...teamPRs, ...communityPRs];

    const output = await printPullRequests(allPRs);

    return output;
    // Add API call count to output
    // const apiCallSummary = `\n📊 *GitHub API Calls Summary*\nTotal API calls made: ${API_CALL_COUNT}\n`;

    // return output + apiCallSummary;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};

const output = await main();
console.log(output);

// return { message: output };
