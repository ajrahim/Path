import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

function run(command, options = {}) {
  console.log(`\n> ${command}`);

  return execSync(command, { stdio: "inherit", ...options });
}

function runCapture(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function validateTranslations() {
  console.log("\nChecking translation files (i18n)...");
  const messagesDir = resolve("packages/shared/messages");
  const files = readdirSync(messagesDir).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const filePath = join(messagesDir, file);
    const content = readFileSync(filePath, "utf8");

    try {
      const parsed = JSON.parse(content);
      const keys = Object.keys(parsed);

      console.log(`  ✓ ${file} is valid JSON (${keys.length} top-level message sections)`);
    } catch (error) {
      throw new Error(`Invalid JSON in translation file ${file}: ${error.message}`);
    }
  }
}

const target = process.argv[2];

if (!target) {
  console.error("Usage: npm run push <patch|minor|major|x.y.z> (or npm run release <target>)");
  console.error("Example: npm run push 0.3.0");
  process.exit(1);
}

// 1. Check git repository status
const gitStatus = runCapture("git status --porcelain");

if (gitStatus === null) {
  console.error("Error: Not in a git repository.");
  process.exit(1);
}

// 2. Bump version across all workspace packages and sync lockfile
console.log("\n==========================================");
console.log(" 1. Bumping Version Across Monorepo");
console.log("==========================================");
run(`node scripts/BumpVersion.mjs ${target}`);

const rootManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const newVersion = rootManifest.version;
const tagName = `v${newVersion}`;

// 3. Validate translations
console.log("\n==========================================");
console.log(" 2. Validating i18n Translations");
console.log("==========================================");
validateTranslations();

// 4. Code Review & Quality Checks
console.log("\n==========================================");
console.log(" 3. Running Code Review & Quality Suite");
console.log("==========================================");
run("npm run check");
run("npm test");

// 5. Git Commit and Tag
console.log("\n==========================================");
console.log(` 4. Committing and Tagging: ${tagName}`);
console.log("==========================================");

run("git add .");
run(`git commit -m "chore(release): ${tagName}"`);

// If tag exists locally, delete it first to ensure clean state
const existingTag = runCapture(`git tag -l ${tagName}`);

if (existingTag) {
  run(`git tag -d ${tagName}`);
}

run(`git tag -a ${tagName} -m "Release ${tagName}"`);

// 6. Push Commit and Tag to GitHub
console.log("\n==========================================");
console.log(" 5. Pushing to GitHub (Triggering Release Build)");
console.log("==========================================");

run("git push origin HEAD");
run(`git push origin ${tagName}`);

console.log("\n==========================================");
console.log(`🎉 Successfully published ${tagName}!`);
console.log("==========================================");
console.log(`GitHub Actions is now packaging Path-${newVersion}.exe and creating the release.`);
console.log(`Track build: https://github.com/ajrahim/Path/actions`);
console.log(`View release: https://github.com/ajrahim/Path/releases/tag/${tagName}\n`);
