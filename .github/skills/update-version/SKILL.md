---
name: update-version
description: "Automate release PR generation, version bumping across monorepo workspaces, i18n translation validation, code review & test suite execution, branch creation, commit, and Pull Request creation. Use when: creating a release PR, bumping versions (patch/minor/major/x.y.z), running release verification, or running npm run push."
argument-hint: "<patch|minor|major|x.y.z>"
user-invocable: true
---

# Release PR Generation Skill

Automates the complete release process:

1. **Version Bump:** Synchronizes version numbers across the monorepo root and all 7 workspace packages plus `package-lock.json`.
2. **i18n Validation:** Validates all JSON translation catalogs under `packages/shared/messages/`.
3. **Code Review & Quality:** Runs full linting, formatting, TypeScript compilation, architectural boundaries, Knip unused exports (`npm run check`), and the test suite (`npm test`).
4. **Git Branching & Commit:** Creates and checks out a `release/v<version>` branch, stages files, and commits with standard release message.
5. **PR Creation & Push:** Pushes the release branch to GitHub and opens a Pull Request using `gh pr create` (or generates a pre-filled 1-click comparison URL).

## Monorepo Workspace Manifests Synchronized

1. `package.json` (Root)
2. `apps/desktop/package.json`
3. `apps/renderer/package.json`
4. `packages/database/package.json`
5. `packages/recording-core/package.json`
6. `packages/shared/package.json`
7. `packages/timeline/package.json`
8. `packages/transcription/package.json`
9. `package-lock.json`

## Single-Command Workflow

Run the push release script with your target bump or version:

```sh
npm run push <patch|minor|major|x.y.z>
```

### Examples:

```sh
npm run push patch    # 0.1.0 -> 0.1.1
npm run push minor    # 0.1.0 -> 0.2.0
npm run push 0.2.0    # Explicit semver
```

## Step-by-Step Procedure

### 1. Version Bumping

The script calculates the target semver and updates all 8 `package.json` files, followed by `npm install --package-lock-only` to ensure lockfile synchronization.

### 2. Translation & i18n Checks

Validates all localization files under `packages/shared/messages/` (e.g. `en.json`) ensuring valid JSON structure and complete key trees.

### 3. Comprehensive Code Review

Executes:

```sh
npm run check  # prettier, eslint, typecheck, depcruise, knip
npm test       # vitest unit & component test suite
```

### 4. Git Branch & Commit

- Creates branch: `release/v<version>`
- Stages all modified files: `git add .`
- Commits: `chore(release): v<version>`
- Pushes to remote: `git push -u origin release/v<version>`

### 5. Pull Request Generation

- If GitHub CLI (`gh`) is available, executes `gh pr create` with pre-filled title and formatted description following `.github/pull_request_template.md`.
- If `gh` is not installed, generates a direct GitHub compare & PR URL for immediate one-click submission.

### 6. Tagging and Final Release

Once the PR is merged into `main`:

```sh
git checkout main
git pull
git tag -a v<version> -m "Release v<version>"
git push origin v<version>
```

Pushing the tag (`v*`) triggers [.github/workflows/release.yml](../../workflows/release.yml) to package the Windows `.exe` installer and publish the GitHub Release automatically.

```sh
git push origin main
git push origin v<version>
```

Pushing the tag (`v*`) automatically triggers [.github/workflows/release.yml](../../workflows/release.yml) on GitHub Actions to:

1. Build Next.js static export and Electron desktop bundles
2. Package Windows NSIS `.exe` installer via `electron-builder`
3. Publish the release with installer artifacts on GitHub Releases

## Troubleshooting

- **Native Binary Locks on Windows:** If `npm test` fails with `EBUSY` on `better_sqlite3.node`, ensure running Electron desktop instances or background dev processes are closed before running tests.
- **Tag Already Exists:** If a tag already exists locally or remotely, verify with `git tag` before creating a new tag.
