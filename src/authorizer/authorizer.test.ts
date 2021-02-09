import { Context, CustomAuthorizerEvent } from "aws-lambda";

const mockCognitoIdpSend = jest.fn();
jest.mock("@aws-sdk/client-cognito-identity-provider", () => {
  return {
    ...jest.requireActual("@aws-sdk/client-cognito-identity-provider"),
    CognitoIdentityProviderClient: function CognitoIdentityProviderClient(): void {
      this.send = mockCognitoIdpSend;
    },
  };
});
import { AdminInitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { getCredsFromAuthHeader, handler } from "./authorizer";

const mockMethodArn =
  "arn:aws:execute-api:us-west-2:123456790:apiIdFoo/dev/post/unused";
const mockCognitoIdpSendImplementation = jest
  .fn()
  .mockImplementation(command => {
    if (command instanceof AdminInitiateAuthCommand) {
      if (
        "AuthParameters" in command.input &&
        command.input.AuthParameters!.USERNAME === "foo" &&
        command.input.AuthParameters!.PASSWORD === "bar"
      ) {
        return Promise.resolve({ AuthenticationResult: {} });
      } else {
        return jest.fn().mockRejectedValue(new Error("Invalid credentials"));
      }
    }
  });

function unusedCallback<T>() {
  return (undefined as any) as T;
}

describe("Test authorizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Verify getCredsFromAuthHeader", () => {
    expect(getCredsFromAuthHeader("Basic Zm9vOmJhcg==")).toEqual({
      password: "bar",
      username: "foo",
    });
  });

  test("Error returned on missing headers", async () => {
    await expect(
      handler(
        { methodArn: mockMethodArn, type: "unused" } as CustomAuthorizerEvent,
        {} as Context,
        unusedCallback<any>(),
      ),
    ).rejects.toThrow(Error);
  });

  test("Error returned on missing Authorization header", async () => {
    await expect(
      handler(
        {
          headers: { foo: "bar" },
          methodArn: mockMethodArn,
          type: "unused",
        } as CustomAuthorizerEvent,
        {} as Context,
        unusedCallback<any>(),
      ),
    ).rejects.toThrow(Error);
  });

  test("ExecuteAPI policy returned on valid credentials", async () => {
    mockCognitoIdpSend.mockImplementation(mockCognitoIdpSendImplementation);

    const authReturn = await handler(
      {
        headers: { Authorization: "Basic Zm9vOmJhcg==" },
        methodArn: mockMethodArn,
        type: "unused",
      } as CustomAuthorizerEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(authReturn).toEqual({
      policyDocument: {
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: [
              "arn:aws:execute-api:us-west-2:123456790:apiIdFoo/dev/*/*",
            ],
          },
        ],
        Version: "2012-10-17",
      },
      principalId: "foo",
    });
    // jest.clearAllMocks();
  });

  test("Error returned on invalid credentials", async () => {
    mockCognitoIdpSend.mockImplementation(mockCognitoIdpSendImplementation);

    await expect(
      handler(
        {
          headers: { Authorization: "Basic YmFyOmJhcg==" }, // bad password
          methodArn: mockMethodArn,
          type: "unused",
        } as CustomAuthorizerEvent,
        {} as Context,
        unusedCallback<any>(),
      ),
    ).rejects.toThrow(Error);
  });
});
