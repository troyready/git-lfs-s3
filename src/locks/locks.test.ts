const mockTableItem0 = {
  id: { S: "12345678-90ab-cdef-ghij-klmnopqrstuv" },
  path: { S: "/mockpath" },
  lockedAt: { S: "2021-01-01T00:00:00Z" },
  ownerName: { S: "unittestuser" },
};
const mockTableItem1 = {
  id: { S: "abcdefgh-ijkl-mnop-qrst-uvwxyz012345" },
  path: { S: "/secondmockpath" },
  lockedAt: { S: "2021-01-01T00:00:00Z" },
  ownerName: { S: "otheruser" },
};

import { isDeepStrictEqual } from "util";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

const mockDdbSend = jest.fn();
jest.mock("@aws-sdk/client-dynamodb", () => {
  return {
    ...jest.requireActual("@aws-sdk/client-dynamodb"),
    DynamoDBClient: function DynamoDBClient(): void {
      this.send = mockDdbSend;
    },
    paginateScan: function paginateScan(config, input): any {
      return (async function* asyncGenerator() {
        let i = 0;
        while (i == 0) {
          i++;
          yield { Items: [mockTableItem0, mockTableItem1] };
        }
      })();
    },
  };
});
import {
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { handler } from "./locks";

function unusedCallback<T>() {
  return (undefined as any) as T;
}

const mockDdbSendImplementation = jest.fn().mockImplementation(command => {
  if (command instanceof QueryCommand) {
    return new Promise((resolve, reject) => {
      if (
        command.input.KeyConditionExpression == "id = :hkey" &&
        isDeepStrictEqual(
          command.input.ExpressionAttributeValues,
          marshall({
            ":hkey": mockTableItem0.id.S,
          }),
        )
      ) {
        resolve({ Items: [mockTableItem0] });
      } else if (
        command.input.KeyConditionExpression == "id = :hkey" &&
        isDeepStrictEqual(
          command.input.ExpressionAttributeValues,
          marshall({
            ":hkey": mockTableItem1.id.S,
          }),
        )
      ) {
        resolve({ Items: [mockTableItem1] });
      } else {
        resolve({ Items: [] });
      }
    });
  } else if (command instanceof GetItemCommand) {
    return new Promise((resolve, reject) => {
      if (isDeepStrictEqual(command.input.Key, { path: mockTableItem1.path })) {
        resolve({ Item: mockTableItem1 });
      } else {
        resolve({});
      }
    });
  } else if (
    command instanceof PutItemCommand ||
    command instanceof DeleteItemCommand
  ) {
    return new Promise((resolve, reject) => {
      resolve({});
    });
  }
});

function generateAPIGatewayProxyEvent({
  httpMethod,
  path,
  body,
  queryStringParameters,
}: {
  httpMethod;
  path;
  body;
  queryStringParameters;
}) {
  return {
    body: body,
    headers: {},
    httpMethod: httpMethod,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: path,
    pathParameters: null,
    queryStringParameters: queryStringParameters,
    requestContext: {
      accountId: "unused",
      apiId: "unused",
      httpMethod: "unused",
      identity: {
        accessKey: "unused",
        accountId: "unused",
        apiKey: "unused",
        apiKeyId: "unused",
        caller: "unused",
        cognitoAuthenticationProvider: "unused",
        cognitoAuthenticationType: "unused",
        cognitoIdentityId: "unused",
        cognitoIdentityPoolId: "unused",
        sourceIp: "unused",
        user: "unused",
        userAgent: "unused",
        userArn: "unused",
      },
      authorizer: { principalId: "unittestuser" },
      path: "unused",
      stage: "unused",
      requestId: "unused",
      requestTimeEpoch: 0,
      resourceId: "unused",
      resourcePath: "unused",
    },
    resource: "unused",
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

describe("Handler tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("handler errors on request without username", async () => {
    const handlerReturn = await handler(
      {} as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler returns query of locks by id", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: { id: mockTableItem0.id.S },
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody.locks).toHaveLength(1);
    expect(parsedhandlerReturnBody.locks).toEqual(
      expect.arrayContaining([
        {
          id: mockTableItem0.id.S,
          locked_at: mockTableItem0.lockedAt.S,
          owner: { name: mockTableItem0.ownerName.S },
          path: mockTableItem0.path.S,
        },
      ]),
    );
  });
  test("handler returns query of locks by path", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: { path: mockTableItem1.path.S },
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody.locks).toHaveLength(1);
    expect(parsedhandlerReturnBody.locks).toEqual(
      expect.arrayContaining([
        {
          id: mockTableItem1.id.S,
          locked_at: mockTableItem1.lockedAt.S,
          owner: { name: mockTableItem1.ownerName.S },
          path: mockTableItem1.path.S,
        },
      ]),
    );
  });
  test("handler returns list of all locks", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody.locks).toHaveLength(2);
    expect(parsedhandlerReturnBody.locks).toEqual(
      expect.arrayContaining(
        [mockTableItem0, mockTableItem1].map(e => ({
          id: e.id.S,
          locked_at: e.lockedAt.S,
          owner: { name: e.ownerName.S },
          path: e.path.S,
        })),
      ),
    );
  });
  test("handler returns list of all locks in verify format", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks/verify",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody).toMatchObject({
      ours: [
        {
          id: mockTableItem0.id.S,
          locked_at: mockTableItem0.lockedAt.S,
          owner: { name: mockTableItem0.ownerName.S },
          path: mockTableItem0.path.S,
        },
      ],
      theirs: [
        {
          id: mockTableItem1.id.S,
          locked_at: mockTableItem1.lockedAt.S,
          owner: { name: mockTableItem1.ownerName.S },
          path: mockTableItem1.path.S,
        },
      ],
    });
  });

  test("handler errors on lock creation request without body", async () => {
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks",
        body: null,
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler errors when attempting to create a lock for an already locked path", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks",
        body: JSON.stringify({ path: mockTableItem1.path.S }),
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 409 });
  });

  test("handler succeeds creating a new lock", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const newLockPath = "/newlockpath";
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks",
        body: JSON.stringify({ path: newLockPath }),
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 201 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody).toMatchObject({
      lock: { path: newLockPath },
    });
  });

  test("handler allows deletion of self-owned lock without force", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem0.id.S + "/unlock",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody).toMatchObject({
      lock: {
        id: mockTableItem0.id.S,
        locked_at: mockTableItem0.lockedAt.S,
        owner: { name: mockTableItem0.ownerName.S },
        path: mockTableItem0.path.S,
      },
    });
  });

  test("handler allows deletion of another user's lock with force", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem1.id.S + "/unlock",
        body: JSON.stringify({ force: true }),
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyResult).body,
    );
    expect(parsedhandlerReturnBody).toMatchObject({
      lock: {
        id: mockTableItem1.id.S,
        locked_at: mockTableItem1.lockedAt.S,
        owner: { name: mockTableItem1.ownerName.S },
        path: mockTableItem1.path.S,
      },
    });
  });

  test("handler denies attempt to delete another user's lock without force", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem1.id.S + "/unlock",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 403 });
  });

  test("handler errors when attempting to delete a non-existent lock", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "POST",
        path: "/locks/foobar/unlock",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      unusedCallback<any>(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 500 });
  });
});
