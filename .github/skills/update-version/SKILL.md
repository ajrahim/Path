---
name: update-version
description: "Automate release generation, version bumping across monorepo workspaces, i18n translation validation, code review & test suite execution, git commit, tag creation, and GitHub Release deployment. Use when: bumping versions (patch/minor/major/x.y.z), creating releases, running release verification, or running npm run push / npm run release."
argument-hint: "<patch|minor|major|x.y.z>"
user-invocable: true
---

# Release and Versioning Skill

Automates the complete release process:

1. **Version Bump:** Synchronizes version numbers across the monorepo root and all 7 workspace packages plus `package-lock.json`.
2. **i18n Validation:** Validates all JSON translation catalogs under `packages/shared/messages/`.
3. **Code Review & Quality:** Runs full linting, formatting, TypeScript compilation, architectural boundaries, Knip unused exports (`npm run check`), and the test suite (`npm test`).
4. **Git Commit & Tag:** Stages all files, commits with `chore(release): v<version>`, and creates annotated git tag `v<version>`.
5. **Push & GitHub Release:** Pushes the commit and git tag to GitHub, which automatically triggers [.github/workflows/release.yml](../../workflows/release.yml) on GitHub Actions to build `Path-<version>.exe` and publish the GitHub Release with the source `.zip` and `.exe` installer.

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

Run the release script with your target bump or version:

```sh
npm run push <patch|minor|major|x.y.z>
# or
npm run release <patch|minor|major|x.y.z>
```

### Examples:

```sh
npm run push patch    # 0.3.0 -> 0.3.1
npm run push minor    # 0.3.0 -> 0.4.0
npm run push 0.3.0    # Tag and release specific version
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

### 4. Git Commit & Tagging

- Stages all modified files: `git add .`
- Commits: `chore(release): v<version>`
- Creates annotated tag: `git tag -a v<version> -m "Release v<version>"`

### 5. Remote Push & GitHub Actions Release

- Pushes commit: `git push origin HEAD`
- Pushes tag: `git push origin v<version>`
- The tag push (`v*`) automatically triggers the **Release** workflow on GitHub Actions to package the Windows `.exe` installer and attach it directly to the GitHub Release.

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
