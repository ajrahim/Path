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
  console.error("Usage: npm run push <patch|minor|major|x.y.z>");
  console.error("Example: npm run push 0.2.0");
  process.exit(1);
}

// 1. Check git status
const gitStatus = runCapture("git status --porcelain");

if (gitStatus === null) {
  console.error("Error: Not in a git repository.");
  process.exit(1);
}

// 2. Bump version across all workspace packages and sync lockfile
console.log("\n==========================================");
console.log(" 1. Bumping Version");
console.log("==========================================");
run(`node scripts/BumpVersion.mjs ${target}`);

const rootManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const newVersion = rootManifest.version;
const branchName = `release/v${newVersion}`;

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

// 5. Git Branch, Commit, and Push
console.log("\n==========================================");
console.log(` 4. Creating Branch: ${branchName}`);
console.log("==========================================");

run(`git checkout -b ${branchName}`);
run("git add .");
run(`git commit -m "chore(release): v${newVersion}"`);
run(`git push -u origin ${branchName}`);

// 6. Create Pull Request
console.log("\n==========================================");
console.log(" 5. Creating Pull Request");
console.log("==========================================");

const prTitle = `chore(release): v${newVersion}`;
const prBody = [
  "## Change",
  `Release version \`v${newVersion}\` across all workspace packages, synchronize lockfile, and verify i18n catalogs.`,
  "",
  "## Verification",
  "- `npm run check` (Prettier, ESLint, TypeScript, Architecture, Knip) passed",
  "- `npm test` (Unit and component test suite) passed",
  "- `packages/shared/messages/` i18n translation catalogs validated",
  "",
  "## Compatibility",
  "- Backward-compatible release update. No breaking schema changes.",
].join("\n");

const ghAvailable = runCapture("gh --version");

if (ghAvailable) {
  try {
    run(`gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}" --base main`);
    console.log(`\n🎉 Pull request created successfully for v${newVersion}!`);
  } catch {
    console.warn("\nWarning: gh pr create encountered an issue.");
  }
} else {
  const compareUrl = `https://github.com/ajrahim/Path/compare/main...${branchName}?expand=1&title=${encodeURIComponent(
    prTitle,
  )}&body=${encodeURIComponent(prBody)}`;

  console.log(`\n🚀 Branch pushed: ${branchName}`);
  console.log(`Open the following link to create your Pull Request in GitHub:\n`);
  console.log(`  ${compareUrl}\n`);
}
