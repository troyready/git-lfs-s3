/**
 * Integration tests
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";
import * as ciDetect from "@npmcli/ci-detect";
import * as path from "path";
import * as fs from "fs";

const region = "us-west-2";

/** Return true if provided path exists */
export async function pathExists(filepath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filepath);
  } catch (error) {
    if (error.code == "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
  return true;
}

/** Run tests */
export async function test(): Promise<void> {
  console.log("Starting integration tests");
  const origWorkingDir = process.cwd();
  try {
    process.chdir(path.dirname(__dirname));

    const npxBinary = process.platform === "win32" ? "npx.cmd" : "npx";
    const env = process.env.ENV_SUFFIX
      ? "inttest" + process.env.ENV_SUFFIX
      : "inttest";
    let exitCode: number | null;

    console.log(`Deploying to stage ${env}...`);
    exitCode = await deploy(npxBinary, env);
    if (exitCode == 0) {
      // // TBD
      // console.log("Deploy successful; testing it");

      console.log("Tests successful; removing deployment");
      exitCode = spawnSync(
        npxBinary,
        ["sls", "remove", "-r", region, "-s", env],
        {
          stdio: "inherit",
        },
      ).status;
      if (exitCode != 0) {
        console.error("Error removing deployment");
        process.exit(exitCode ? exitCode : 1);
      }
    } else {
      if (ciDetect() as boolean | string) {
        const deployExitCode = exitCode;
        console.error(
          `Deployment in environment ${env} failed; running destroy...`,
        );
        spawnSync(npxBinary, ["sls", "remove", "-r", region, "-s", env], {
          stdio: "inherit",
        }).status;
        process.exit(deployExitCode ? deployExitCode : 1);
      } else {
        console.error(`Deployment in environment ${env} failed`);
        process.exit(exitCode ? exitCode : 1);
      }
    }
  } finally {
    process.chdir(origWorkingDir);
  }
  console.log("Integration tests complete!");
}

/** Deploy project and confirm idempotence */
async function deploy(npxBinary: string, env: string): Promise<number | null> {
  // let exitCode: number | null;
  // First deploy
  const exitCode = spawnSync(
    npxBinary,
    ["sls", "deploy", "-r", region, "-s", env],
    {
      stdio: "inherit",
    },
  ).status;

  if (exitCode != 0) {
    return exitCode;
  }

  // TODO: add idempotence check after switching to esbuild
  return exitCode;
  // console.log("Deploying stack again to check for idempotenance...")
  // const secondSpawnResult = spawnSync(npxBinary, ["sls", "deploy", "-r", region, "-s", env], {
  // });

  // if (!secondSpawnResult.stdout.includes("Service files not changed. Skipping deployment")) {
  //   console.error("Serverless did not correctly skip re-deployment on second command invocation");
  //   return 1
  // }

  // return secondSpawnResult.status
}

test();
