import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const workspaceManifests = [
  "package.json",
  "apps/desktop/package.json",
  "apps/renderer/package.json",
  "packages/database/package.json",
  "packages/recording-core/package.json",
  "packages/shared/package.json",
  "packages/timeline/package.json",
  "packages/transcription/package.json",
];

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);

  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function computeNextVersion(currentVersion, bumpType) {
  const parsed = parseSemver(currentVersion);

  if (!parsed) {
    throw new Error(`Current version is not valid semver: ${currentVersion}`);
  }

  const exactParsed = parseSemver(bumpType.replace(/^v/, ""));

  if (exactParsed) {
    return bumpType.replace(/^v/, "");
  }

  switch (bumpType.toLowerCase()) {
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;

    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;

    case "major":
      return `${parsed.major + 1}.0.0`;

    default:
      throw new Error(
        `Invalid bump type or semver: "${bumpType}". Expected "patch", "minor", "major", or explicit semver (e.g. "0.2.0").`,
      );
  }
}

const target = process.argv[2];

if (!target) {
  console.error("Usage: node scripts/BumpVersion.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}

const rootManifestPath = resolve("package.json");
const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
const currentVersion = rootManifest.version || "0.1.0";
const nextVersion = computeNextVersion(currentVersion, target);

console.log(`Bumping workspace versions: ${currentVersion} -> ${nextVersion}`);

for (const relativePath of workspaceManifests) {
  const filePath = resolve(relativePath);
  const content = JSON.parse(readFileSync(filePath, "utf8"));

  content.version = nextVersion;
  writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  console.log(`  Updated ${relativePath}`);
}

console.log("Synchronizing package-lock.json...");

try {
  execSync("npm install --package-lock-only", { stdio: "inherit" });
} catch {
  console.warn("Warning: npm install --package-lock-only failed. Ensure lockfile is updated.");
}

console.log(`\nSuccessfully bumped version to v${nextVersion}!`);
console.log("\nNext steps:");
console.log(`  1. npm run check`);
console.log(`  2. git add .`);
console.log(`  3. git commit -m "chore(release): v${nextVersion}"`);
console.log(`  4. git tag -a v${nextVersion} -m "Release v${nextVersion}"`);
console.log(`  5. git push origin main && git push origin v${nextVersion}`);
