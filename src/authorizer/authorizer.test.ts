jest.mock("aws-sdk");
import { Context, CustomAuthorizerEvent } from "aws-lambda";
import { CognitoIdentityServiceProvider } from "aws-sdk";
import { getCredsFromAuthHeader, handler } from "./authorizer";

const mockMethodArn = "arn:aws:execute-api:us-west-2:123456790:apiIdFoo/dev/post/unused";
const mockCognitoIdpadminInitiateAuth = jest.fn().mockImplementation((params) => {
  if (("AuthParameters" in params) && (params.AuthParameters.USERNAME === "foo" &&
                                       params.AuthParameters.PASSWORD === "bar")) {
    return {promise: jest.fn().mockResolvedValue({
      AuthenticationResult: {},
    })};
  } else {
    return {promise: jest.fn().mockRejectedValue(new Error("Invalid credentials"))};
  }
});

function unusedCallback<T>() { return undefined as any as T; }

describe("Test authorizer", () => {
  test("Verify getCredsFromAuthHeader", () => {
    expect(getCredsFromAuthHeader("Basic Zm9vOmJhcg==")).toEqual(
      {username: "foo", password: "bar"},
    );
  });

  test("Error returned on missing headers", async () => {
    await expect(handler(
      {methodArn: mockMethodArn,
       type: "unused"} as CustomAuthorizerEvent,
      {} as Context,
      unusedCallback<any>(),
    )).rejects.toThrow(Error);
    jest.clearAllMocks();
  });

  test("Error returned on missing Authorization header", async () => {
    await expect(handler(
      {headers: {foo: "bar"},
      methodArn: mockMethodArn,
       type: "unused"} as CustomAuthorizerEvent,
      {} as Context,
      unusedCallback<any>(),
    )).rejects.toThrow(Error);
    jest.clearAllMocks();
  });

  test("ExecuteAPI policy returned on valid credentials", async () => {
    CognitoIdentityServiceProvider.prototype.adminInitiateAuth = mockCognitoIdpadminInitiateAuth;

    const authReturn = await handler(
      {headers: {Authorization: "Basic Zm9vOmJhcg=="},
       methodArn: mockMethodArn,
       type: "unused"} as CustomAuthorizerEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(authReturn).toEqual(
      { policyDocument: {
          Statement: [
            {Action: "execute-api:Invoke",
             Effect: "Allow",
             Resource: [
               "arn:aws:execute-api:us-west-2:123456790:apiIdFoo/dev/*/*",
             ]},
          ],
          Version: "2012-10-17"},
        principalId: "foo" },
    );
    jest.clearAllMocks();
  });

  test("Error returned on invalid credentials", async () => {
    CognitoIdentityServiceProvider.prototype.adminInitiateAuth = mockCognitoIdpadminInitiateAuth;

    await expect(handler(
      {headers: {Authorization: "Basic YmFyOmJhcg=="}, // bad password
       methodArn: mockMethodArn,
       type: "unused"} as CustomAuthorizerEvent,
      {} as Context,
      unusedCallback<any>(),
    )).rejects.toThrow(Error);
    jest.clearAllMocks();
  });

});
