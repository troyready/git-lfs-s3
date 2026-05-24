/**
 * \<lfsendpoint\>/locks and \<lfsendpoint\>/locks/* API
 *
 * @packageDocumentation
 */

import {
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import "source-map-support/register";
import { v4 as uuidv4 } from "uuid";
import {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
  paginateScan,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ISODateString } from "../util/util";

type LockObjKey = "locks";
type LocksVerifyObjKeys = "ours" | "theirs";

interface LockEntry {
  id: string;
  path: string;
  lockedAt: string;
  ownerName: string;
}

interface LockParams {
  id?: string;
  path?: string;
}

interface LockRequestBody {
  path: string;
  force?: boolean;
}

interface LockResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

interface FormattedLock {
  id: string;
  path: string;
  locked_at: string;
  owner: { name: string };
}

const tableName = process.env.TABLE_NAME;
const tableIdIndexName = process.env.ID_INDEX_NAME;
if (!tableName || !tableIdIndexName) {
  throw new Error(
    "TABLE_NAME and ID_INDEX_NAME environment variables must be set",
  );
}

const deletePathRegex = /\/locks\/([-a-zA-Z0-9]*)\/unlock/;
const ddbClient = new DynamoDBClient({});

/** Return all lock items (in native js types) from DDB table */
async function scanTable(): Promise<LockEntry[]> {
  let items: LockEntry[] = [];
  const paginator = paginateScan(
    { client: ddbClient },
    { TableName: tableName },
  );
  for await (const page of paginator) {
    if ("Items" in page && page.Items) {
      items = [...items, ...page.Items.map((e) => unmarshall(e) as LockEntry)];
    }
  }
  return items;
}

/** Turn DDB item format into Git LFS API format */
function formatLockResponseFromTableEntry(entry: LockEntry): FormattedLock {
  return {
    id: entry.id,
    path: entry.path,
    locked_at: entry.lockedAt,
    owner: { name: entry.ownerName },
  };
}

/** List all locks or (if id or path provided) a single lock */
async function listLocks(
  params: LockParams | null,
): Promise<Record<LockObjKey, FormattedLock[]>> {
  const locks: Record<LockObjKey, FormattedLock[]> = { locks: [] };
  if (!params) return locks;
  if (params.id) {
    const queryResponse = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: tableIdIndexName,
        KeyConditionExpression: "id = :hkey",
        ExpressionAttributeValues: marshall({
          ":hkey": params.id,
        }),
      }),
    );
    if (queryResponse.Items && queryResponse.Items.length > 0) {
      locks.locks.push(
        formatLockResponseFromTableEntry(
          unmarshall(queryResponse.Items[0]) as LockEntry,
        ),
      );
    }
  } else if (params.path) {
    const getResponse = await ddbClient.send(
      new GetItemCommand({
        TableName: tableName,
        Key: marshall({ path: params.path }),
      }),
    );
    if (getResponse.Item) {
      locks.locks.push(
        formatLockResponseFromTableEntry(
          unmarshall(getResponse.Item) as LockEntry,
        ),
      );
    }
  } else {
    for (const tableLockEntry of await scanTable()) {
      locks.locks.push(formatLockResponseFromTableEntry(tableLockEntry));
    }
  }
  return locks;
}

/** List locks in locks/verify format */
async function listVerifyLocks(
  username: string,
): Promise<Record<LocksVerifyObjKeys, FormattedLock[]>> {
  const locks: Record<LocksVerifyObjKeys, FormattedLock[]> = {
    ours: [],
    theirs: [],
  };

  for (const tableLockEntry of await scanTable()) {
    if (tableLockEntry.ownerName == username) {
      locks.ours.push(formatLockResponseFromTableEntry(tableLockEntry));
    } else {
      locks.theirs.push(formatLockResponseFromTableEntry(tableLockEntry));
    }
  }
  return locks;
}

/** Create file lock */
async function createLock(
  body: LockRequestBody,
  username: string,
): Promise<LockResponse> {
  // First check for existing lock
  const getResponse = await ddbClient.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ path: body.path }),
    }),
  );
  if (getResponse.Item) {
    return {
      statusCode: 409,
      body: {
        lock: formatLockResponseFromTableEntry(
          unmarshall(getResponse.Item) as LockEntry,
        ),
        message: "already created lock",
      },
    };
  }

  const itemParams: LockEntry = {
    path: body.path,
    id: uuidv4(),
    lockedAt: ISODateString(new Date()),
    ownerName: username,
  };
  await ddbClient.send(
    new PutItemCommand({ TableName: tableName, Item: marshall(itemParams) }),
  );
  return {
    statusCode: 201,
    body: { lock: formatLockResponseFromTableEntry(itemParams) },
  };
}

/** Delete file lock */
async function deleteLock(
  body: LockRequestBody,
  username: string,
  lockId: string,
): Promise<LockResponse> {
  const queryResponse = await ddbClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: tableIdIndexName,
      KeyConditionExpression: "id = :hkey",
      ExpressionAttributeValues: marshall({
        ":hkey": lockId,
      }),
    }),
  );
  if (queryResponse.Items && queryResponse.Items.length > 0) {
    const queryItem = unmarshall(queryResponse.Items[0]) as LockEntry;
    if (queryItem.ownerName == username || body.force) {
      await ddbClient.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ path: queryItem.path }),
        }),
      );
      return {
        statusCode: 200,
        body: {
          lock: formatLockResponseFromTableEntry(queryItem),
        },
      };
    } else {
      return {
        statusCode: 403,
        body: {
          message: "use force flag to delete lock owned by another user",
        },
      };
    }
  } else {
    return { statusCode: 500, body: { message: "lock not found" } };
  }
}

/** AWS Lambda entrypoint */
export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<
  Record<string, string>
> = async (
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<Record<string, string>>,
): Promise<APIGatewayProxyResultV2<Record<string, string>>> => {
  let username = "";
  if (event.requestContext.authorizer?.lambda?.principalId) {
    username = event.requestContext.authorizer.lambda.principalId;
  } else {
    console.log("Could not retrieve username from API Gateway");
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Missing username",
      }),
      statusCode: 400,
    };
  }

  if (
    event.requestContext.http.path == "/locks" &&
    event.requestContext.http.method == "GET"
  ) {
    return {
      body: JSON.stringify(
        await listLocks(
          event.queryStringParameters
            ? {
                id: event.queryStringParameters.id,
                path: event.queryStringParameters.path,
              }
            : null,
        ),
      ),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: 200,
    };
  }

  if (
    event.requestContext.http.path == "/locks/verify" &&
    event.requestContext.http.method == "POST"
  ) {
    return {
      body: JSON.stringify(await listVerifyLocks(username)),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: 200,
    };
  }

  let body: LockRequestBody = {} as LockRequestBody;
  if (event.body) {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;
    body = JSON.parse(rawBody);
  } else {
    console.log("Body not found on event");
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Missing body in request",
      }),
      statusCode: 400,
    };
  }

  if (
    event.requestContext.http.path == "/locks" &&
    event.requestContext.http.method == "POST"
  ) {
    const createResponse = await createLock(body, username);
    return {
      body: JSON.stringify(createResponse.body),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: createResponse.statusCode,
    };
  }

  const deleteLockRegexMatch =
    event.requestContext.http.path.match(deletePathRegex);
  if (event.requestContext.http.method == "POST" && deleteLockRegexMatch) {
    const deleteResponse = await deleteLock(
      body,
      username,
      deleteLockRegexMatch[1],
    );
    return {
      body: JSON.stringify(deleteResponse.body),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: deleteResponse.statusCode,
    };
  }

  return {
    body: JSON.stringify({
      errorType: "BadRequest",
      message: "Invalid operation requested",
    }),
    statusCode: 400,
  };
};
