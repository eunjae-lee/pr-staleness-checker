import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();
export const inputData = process.env;

export const GITHUB_TOKEN = inputData.GITHUB_TOKEN!;
export const REPO_OWNER = "calcom";
export const REPO_NAME = "cal.com";
export const TEAM_NAME = inputData.TEAM_NAME!;
export const INCLUDE_DEVIN = inputData.INCLUDE_DEVIN === "true";
export const DEVIN_LOGIN = "devin-ai-integration[bot]";

export const PRIORITY_LABELS = ["🚨 urgent", "Urgent", "High priority"];

// Interfaces for GitHub API responses
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  type: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
  description?: string;
}

export interface GitHubTeam {
  name: string;
  slug: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft: boolean;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  requested_teams?: GitHubTeam[];
  isCommunityPR?: boolean;
  files?: GitHubFile[];
  codeOwnerTeams?: string[];
  age?: number;
  staleness?: number;
  isApproved?: boolean;
  hasChangesRequested?: boolean;
}

export interface GitHubComment {
  id: number;
  user: GitHubUser;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  state: "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  body: string;
  submitted_at: string;
}

export interface GitHubFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
  status: string;
  patch?: string;
}

export interface CodeOwnerRule {
  pattern: string;
  teams: string[];
}

export interface GitHubContentResponse {
  content: string;
  encoding: string;
}

export interface PRMetrics {
  age: number;
  staleness: number;
  isApproved: boolean;
  hasChangesRequested: boolean;
}

export interface PRStatus {
  priority: number;
  label: string;
}

export interface SearchResults {
  items: GitHubPullRequest[];
}

export interface Activity {
  date: Date;
  user: string;
}

// Global variables
export let CODEOWNER_RULES: CodeOwnerRule[] = [];
export let API_CALL_COUNT = 0;

export const initializeCodeowners = async (): Promise<void> => {
  const content = await fetchCodeowners();
  CODEOWNER_RULES = parseCodeowners(content);
};

// Function to fetch all organization members
export const fetchOrgMembers = async (): Promise<string[]> => {
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

  const members = (await response.json()) as GitHubUser[];
  return members.map((member) => member.login);
};

export const fetchPullRequests = async (): Promise<GitHubPullRequest[]> => {
  const allPRs: GitHubPullRequest[] = [];
  const perPage = 100;
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=${perPage}&page=${page}`;
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

    const pagePRs = (await response.json()) as GitHubPullRequest[];
    allPRs.push(...pagePRs);

    // If we got fewer PRs than perPage, we've reached the end
    if (pagePRs.length < perPage) {
      break;
    }
  }

  return allPRs;
};

export const fetchPRComments = async (
  prNumber: number
): Promise<GitHubComment[]> => {
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

  return response.json() as Promise<GitHubComment[]>;
};

export const fetchPRReviews = async (
  prNumber: number
): Promise<GitHubReview[]> => {
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

  return response.json() as Promise<GitHubReview[]>;
};

export const fetchCodeowners = async (): Promise<string> => {
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

  const data = (await response.json()) as GitHubContentResponse;
  const content = Buffer.from(data.content, "base64").toString();
  return content;
};

export const parseCodeowners = (content: string): CodeOwnerRule[] => {
  const rules: CodeOwnerRule[] = [];
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
export const parsePattern = (pattern: string): RegExp => {
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

export const getCodeOwnerTeams = (
  files: GitHubFile[],
  codeownerRules: CodeOwnerRule[]
): string[] => {
  const requiredTeams = new Set<string>();

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

export const fetchPRFiles = async (prNumber: number): Promise<GitHubFile[]> => {
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

  return response.json() as Promise<GitHubFile[]>;
};

// Helper function to calculate business days between two dates (excluding weekends)
const getBusinessDays = (startDate: Date, endDate: Date): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Set both dates to midnight to ensure consistent calculation
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  let businessDays = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return businessDays;
};

export const calculateMetrics = async (
  pr: GitHubPullRequest
): Promise<PRMetrics> => {
  const createdDate = new Date(pr.created_at);
  const now = new Date();
  const age = getBusinessDays(createdDate, now);

  const [comments, reviews] = await Promise.all([
    fetchPRComments(pr.number),
    fetchPRReviews(pr.number),
  ]);

  // Get latest review from each user
  const latestReviewsByUser = reviews.reduce(
    (acc: Record<string, GitHubReview>, review) => {
      // Keep only the latest review from each user
      if (
        !acc[review.user.login] ||
        new Date(review.submitted_at) >
          new Date(acc[review.user.login].submitted_at)
      ) {
        acc[review.user.login] = review;
      }
      return acc;
    },
    {}
  );

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
  ].sort((a, b) => b.date.getTime() - a.date.getTime())[0].date;

  const staleness = getBusinessDays(lastActivity, now);

  return {
    age,
    staleness,
    isApproved,
    hasChangesRequested,
  };
};

// Helper function to format PR author name
export const formatAuthorName = (pr: GitHubPullRequest): string => {
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

export const enhancePRWithMetrics = async (
  pr: GitHubPullRequest
): Promise<GitHubPullRequest> => {
  const [metrics, files] = await Promise.all([
    calculateMetrics(pr),
    fetchPRFiles(pr.number),
  ]);
  return { ...pr, ...metrics, files };
};

export const formatPRLine = (
  pr: GitHubPullRequest,
  additionalAuthorInfo?: string
): string => {
  const authorInfo = additionalAuthorInfo
    ? `${formatAuthorName(pr)}${additionalAuthorInfo}`
    : formatAuthorName(pr);

  return `• ${pr.title.trim()} (_${authorInfo}_) - *${pr.age}d/${
    pr.staleness
  }d* (<${pr.html_url} | #${pr.number}>)`;
};

export const groupAndSortPRs = <T extends Record<string, PRStatus>>(
  prs: GitHubPullRequest[],
  statusMap: T,
  getStatus: (pr: GitHubPullRequest) => PRStatus
): Record<string, GitHubPullRequest[]> => {
  const grouped = Object.values(statusMap).reduce((acc, status) => {
    acc[status.label] = [];
    return acc;
  }, {} as Record<string, GitHubPullRequest[]>);

  prs.forEach((pr) => {
    const status = getStatus(pr);
    grouped[status.label].push(pr);
  });

  // Sort each group by staleness
  Object.values(grouped).forEach((group) => {
    group.sort((a, b) => (b.staleness || 0) - (a.staleness || 0));
  });

  return grouped;
};
