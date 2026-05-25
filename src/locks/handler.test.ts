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

import {
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { isDeepStrictEqual } from "util";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aws-sdk/client-dynamodb")>();
  return {
    ...actual,
    DynamoDBClient: function DynamoDBClient(): void {
      this.send = mockDdbSend;
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    paginateScan: function paginateScan(_config, _input) {
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
import { handler } from "./handler";

const mockDdbSendImplementation = vi.fn().mockImplementation((command) => {
  if (command instanceof QueryCommand) {
    return new Promise((resolve) => {
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
    return new Promise((resolve) => {
      if (
        isDeepStrictEqual(
          command.input.Key,
          marshall({ path: mockTableItem1.path.S }),
        )
      ) {
        resolve({ Item: mockTableItem1 });
      } else {
        resolve({});
      }
    });
  } else if (
    command instanceof PutItemCommand ||
    command instanceof DeleteItemCommand
  ) {
    return new Promise((resolve) => {
      resolve({});
    });
  }
});

function generateV2Event({
  httpMethod,
  path,
  body,
  queryStringParameters,
  routeKey,
  principalId,
}: {
  httpMethod: string;
  path: string;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
  routeKey?: string;
  principalId?: string;
}): APIGatewayProxyEventV2WithLambdaAuthorizer<Record<string, string>> {
  const routeKeys: Record<string, string> = {
    "GET /locks": "GET /locks",
    "POST /locks": "POST /locks",
    "POST /locks/verify": "POST /locks/verify",
  };
  const key = `${httpMethod} ${path}`;
  const generatedRouteKey =
    routeKey ?? routeKeys[key] ?? "POST /locks/{proxy+}";

  const queryStrParams: Record<string, string> = {};
  if (queryStringParameters) {
    Object.entries(queryStringParameters).forEach(([k, v]) => {
      queryStrParams[k] = v;
    });
  }

  const authorizerContext: Record<string, string> = {};
  if (principalId) {
    authorizerContext.principalId = principalId;
  }

  return {
    version: "2.0",
    routeKey: generatedRouteKey,
    rawPath: path,
    rawQueryString: new URLSearchParams(queryStringParameters ?? {}).toString(),
    isBase64Encoded: false,
    cookies: [],
    headers: {},
    queryStringParameters: queryStrParams,
    body: body ?? null,
    requestContext: {
      accountId: "unused",
      apiId: "unused",
      domainName: "unused",
      domainPrefix: "unused",
      http: {
        method: httpMethod,
        path,
        protocol: "unused",
        sourceIp: "unused",
        userAgent: "unused",
      },
      requestId: "unused",
      routeKey: generatedRouteKey,
      stage: "unused",
      time: "unused",
      timeEpoch: 0,
      authorizer: {
        lambda: authorizerContext,
      },
    },
  };
}

describe("Handler tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("handler errors on request without username", async () => {
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: null,
        principalId: undefined,
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler returns query of locks by id", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: { id: mockTableItem0.id.S },
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
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
      generateV2Event({
        httpMethod: "GET",
        path: "/locks",
        body: "{}",
        queryStringParameters: { path: mockTableItem1.path.S },
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
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
      generateV2Event({
        httpMethod: "GET",
        path: "/locks",
        principalId: "unittestuser",
        body: "{}",
        queryStringParameters: {},
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
    );
    expect(parsedhandlerReturnBody.locks).toHaveLength(2);
    expect(parsedhandlerReturnBody.locks).toEqual(
      expect.arrayContaining(
        [mockTableItem0, mockTableItem1].map((e) => ({
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
      generateV2Event({
        httpMethod: "POST",
        path: "/locks/verify",
        body: "{}",
        queryStringParameters: {},
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
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
      generateV2Event({
        httpMethod: "POST",
        path: "/locks",
        body: null,
        queryStringParameters: {},
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler errors when attempting to create a lock for an already locked path", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "POST",
        path: "/locks",
        body: JSON.stringify({ path: mockTableItem1.path.S }),
        queryStringParameters: {},
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 409 });
  });

  test("handler succeeds creating a new lock", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const newLockPath = "/newlockpath";
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "POST",
        path: "/locks",
        body: JSON.stringify({ path: newLockPath }),
        queryStringParameters: {},
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 201 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
    );
    expect(parsedhandlerReturnBody).toMatchObject({
      lock: { path: newLockPath },
    });
  });

  test("handler allows deletion of self-owned lock without force", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem0.id.S + "/unlock",
        body: "{}",
        queryStringParameters: {},
        routeKey: "POST /locks/{proxy+}",
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
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
      generateV2Event({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem1.id.S + "/unlock",
        body: JSON.stringify({ force: true }),
        queryStringParameters: {},
        routeKey: "POST /locks/{proxy+}",
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 200 });
    const parsedhandlerReturnBody = JSON.parse(
      (handlerReturn as APIGatewayProxyStructuredResultV2).body,
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
      generateV2Event({
        httpMethod: "POST",
        path: "/locks/" + mockTableItem1.id.S + "/unlock",
        body: "{}",
        queryStringParameters: {},
        routeKey: "POST /locks/{proxy+}",
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 403 });
  });

  test("handler errors when attempting to delete a non-existent lock", async () => {
    mockDdbSend.mockImplementation(mockDdbSendImplementation);
    // const handlerReturn = await (handler as any)(
    const handlerReturn = await handler(
      generateV2Event({
        httpMethod: "POST",
        path: "/locks/foobar/unlock",
        body: "{}",
        queryStringParameters: {},
        routeKey: "POST /locks/{proxy+}",
        principalId: "unittestuser",
      }),
      {} as Context,
      vi.fn(),
    );
    expect(handlerReturn).toMatchObject({ statusCode: 500 });
  });
});
