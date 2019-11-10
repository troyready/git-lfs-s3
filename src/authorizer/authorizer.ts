/**
 * HTTP Basic Auth authorizer
 */

/** imports (delete comment after https://github.com/TypeStrong/typedoc/issues/603 resolution) */
import {
  Context,
  CustomAuthorizerEvent,
  CustomAuthorizerHandler,
  CustomAuthorizerResult,
  PolicyDocument,
} from "aws-lambda";
import { CognitoIdentityServiceProvider } from "aws-sdk";
import "source-map-support/register";

const userPoolId = process.env.USER_POOL_ID;
const userPoolClientId = process.env.USER_POOL_CLIENT_ID;
const cognitoIdpClient = new CognitoIdentityServiceProvider({
  apiVersion: "2016-04-18",
});

/** Adapt the event methodArn to an IAM policy */
function generateInvokePolicy(
  event: CustomAuthorizerEvent,
  principal: string,
): { policyDocument: PolicyDocument; principalId: string } {
  const methodArnSections = event.methodArn.split(":");
  const stageAndApiArn = methodArnSections[5].split("/");
  const apiArn =
    "arn:aws:execute-api:" +
    methodArnSections[3] + // region
    ":" +
    methodArnSections[4] + // accountId
    ":" +
    stageAndApiArn[0] + // restapiId
    "/" +
    stageAndApiArn[1] + // stage
    "/*/*";
  const policy = {
    policyDocument: {
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: [apiArn],
        },
      ],
      Version: "2012-10-17",
    },
    principalId: principal,
  };
  return policy;
}

/** Validate user credentials */
async function validateUser(
  username: string,
  password: string,
): Promise<boolean> {
  console.log("Validating user creds for user " + username);
  try {
    const authResponse = await cognitoIdpClient
      .adminInitiateAuth({
        AuthFlow: "ADMIN_NO_SRP_AUTH",
        AuthParameters: {
          PASSWORD: password,
          USERNAME: username,
        },
        ClientId: userPoolClientId as string,
        UserPoolId: userPoolId as string,
      })
      .promise();

    if ("AuthenticationResult" in authResponse) {
      console.log("User credentials validated successfully");
      return true;
    } else {
      console.log(
        "User failed validation (no AuthenticationResult response from cognito)",
      );
      return false;
    }
  } catch (err) {
    console.log("User failed validation with error: " + err.message);
    return false;
  }
}

/** Split and decode authorization header */
export function getCredsFromAuthHeader(
  authHeader: string,
): { username: string; password: string } {
  const base64Creds = authHeader.split(" ")[1];
  const credArray = Buffer.from(base64Creds, "base64")
    .toString()
    .split(":");
  return {
    password: credArray[1],
    username: credArray[0],
  };
}

/** AWS Lambda entrypoint */
export let handler: CustomAuthorizerHandler = async (
  event: CustomAuthorizerEvent,
  context: Context,
): Promise<CustomAuthorizerResult> => {
  if (!event.headers) {
    throw new Error("No headers provided in event");
  }

  if (!event.headers.Authorization) {
    throw new Error("Unauthorized");
  }

  const creds = getCredsFromAuthHeader(event.headers.Authorization);

  if (await validateUser(creds.username, creds.password)) {
    return generateInvokePolicy(event, creds.username);
  } else {
    throw new Error("Unauthorized");
  }
};
