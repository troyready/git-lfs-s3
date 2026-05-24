/**
 * HTTP Basic Auth authorizer
 *
 * @packageDocumentation
 */

import {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewayRequestSimpleAuthorizerHandlerV2WithContext,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import "source-map-support/register";

const userPoolId = process.env.USER_POOL_ID;
const userPoolClientId = process.env.USER_POOL_CLIENT_ID;

if (!userPoolId || !userPoolClientId) {
  throw new Error(
    "Missing USER_POOL_ID or USER_POOL_CLIENT_ID in environment variables.",
  );
}

export const cognitoIdpClient = new CognitoIdentityProviderClient({});

/** Validate user credentials */
async function validateUser(
  username: string,
  password: string,
): Promise<boolean> {
  console.log("Validating user creds for user " + username);
  try {
    const authResponse = await cognitoIdpClient.send(
      new AdminInitiateAuthCommand({
        AuthFlow: "ADMIN_NO_SRP_AUTH",
        AuthParameters: {
          PASSWORD: password,
          USERNAME: username,
        },
        ClientId: userPoolClientId,
        UserPoolId: userPoolId,
      }),
    );

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

export interface Creds {
  username: string;
  password: string;
}

/** Split and decode authorization header */
export function getCredsFromAuthHeader(authHeader: string): Creds {
  const base64Creds = authHeader.split(" ")[1];
  const credArray = Buffer.from(base64Creds, "base64").toString().split(":");
  return {
    password: credArray[1],
    username: credArray[0],
  };
}

/** AWS Lambda entrypoint */
export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<
  Record<string, string>
> = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<
  APIGatewaySimpleAuthorizerWithContextResult<Record<string, string>>
> => {
  const authHeader = event.headers?.authorization;
  if (!authHeader) {
    throw new Error("Unauthorized");
  }

  const creds = getCredsFromAuthHeader(authHeader);

  if (await validateUser(creds.username, creds.password)) {
    return {
      isAuthorized: true,
      context: {
        principalId: creds.username,
      },
    } as APIGatewaySimpleAuthorizerWithContextResult<Record<string, string>>;
  } else {
    throw new Error("Unauthorized");
  }
};
