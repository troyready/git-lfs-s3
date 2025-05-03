/**
 * Script for generating new release
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as chalk from "chalk";
import * as path from "path";
import * as promptSync from "prompt-sync";
import { spawnSync } from "child_process";

const repoName = "troyready/git-lfs-s3";
const rootPath = path.dirname(__dirname);
const changelogFilePath = path.join(rootPath, "CHANGELOG.md");
const packageJsonFilePath = path.join(rootPath, "package.json");
const prompt = promptSync();

/** Create GitHub release */
async function createRelease() {
  const oldChangelog = (
    await fs.promises.readFile(changelogFilePath)
  ).toString();
  const unreleasedRegex = new RegExp(
    /^## \[Unreleased\]\n(.*?)\n\n## \[/,
    "ms",
  );
  const versionRegex = new RegExp(
    /^## \[Unreleased\]\n.*?\n\n## \[([.0-9]*)\]/,
    "ms",
  );
  const releaseNotesMatch = unreleasedRegex.exec(oldChangelog);
  const versionMatch = versionRegex.exec(oldChangelog);
  let exitCode: number | null;
  let releaseNotes = "";
  let currentVersion = "";

  console.log("Checking GitHub CLI login status...");
  exitCode = spawnSync("gh", ["auth", "status"], { stdio: "inherit" }).status;
  if (exitCode != 0) {
    console.log(
      chalk.red(
        "ERROR: Log into GitHub CLI first (gh auth login --skip-ssh-key)",
      ),
    );
    process.exit(exitCode ? exitCode : 1);
  }

  if (releaseNotesMatch != null && versionMatch != null) {
    releaseNotes = releaseNotesMatch[1];
    currentVersion += versionMatch[1];
    console.log(chalk.blue("Unreleased changes are:"));
    console.log();
    console.log(releaseNotes);
    console.log();
    console.log(
      chalk.blue("Current (about to be previous) version was: ") +
        currentVersion,
    );
    console.log();

    const newVersion = prompt(`What should the new version be? `);

    if (newVersion == null || !/[0-9]*\.[0-9]*\.[0-9]*/.test(newVersion)) {
      console.log(chalk.red('ERROR: enter version in the form of "X.X.X"'));
      process.exit(1);
    }

    console.log();
    console.log("Updating package version to " + newVersion);
    const packageContents = (
      await fs.promises.readFile(packageJsonFilePath)
    ).toString();
    await fs.promises.writeFile(
      packageJsonFilePath,
      packageContents.replace(
        /^ {2}"version": ".*",/gm,
        `  "version": "${newVersion}",`,
      ),
    );
    exitCode = spawnSync("npm", ["i"], {
      cwd: rootPath,
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      process.exit(exitCode ? exitCode : 1);
    }

    const dateString = generateDateString(new Date());
    await fs.promises.writeFile(
      changelogFilePath,
      oldChangelog
        .replace(
          /^## \[Unreleased\]/gm,
          `## [Unreleased]\n\n## [${newVersion}] - ${dateString}`,
        )
        .replace(
          /^\[Unreleased\]: .*\.\.\.HEAD$/gm,
          `[Unreleased]: https://github.com/${repoName}/compare/v${newVersion}...HEAD\n[${newVersion}]: https://github.com/${repoName}/compare/v${currentVersion}...v${newVersion}`,
        ),
    );

    console.log("Generating git commit...");
    exitCode = spawnSync(
      "git",
      ["commit", "-a", "-S", "-m", "v" + newVersion],
      {
        cwd: rootPath,
        stdio: "inherit",
      },
    ).status;
    if (exitCode != 0) {
      console.log(
        chalk.red(
          "ERROR: Failed to create git commit; reverting CHANGELOG update",
        ),
      );
      spawnSync("git", ["checkout", "CHANGELOG.md"], {
        cwd: rootPath,
        stdio: "inherit",
      });
      process.exit(exitCode ? exitCode : 1);
    }

    console.log("Pushing release commit...");
    exitCode = spawnSync("git", ["push"], {
      cwd: rootPath,
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      console.log(chalk.red("ERROR: Failed to push git commit"));
      process.exit(exitCode ? exitCode : 1);
    }

    console.log("Generating GitHub release...");
    exitCode = spawnSync(
      "gh",
      ["release", "create", `v${newVersion}`, "--notes", releaseNotes],
      {
        cwd: rootPath,
        stdio: "inherit",
      },
    ).status;
    if (exitCode != 0) {
      console.log(chalk.red("ERROR: Failed to create GitHub release"));
      process.exit(exitCode ? exitCode : 1);
    }

    console.log("Fetching new tag from GitHub...");
    exitCode = spawnSync("git", ["fetch"], {
      cwd: rootPath,
      stdio: "inherit",
    }).status;
    if (exitCode != 0) {
      console.log(chalk.red("ERROR: Failed to fetch from GitHub"));
      process.exit(exitCode ? exitCode : 1);
    }
  } else {
    console.error(chalk.red("ERROR: Could not find Unreleased changes"));
    process.exit(1);
  }
}

createRelease();

/** Generate date string */
function generateDateString(d: Date): string {
  function pad(num: number) {
    return num < 10 ? "0" + num : num;
  }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
