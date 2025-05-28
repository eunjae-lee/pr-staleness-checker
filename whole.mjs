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

// Move these to the top level, after other constants
let CODEOWNER_RULES = [];

const initializeCodeowners = async () => {
  const content = await fetchCodeowners();
  CODEOWNER_RULES = parseCodeowners(content);
};

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

const fetchCodeowners = async () => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/.github/CODEOWNERS`;
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

const calculateMetrics = async (pr) => {
  const createdDate = new Date(pr.created_at);
  const now = new Date();
  const age = Math.ceil(Math.abs(now - createdDate) / (1000 * 60 * 60 * 24));

  const [comments, reviews] = await Promise.all([
    fetchPRComments(pr.number),
    fetchPRReviews(pr.number),
  ]);

  // Get latest review from each user
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
  NEEDS_FOUNDATION_REVIEW: {
    priority: 1,
    label: "⚡ Needs Foundation Review",
  },
  NEEDS_PLATFORM_REVIEW: { priority: 2, label: "🔧 Needs Platform Review" },
  NEEDS_CONSUMER_REVIEW: { priority: 3, label: "👥 Needs Consumer Review" },
  NEEDS_REVIEW: { priority: 4, label: "👀 Needs Review" },
  CHANGES_REQUESTED: { priority: 5, label: "🔄 Changes requested" },
  APPROVED: { priority: 6, label: "✅ Approved" },
};

const TEAMS = {
  foundation: "Foundation",
  platform: "Platform",
  consumer: "Consumer",
};

// Helper function to format PR author name
const formatAuthorName = (pr) => {
  if (pr.user.login === DEVIN_LOGIN) {
    // For Devin PRs, show "Devin + assignee"
    if (pr.assignees && pr.assignees.length > 0) {
      // Use the first assignee if multiple exist
      return `DevinAI & ${pr.assignees[0].login}`;
    }
    return "DevinAI";
  }
  return pr.user.login;
};

// Helper function to format team list for "Needs Review" section
const formatTeamList = (pr, codeOwnerTeams) => {
  const teams =
    pr.requested_teams?.map((team) => {
      const isCodeOwner = codeOwnerTeams.includes(team.slug.toLowerCase());
      return isCodeOwner ? `${team.name}🛡️` : team.name;
    }) || [];
  return teams.length > 0 ? ` → ${teams.join(" or ")}` : "";
};

const getPRStatus = (pr) => {
  // Check for priority labels first
  if (pr.labels.some((label) => PRIORITY_LABELS.includes(label.name))) {
    return PR_STATUS.HIGH_PRIORITY;
  }

  const files = pr.files;
  const codeOwnerTeams = getCodeOwnerTeams(files, CODEOWNER_RULES);
  const codeOwnerTeamsLower = codeOwnerTeams.map((t) => t.toLowerCase());
  const onlyOneCodeOwner = codeOwnerTeamsLower.length === 1;

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

const printPullRequests = async (pullRequests) => {
  if (pullRequests.length === 0) {
    return "No open pull requests.";
  }

  let output = `📊 *Open Pull Requests in ${REPO_OWNER}/${REPO_NAME}*\n\n`;

  const prsWithMetrics = await Promise.all(
    pullRequests.map(async (pr) => {
      const [metrics, files] = await Promise.all([
        calculateMetrics(pr),
        fetchPRFiles(pr.number),
      ]);
      return { ...pr, ...metrics, files };
    })
  );

  // Group PRs by status
  const groupedPRs = Object.values(PR_STATUS).reduce((acc, status) => {
    acc[status.label] = [];
    return acc;
  }, {});

  // Now we can use the pre-calculated status
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
          // Get code owner teams for this PR
          const codeOwnerTeams = getCodeOwnerTeams(
            pr.files,
            CODEOWNER_RULES
          ).map((t) => t.toLowerCase());

          // Special format for "Needs Review" section
          const teamsList = formatTeamList(pr, codeOwnerTeams);
          output += `• ${pr.title.trim()} (_${formatAuthorName(
            pr
          )}${teamsList}_) - *${pr.age}d/${pr.staleness}d* (<${
            pr.html_url
          } | #${pr.number}>)\n`;
        } else {
          // Default format for other sections
          output += `• ${pr.title.trim()} (_${formatAuthorName(pr)}_) - *${
            pr.age
          }d/${pr.staleness}d* (<${pr.html_url} | #${pr.number}>)\n`;
        }
      });
    output += "\n";
  });

  return output;
};

const fetchPRFiles = async (prNumber) => {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/files`;
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

const main = async () => {
  try {
    // Initialize CODEOWNERS first
    await initializeCodeowners();

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
