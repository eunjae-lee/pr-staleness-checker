# PR Staleness Checker

A TypeScript application to check PR staleness and status for GitHub repositories.

## Features

- **TypeScript Support**: Full TypeScript implementation with type safety
- **Two Analysis Modes**: 
  - `team.ts`: Team-focused PR analysis
  - `whole.ts`: Organization-wide PR analysis
- **ES Modules**: Modern JavaScript module system
- **Modular Architecture**: Shared code extracted to `common.ts`
- **Build System**: Automatic compilation and bundling to self-contained `.mjs` files

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- GitHub Personal Access Token

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Configuration:**
   Create a `.env` file in the root directory with:
   ```env
   GITHUB_TOKEN=your_github_token_here
   TEAM_NAME=your_team_name
   TEAM_MEMBERS=user1,user2,user3
   INCLUDE_DEVIN=true
   ```

## Scripts

### Development Scripts (TypeScript)
- `npm run dev` - Run team analysis in development mode (default)
- `npm run dev:team` - Run team analysis in development mode
- `npm run dev:whole` - Run organization-wide analysis in development mode

### Build Scripts
- `npm run build` - Compile TypeScript to JavaScript and bundle common code
- `npm run clean` - Remove the dist directory

## Project Structure

```
├── src/                    # TypeScript source files
│   ├── common.ts          # Shared interfaces, functions, and utilities
│   ├── team.ts            # Team-focused analysis
│   └── whole.ts           # Organization-wide analysis
├── dist/                  # Compiled JavaScript files (generated)
│   ├── team.mjs           # Self-contained team analysis
│   └── whole.mjs          # Self-contained organization analysis
├── scripts/               # Build utilities
│   └── post-build.js      # Post-build processing and bundling
├── tsconfig.json          # TypeScript configuration
└── package.json           # Package configuration
```

## Build Process

The build process consists of:

1. **TypeScript Compilation**: `tsc` compiles `.ts` files to `.js` files in the `dist/` directory
2. **File Renaming**: Renames `.js` files to `.mjs` for ES module compatibility
3. **Code Bundling**: Inlines shared code from `common.ts` into the final output files
4. **Cleanup**: Removes intermediate files, creating self-contained `.mjs` files

The final output files have no dependencies on each other and contain all necessary code.

## Architecture

### Shared Code (`common.ts`)
Contains all shared functionality:
- **Constants**: GitHub API endpoints, authentication tokens
- **Interfaces**: TypeScript interfaces for GitHub API responses
- **Core Functions**: API calls, data processing, utility functions

### Team Analysis (`team.ts`)
- Team-specific PR filtering logic
- Community PR detection for team code ownership
- Team-focused status reporting

### Organization Analysis (`whole.ts`)
- Organization-wide PR analysis
- Priority-based categorization
- Foundation/Platform/Consumer team routing

## TypeScript Features

- **Strict Type Checking**: Full type safety enabled
- **Interface Definitions**: Comprehensive GitHub API response types
- **Generic Types**: Type-safe collections and operations
- **Modern ES2022 Target**: Latest JavaScript features
- **Source Maps**: Full debugging support
- **Modular Design**: Clean separation of concerns

## Key Interfaces

The application includes comprehensive TypeScript interfaces for:

- `GitHubUser` - GitHub user information
- `GitHubPullRequest` - Pull request data with extended metrics
- `GitHubReview` - PR review information
- `GitHubComment` - PR comments
- `GitHubFile` - File change information
- `CodeOwnerRule` - CODEOWNERS parsing
- `PRMetrics` - Calculated PR metrics

## Usage Examples

### Development Mode
```bash
# Run team analysis (default)
npm run dev

# Run team analysis
npm run dev:team

# Run organization-wide analysis
npm run dev:whole
```

### Production Mode
```bash
# Build and run team analysis
npm run build
node dist/team.mjs

# Run organization-wide analysis
node dist/whole.mjs
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | Yes |
| `TEAM_NAME` | Name of the team for filtering | Yes |
| `TEAM_MEMBERS` | Comma-separated list of team member usernames | Yes |
| `INCLUDE_DEVIN` | Whether to include Devin AI PRs (true/false) | No |

## Migration from JavaScript

The original `.mjs` files have been converted to TypeScript with:
- Added comprehensive type annotations
- Interface definitions for all API responses
- Type-safe error handling
- Generic type parameters for collections
- Proper async/await typing
- Extracted shared code into a common module
- Self-contained bundled output files

The compiled output maintains the same functionality while providing development-time type safety and improved maintainability. 