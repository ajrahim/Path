---
name: update-version
description: "Update project and monorepo workspace versions, synchronize lockfiles, run quality checks, and publish git release tags. Use when: bumping version, releasing a new version, updating semver (patch/minor/major), creating release tags, or preparing package releases."
argument-hint: "<patch|minor|major|x.y.z>"
user-invocable: true
---

# Update Version Skill

Automates bumping the semantic version across the Path monorepo root and all workspace packages, synchronizing lockfiles, running validation suites, and publishing GitHub release tags.

## When to Use

- Bumping semantic version for patch, minor, or major releases
- Synchronizing version numbers across all monorepo packages (`apps/*`, `packages/*`)
- Preparing and tagging a new release for GitHub Actions CI/CD release workflow

## Monorepo Workspace Manifests

When updating the version, all 8 manifests are kept aligned:

1. `package.json` (Root)
2. `apps/desktop/package.json`
3. `apps/renderer/package.json`
4. `packages/database/package.json`
5. `packages/recording-core/package.json`
6. `packages/shared/package.json`
7. `packages/timeline/package.json`
8. `packages/transcription/package.json`
9. `package-lock.json`

## Procedure

### 1. Determine Target Version

Choose one of:

- `patch`: Bug fixes and minor tweaks (e.g. `0.1.0` -> `0.1.1`)
- `minor`: New backwards-compatible features (e.g. `0.1.0` -> `0.2.0`)
- `major`: Breaking changes (e.g. `0.1.0` -> `1.0.0`)
- Explicit semver string (e.g. `0.2.0`, `1.0.0`)

### 2. Execute Version Bump

Run the repository version script:

```sh
npm run version:bump <patch|minor|major|x.y.z>
```

_(or `node scripts/BumpVersion.mjs <target>`)_

This automatically:

- Validates the target semver
- Updates `"version"` across all workspace `package.json` files
- Synchronizes `package-lock.json` via `npm install --package-lock-only`

### 3. Verify Code Quality and Tests

Ensure all workspace packages typecheck, lint, pass architecture rules, and pass the test suite:

```sh
npm run check
npm test
```

### 4. Commit and Tag Release

Commit the version changes and create an annotated git tag:

```sh
git add .
git commit -m "chore(release): v<version>"
git tag -a v<version> -m "Release v<version>"
```

### 5. Push to GitHub

Push the main branch and the release tag:

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
