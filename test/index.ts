/**
 * Integration tests
 *
 * @packageDocumentation
 */

import { spawnSync } from "child_process";
import * as ciDetect from "@npmcli/ci-detect";
import * as path from "path";
import * as fs from "fs";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

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
        await waitForStackUpdateComplete("git-lfs-s3-" + env, region);
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

  console.log("Deploying stack again to check for idempotenance...");
  const secondSpawnResult = spawnSync(npxBinary, [
    "sls",
    "deploy",
    "-r",
    region,
    "-s",
    env,
  ]);

  if (
    !secondSpawnResult.stderr.includes(
      "No changes to deploy. Deployment skipped",
    )
  ) {
    console.error(
      "Serverless did not correctly skip re-deployment on second command invocation",
    );
    console.error("stdout: " + secondSpawnResult.stdout);
    console.error("stderr: " + secondSpawnResult.stderr);
    return 1;
  }

  return secondSpawnResult.status;
}

/** Wait for CloudFormation Stack to finish updating
 *
 * Primarily used to work around:
 * https://github.com/serverless/serverless/issues/6089
 *
 */
async function waitForStackUpdateComplete(
  stackName: string,
  region: string,
): Promise<void> {
  let stackDone = false;
  const cfnClient = new CloudFormationClient({ region: region });
  do {
    const describeStacksCommandResponse = await cfnClient.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    if (
      !describeStacksCommandResponse.Stacks ||
      !describeStacksCommandResponse.Stacks[0].StackStatus ||
      !describeStacksCommandResponse.Stacks[0].StackStatus.endsWith(
        "_IN_PROGRESS",
      )
    ) {
      stackDone = true;
    } else {
      console.log(
        "Stack still updating; waiting 10 seconds before checking again...",
      ),
        await new Promise((r) => setTimeout(r, 10000)); // sleep 10 sec
    }
  } while (stackDone == false);
}

test();
