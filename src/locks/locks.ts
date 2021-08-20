/**
 * \<lfsendpoint\>/locks and \<lfsendpoint\>/locks/* API
 *
 * @packageDocumentation
 */

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
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

const tableName = process.env.TABLE_NAME!;
const tableIdIndexName = process.env.ID_INDEX_NAME!;
const deletePathRegex = /\/locks\/([-a-zA-Z0-9]*)\/unlock/;
const ddbClient = new DynamoDBClient({});

/** Return all lock items (in native js types) from DDB table */
async function scanTable(): Promise<Array<any>> {
  let items: Array<any> = [];
  const paginator = paginateScan({ client: ddbClient }, { TableName: tableName });
  for await (const page of paginator) {
    if ("Items" in page) {
      items = [...items, ...page.Items!.map(e => unmarshall(e))];
    }
  }
  return items;
}

/** Turn DDB item format into Git LFS API format */
function formatLockResponseFromTableEntry(entry: any): any {
  return {
    id: entry.id,
    path: entry.path,
    locked_at: entry.lockedAt,
    owner: { name: entry.ownerName },
  };
}

/** List all locks or (if id or path provided) a single lock */
async function listLocks(params: any): Promise<Record<LockObjKey, any[]>> {
  const locks: Record<LockObjKey, any[]> = { locks: [] };
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
        formatLockResponseFromTableEntry(unmarshall(queryResponse.Items[0])),
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
        formatLockResponseFromTableEntry(unmarshall(getResponse.Item)),
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
async function listVerifyLocks(username: string): Promise<Record<LocksVerifyObjKeys, unknown>> {
  const locks: Record<LocksVerifyObjKeys, any[]> = { ours: [], theirs: [] };

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
async function createLock(body: any, username: string): Promise<any> {
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
        lock: formatLockResponseFromTableEntry(unmarshall(getResponse.Item)),
        message: "already created lock",
      },
    };
  }

  const itemParams = {
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
  body: any,
  username: string,
  lockId: string,
): Promise<any> {
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
    if (
      unmarshall(queryResponse.Items[0]).ownerName == username ||
      body.force
    ) {
      await ddbClient.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ path: unmarshall(queryResponse.Items[0]).path }),
        }),
      );
      return {
        statusCode: 200,
        body: {
          lock: formatLockResponseFromTableEntry(
            unmarshall(queryResponse.Items[0]),
          ),
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
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<APIGatewayProxyResult> => {
  let username = "";
  if (
    event.requestContext &&
    event.requestContext.authorizer &&
    event.requestContext.authorizer.principalId
  ) {
    username = event.requestContext.authorizer.principalId;
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

  if (event.path == "/locks" && event.httpMethod == "GET") {
    return {
      body: JSON.stringify(await listLocks(event.queryStringParameters)),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: 200,
    };
  }

  if (event.path == "/locks/verify" && event.httpMethod == "POST") {
    return {
      body: JSON.stringify(await listVerifyLocks(username)),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: 200,
    };
  }

  let body: any = {};
  if (event.body) {
    body = JSON.parse(event.body);
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

  if (event.path == "/locks" && event.httpMethod == "POST") {
    const createResponse = await createLock(body, username);
    return {
      body: JSON.stringify(createResponse.body),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: createResponse.statusCode,
    };
  }

  const deleteLockRegexMatch = event.path.match(deletePathRegex);
  if (event.httpMethod == "POST" && deleteLockRegexMatch) {
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
