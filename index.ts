/**
 * Pulumi infrastructure definition
 *
 * @packageDocumentation
 */

import * as aws from "@pulumi/aws";
import * as fs from "node:fs";
import * as path from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { build } from "vite";
import { fileURLToPath } from "url";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const accountId = (await aws.getCallerIdentity()).accountId;
const lambdaRuntime = await getDevEnginesNodeVersion();
const partition = (await aws.getPartition()).id;
const region = (await aws.getRegion()).region;
const stack = pulumi.getStack();

const storageBucket = new aws.s3.Bucket("storage", {
  bucket: `git-lfs-s3-${stack}-${accountId}-${region}-an`,
  bucketNamespace: "account-regional",
});
new aws.s3.BucketLifecycleConfiguration("storage", {
  bucket: storageBucket.bucket,
  rules: [
    {
      abortIncompleteMultipartUpload: {
        daysAfterInitiation: 1,
      },
      id: "AbortIncompleteMultipartUploads",
      status: "Enabled",
    },
  ],
});
export const storageBucketName = storageBucket.bucket;

const tableIdIndexName = "IdIndex";
const lockTable = new aws.dynamodb.Table("lockTable", {
  billingMode: "PAY_PER_REQUEST",
  hashKey: "path",
  attributes: [
    { name: "path", type: "S" },
    { name: "id", type: "S" },
  ],
  globalSecondaryIndexes: [
    {
      keySchemas: [
        {
          attributeName: "id",
          keyType: "HASH",
        },
      ],
      name: tableIdIndexName,
      projectionType: "ALL",
    },
  ],
  name: `git-lfs-s3-${stack}-lock`,
});
export const lockTableName = lockTable.name;

const userPool = new aws.cognito.UserPool("userPool", {
  adminCreateUserConfig: {
    allowAdminCreateUserOnly: true,
  },
});
export const userPoolId = userPool.id;

const userPoolClient = new aws.cognito.UserPoolClient("userPoolClient", {
  explicitAuthFlows: ["ADMIN_NO_SRP_AUTH"],
  generateSecret: false,
  supportedIdentityProviders: ["COGNITO"],
  userPoolId: userPool.id,
});
export const userPoolClientId = userPoolClient.id;

const batchLogGroup = new aws.cloudwatch.LogGroup("batch", {
  name: `/aws/lambda/git-lfs-s3-${stack}-batch`,
  retentionInDays: 30,
});
const batchRole = new aws.iam.Role("batch", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
  inlinePolicies: [
    lambdaLoggingPolicy(batchLogGroup),
    {
      name: "s3-permissions",
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ["s3:ListBucket"],
            effect: "Allow",
            resources: [storageBucket.arn],
          },
          {
            actions: ["s3:GetObject", "s3:PutObject"],
            effect: "Allow",
            resources: [pulumi.interpolate`${storageBucket.arn}/*`],
          },
        ],
      }).json,
    },
  ],
  namePrefix: `git-lfs-s3-${stack}-batch-`,
});

const batchFunc = new aws.lambda.Function("batch", {
  architectures: ["arm64"],
  code: new pulumi.asset.FileArchive(
    await buildFunction("batch", "handler", lambdaRuntime),
  ),
  description: "Batch (main) function for Git LFS S3 API",
  environment: {
    variables: {
      NODE_OPTIONS: "--enable-source-maps",
      BUCKET_NAME: storageBucket.bucket,
    },
  },
  handler: "handler.handler",
  loggingConfig: {
    logFormat: "JSON",
    logGroup: batchLogGroup.name,
  },
  memorySize: 512,
  name: `git-lfs-s3-${stack}-batch`,
  role: batchRole.arn,
  runtime: lambdaRuntime,
  timeout: 6,
});

const locksLogGroup = new aws.cloudwatch.LogGroup("locks", {
  name: `/aws/lambda/git-lfs-s3-${stack}-locks`,
  retentionInDays: 30,
});
const locksRole = new aws.iam.Role("locks", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
  inlinePolicies: [
    lambdaLoggingPolicy(locksLogGroup),
    {
      name: "dynamodb-permissions",
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: [
              "dynamodb:DeleteItem",
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:Query",
              "dynamodb:Scan",
            ],
            effect: "Allow",
            resources: [lockTable.arn],
          },
          {
            actions: ["dynamodb:Query"],
            effect: "Allow",
            resources: [pulumi.interpolate`${lockTable.arn}/index/*`],
          },
        ],
      }).json,
    },
  ],
  namePrefix: `git-lfs-s3-${stack}-locks-`,
});
const locksFunc = new aws.lambda.Function("locks", {
  architectures: ["arm64"],
  code: new pulumi.asset.FileArchive(
    await buildFunction("locks", "handler", lambdaRuntime),
  ),
  description: "Locks function for Git LFS S3 API",
  environment: {
    variables: {
      ID_INDEX_NAME: tableIdIndexName,
      NODE_OPTIONS: "--enable-source-maps",
      TABLE_NAME: lockTable.name,
    },
  },
  handler: "handler.handler",
  loggingConfig: {
    logFormat: "JSON",
    logGroup: locksLogGroup.name,
  },
  memorySize: 1024,
  name: `git-lfs-s3-${stack}-locks`,
  role: locksRole.arn,
  runtime: lambdaRuntime,
  timeout: 6,
});

const completeMultipartUploadLogGroup = new aws.cloudwatch.LogGroup(
  "completeMultipartUpload",
  {
    name: `/aws/lambda/git-lfs-s3-${stack}-completemultipartupload`,
    retentionInDays: 30,
  },
);
const completeMultipartUploadRole = new aws.iam.Role(
  "completeMultipartUpload",
  {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com",
    }),
    inlinePolicies: [
      lambdaLoggingPolicy(completeMultipartUploadLogGroup),
      {
        name: "s3-permissions",
        policy: aws.iam.getPolicyDocumentOutput({
          statements: [
            {
              actions: ["s3:PutObject"],
              effect: "Allow",
              resources: [pulumi.interpolate`${storageBucket.arn}/*`],
            },
            {
              actions: ["s3:DeleteObject", "s3:GetObject"],
              effect: "Allow",
              resources: [
                pulumi.interpolate`${storageBucket.arn}/*.multipartuploadcomplete`,
              ],
            },
          ],
        }).json,
      },
    ],
    namePrefix: `git-lfs-s3-${stack}-completemultipartup-`,
  },
);
const completeMultipartUploadFunc = new aws.lambda.Function(
  "completeMultipartUpload",
  {
    architectures: ["arm64"],
    code: new pulumi.asset.FileArchive(
      await buildFunction("completemultipartupload", "handler", lambdaRuntime),
    ),
    description: "Complete multipart upload function for Git LFS S3 API",
    environment: {
      variables: {
        NODE_OPTIONS: "--enable-source-maps",
      },
    },
    handler: "handler.handler",
    loggingConfig: {
      logFormat: "JSON",
      logGroup: completeMultipartUploadLogGroup.name,
    },
    memorySize: 512,
    name: `git-lfs-s3-${stack}-completemultipartupload`,
    role: completeMultipartUploadRole.arn,
    runtime: lambdaRuntime,
    timeout: 900,
  },
);

const authorizerLogGroup = new aws.cloudwatch.LogGroup("authorizer", {
  name: `/aws/lambda/git-lfs-s3-${stack}-authorizer`,
  retentionInDays: 30,
});
const authorizerRole = new aws.iam.Role("authorizer", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
  inlinePolicies: [
    lambdaLoggingPolicy(authorizerLogGroup),
    {
      name: "cognito-permissions",
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            actions: ["cognito-idp:AdminInitiateAuth"],
            effect: "Allow",
            resources: [userPool.arn],
          },
        ],
      }).json,
    },
  ],
  namePrefix: `git-lfs-s3-${stack}-authorizer-`,
});
const authorizerFunc = new aws.lambda.Function("authorizer", {
  architectures: ["arm64"],
  code: new pulumi.asset.FileArchive(
    await buildFunction("authorizer", "handler", lambdaRuntime),
  ),
  description: "Authorizer function for Git LFS S3 API",
  environment: {
    variables: {
      NODE_OPTIONS: "--enable-source-maps",
      USER_POOL_ID: userPool.id,
      USER_POOL_CLIENT_ID: userPoolClient.id,
    },
  },
  handler: "handler.handler",
  loggingConfig: {
    logFormat: "JSON",
    logGroup: authorizerLogGroup.name,
  },
  memorySize: 1024,
  name: `git-lfs-s3-${stack}-authorizer`,
  role: authorizerRole.arn,
  runtime: lambdaRuntime,
  timeout: 6,
});

const api = new aws.apigatewayv2.Api("api", {
  description: `Git LFS S3 API (${stack})`,
  name: `git-lfs-s3-${stack}`,
  protocolType: "HTTP",
});
export const apiEndpoint = api.apiEndpoint;

const apiAuthorizer = new aws.apigatewayv2.Authorizer("authorizer", {
  apiId: api.id,
  authorizerPayloadFormatVersion: "2.0",
  authorizerType: "REQUEST",
  authorizerUri: pulumi.interpolate`arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${authorizerFunc.arn}/invocations`,
  enableSimpleResponses: true,
});

new aws.lambda.Permission("batchLambdaPerm", {
  action: "lambda:InvokeFunction",
  function: batchFunc.name,
  principal: "apigateway.amazonaws.com",
  sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
});

const batchIntegration = new aws.apigatewayv2.Integration("batchIntegration", {
  apiId: api.id,
  integrationType: "AWS_PROXY",
  integrationMethod: "POST",
  integrationUri: pulumi.interpolate`arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${batchFunc.arn}/invocations`,
  payloadFormatVersion: "2.0",
});

const batchRoute = new aws.apigatewayv2.Route("batchRoute", {
  apiId: api.id,
  authorizerId: apiAuthorizer.id,
  authorizationType: "CUSTOM",
  routeKey: "POST /objects/batch",
  target: pulumi.interpolate`integrations/${batchIntegration.id}`,
});

new aws.lambda.Permission("locksLambdaPerm", {
  action: "lambda:InvokeFunction",
  function: locksFunc.name,
  principal: "apigateway.amazonaws.com",
  sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
});

const locksPostIntegration = new aws.apigatewayv2.Integration(
  "locksPostIntegration",
  {
    apiId: api.id,
    integrationMethod: "POST",
    integrationType: "AWS_PROXY",
    integrationUri: pulumi.interpolate`arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${locksFunc.arn}/invocations`,
    payloadFormatVersion: "2.0",
  },
);

const locksPostRoute = new aws.apigatewayv2.Route("locksPostRoute", {
  apiId: api.id,
  authorizerId: apiAuthorizer.id,
  authorizationType: "CUSTOM",
  routeKey: "POST /locks",
  target: pulumi.interpolate`integrations/${locksPostIntegration.id}`,
});

const locksGetIntegration = new aws.apigatewayv2.Integration(
  "locksGetIntegration",
  {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationMethod: "POST",
    integrationUri: pulumi.interpolate`arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${locksFunc.arn}/invocations`,
    payloadFormatVersion: "2.0",
  },
);

const locksGetRoute = new aws.apigatewayv2.Route("locksGetRoute", {
  apiId: api.id,
  authorizerId: apiAuthorizer.id,
  authorizationType: "CUSTOM",
  routeKey: "GET /locks",
  target: pulumi.interpolate`integrations/${locksGetIntegration.id}`,
});

const locksProxyIntegration = new aws.apigatewayv2.Integration(
  "locksProxyIntegration",
  {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationMethod: "POST",
    integrationUri: pulumi.interpolate`arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${locksFunc.arn}/invocations`,
    payloadFormatVersion: "2.0",
  },
);

const locksProxyRoute = new aws.apigatewayv2.Route("locksProxyRoute", {
  apiId: api.id,
  authorizerId: apiAuthorizer.id,
  authorizationType: "CUSTOM",
  routeKey: "POST /locks/{proxy+}",
  target: pulumi.interpolate`integrations/${locksProxyIntegration.id}`,
});

new aws.lambda.Permission("authorizerLambdaPerm", {
  action: "lambda:InvokeFunction",
  function: authorizerFunc.name,
  principal: "apigateway.amazonaws.com",
  sourceArn: pulumi.interpolate`${api.executionArn}/authorizers/${apiAuthorizer.id}`,
});

const httpApiDeployment = new aws.apigatewayv2.Deployment(
  "deployment",
  {
    apiId: api.id,
    description: "Main deployment for Git LFS S3 API",
  },
  {
    dependsOn: [
      apiAuthorizer,
      batchIntegration,
      batchRoute,
      locksGetIntegration,
      locksGetRoute,
      locksPostIntegration,
      locksPostRoute,
      locksProxyIntegration,
      locksProxyRoute,
    ],
  },
);

new aws.apigatewayv2.Stage("default", {
  apiId: api.id,
  autoDeploy: true,
  deploymentId: httpApiDeployment.id,
  description: "Primary stage",
  name: "$default",
});

new aws.s3.BucketNotification(
  "storageBucketCompleteMultipartUploadNotification",
  {
    bucket: storageBucket.id,
    lambdaFunctions: [
      {
        lambdaFunctionArn: completeMultipartUploadFunc.arn,
        events: ["s3:ObjectCreated:Put"],
        filterPrefix: ".multipartuploadcomplete",
      },
    ],
  },
);

new aws.lambda.Permission("s3InvokeCompleteMultipartUploadFunc", {
  action: "lambda:InvokeFunction",
  function: completeMultipartUploadFunc.name,
  principal: "s3.amazonaws.com",
  sourceAccount: accountId,
});

// Helper functions

/** Build Lambda Function bundle with vite. */
async function buildFunction(
  functionDirName: string,
  functionHandlerFilename: string,
  runtime: string,
): Promise<string> {
  const functionSrcPath = path.join(__dirname, "src", functionDirName);
  const entryPath = path.join(functionSrcPath, `${functionHandlerFilename}.ts`);
  const outDir = path.join(__dirname, "dist", functionDirName);

  await build({
    configFile: false,
    build: {
      emptyOutDir: true,
      lib: {
        entry: entryPath,
        formats: ["es"],
        fileName: () => "handler.mjs",
      },
      minify: true,
      outDir,
      rollupOptions: {
        output: {
          entryFileNames: "handler.mjs",
          format: "es",
        },
        plugins: [nodeResolve()],
      },
      sourcemap: true,
      ssr: entryPath,
      target: runtime.replace(/nodejs(\d+)\.x/i, "node$1"), // e.g. nodejs##.x to node##
    },
    logLevel: "warn", // regular info output will obscure pulumi change info
    root: functionSrcPath,
    ssr: {
      noExternal: true,
    },
  });
  return outDir;
}

/** Adapt NodeJS version from package.json devEngines to AWS Lambda Runtime version
 * Using devEngines allows automatic installation by pnpm https://pnpm.io/package_json#devenginesruntime
 * and setup-node on Github Actions https://github.com/actions/setup-node/issues/1255
 *
 * e.g. devEngines.runtime.version "24.16.0" will return nodejs24.x
 */
async function getDevEnginesNodeVersion(): Promise<aws.lambda.Runtime> {
  const packageJson = await fs.promises.readFile(
    path.join(__dirname, "package.json"),
    "utf8",
  );
  const { devEngines } = JSON.parse(packageJson);
  const runtime = devEngines?.runtime;
  const runtimeEntry = Array.isArray(runtime)
    ? runtime.find((r: { name?: string }) => r?.name === "node")
    : runtime?.name === "node"
      ? runtime
      : undefined;
  const version = runtimeEntry?.version;
  if (!version) {
    throw new Error(
      "Invalid NodeJS version in package.json devEngines.runtime.version",
    );
  }
  const majorMatch = version.match(/(\d+)/);
  if (!majorMatch) {
    throw new Error(
      `Unable to parse major version from devEngines.runtime.version: ${version}`,
    );
  }
  const runtimeVersion = `nodejs${majorMatch[1]}.x`;
  function isValidLambdaRuntime(v: string): v is aws.lambda.Runtime {
    return Object.values(aws.lambda.Runtime).includes(v as aws.lambda.Runtime);
  }
  if (!isValidLambdaRuntime(runtimeVersion)) {
    throw new Error(
      `Unable to find valid Pulumi AWS Lambda NodeJS version: ${runtimeVersion}. ` +
        `Available NodeJS versions are: ${Object.keys(aws.lambda.Runtime)
          .filter((k) => k.startsWith("NodeJS"))
          .join(", ")}`,
    );
  }
  return runtimeVersion;
}

/** Generate basic Lambda function logging policy */
function lambdaLoggingPolicy(logGroup: aws.cloudwatch.LogGroup) {
  return {
    name: "lambda-logging",
    policy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          actions: ["logs:CreateLogGroup"],
          effect: "Allow",
          resources: [logGroup.arn],
        },
        {
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          effect: "Allow",
          resources: [pulumi.interpolate`${logGroup.arn}:*`],
        },
      ],
    }).json,
  };
}
