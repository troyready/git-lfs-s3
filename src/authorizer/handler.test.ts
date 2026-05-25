import { APIGatewayRequestAuthorizerEventV2, Context } from "aws-lambda";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCredsFromAuthHeader, handler, cognitoIdpClient } from "./handler";

vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
  const _sharedSendMock = vi
    .fn()
    .mockResolvedValue({ AuthenticationResult: {} });
  return {
    CognitoIdentityProviderClient: vi.fn().mockImplementation(function () {
      this.send = _sharedSendMock;
    }),
    AdminInitiateAuthCommand: vi.fn(),
    __TEST_sendMock: _sharedSendMock,
  };
});

describe("Test authorizer", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cognitoIdpClient.send as any).mockClear();
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
        {
          version: "2.0",
          type: "REQUEST",
          routeArn: "unused",
          identitySource: [],
          routeKey: "unused",
          rawPath: "/",
          rawQueryString: "",
          cookies: [],
          headers: {},
        } as unknown as APIGatewayRequestAuthorizerEventV2,
        {} as Context,
        vi.fn(),
      ),
    ).rejects.toThrow(Error);
  });

  test("Error returned on missing Authorization header", async () => {
    await expect(
      handler(
        {
          version: "2.0",
          type: "REQUEST",
          routeArn: "unused",
          identitySource: [],
          routeKey: "unused",
          rawPath: "/",
          rawQueryString: "",
          cookies: [],
          headers: { foo: "bar" },
          requestContext:
            {} as APIGatewayRequestAuthorizerEventV2["requestContext"],
        } as unknown as APIGatewayRequestAuthorizerEventV2,
        {} as Context,
        vi.fn(),
      ),
    ).rejects.toThrow(Error);
  });

  test("Simple authorizer response returned on valid credentials", async () => {
    const authReturn = await handler(
      {
        version: "2.0",
        type: "REQUEST",
        routeArn: "unused",
        identitySource: [],
        routeKey: "unused",
        rawPath: "/",
        rawQueryString: "",
        cookies: [],
        headers: { authorization: "Basic Zm9vOmJhcg==" },
        requestContext:
          {} as APIGatewayRequestAuthorizerEventV2["requestContext"],
      } as unknown as APIGatewayRequestAuthorizerEventV2,
      {} as Context,
      vi.fn(),
    );
    expect(authReturn).toEqual({
      isAuthorized: true,
      context: {
        principalId: "foo",
      },
    });
  });

  test("Error returned on invalid credentials", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cognitoIdpClient.send as any).mockRejectedValueOnce(
      new Error("Invalid credentials"),
    );

    await expect(
      handler(
        {
          version: "2.0",
          type: "REQUEST",
          routeArn: "unused",
          identitySource: [],
          routeKey: "unused",
          rawPath: "/",
          rawQueryString: "",
          cookies: [],
          headers: { authorization: "Basic YmFyOmJhcg==" },
          requestContext:
            {} as APIGatewayRequestAuthorizerEventV2["requestContext"],
        } as unknown as APIGatewayRequestAuthorizerEventV2,
        {} as Context,
        vi.fn(),
      ),
    ).rejects.toThrow(Error);
  });
});
