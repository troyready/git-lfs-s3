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
import { DynamoDB } from "aws-sdk";
import { ISODateString } from "../util/util";

const tableName = process.env.TABLE_NAME!;
const tableIdIndexName = process.env.ID_INDEX_NAME!;
const deletePathRegex = /\/locks\/([-a-zA-Z0-9]*)\/unlock/;
const docClient = new DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

/** Return all lock items from DDB table */
async function scanTable(
  alreadyScannedItems?: Array<any>,
  lastEvalutedKey?: DynamoDB.DocumentClient.Key,
): Promise<Array<any>> {
  const params = { TableName: tableName };
  if (typeof lastEvalutedKey !== "undefined") {
    params["ExclusiveStartKey"] = lastEvalutedKey;
  }

  let items: Array<any> = [];
  if (typeof alreadyScannedItems !== "undefined") {
    items = alreadyScannedItems;
  }

  let scanResponse = await docClient.scan(params).promise();
  if ("Items" in scanResponse) {
    items = [...items, ...scanResponse.Items!];
  }

  if (scanResponse.LastEvaluatedKey) {
    return await scanTable(items, scanResponse.LastEvaluatedKey!);
  } else {
    return items;
  }
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
async function listLocks(params: any): Promise<object> {
  var locks: any = { locks: [] };
  if (params.id) {
    let queryResponse = await docClient
      .query({
        TableName: tableName,
        IndexName: tableIdIndexName,
        KeyConditionExpression: "id = :hkey",
        ExpressionAttributeValues: {
          ":hkey": params.id,
        },
      })
      .promise();
    if (queryResponse.Items && queryResponse.Items.length > 0) {
      locks.locks.push(
        formatLockResponseFromTableEntry(queryResponse.Items[0]),
      );
    }
  } else if (params.path) {
    let getResponse = await docClient
      .get({ TableName: tableName, Key: { path: params.path } })
      .promise();
    if (getResponse.Item) {
      locks.locks.push(formatLockResponseFromTableEntry(getResponse.Item));
    }
  } else {
    for (const tableLockEntry of await scanTable()) {
      locks.locks.push(formatLockResponseFromTableEntry(tableLockEntry));
    }
  }
  return locks;
}

/** List locks in locks/verify format */
async function listVerifyLocks(username: string): Promise<object> {
  var locks: any = { ours: [], theirs: [] };

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
  let getResponse = await docClient
    .get({ TableName: tableName, Key: { path: body.path } })
    .promise();
  if (getResponse.Item) {
    return {
      statusCode: 409,
      body: {
        lock: formatLockResponseFromTableEntry(getResponse.Item),
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
  await docClient.put({ TableName: tableName, Item: itemParams }).promise();
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
  let queryResponse = await docClient
    .query({
      TableName: tableName,
      IndexName: tableIdIndexName,
      KeyConditionExpression: "id = :hkey",
      ExpressionAttributeValues: {
        ":hkey": lockId,
      },
    })
    .promise();
  if (queryResponse.Items && queryResponse.Items.length > 0) {
    if (queryResponse.Items[0].ownerName == username || body.force) {
      await docClient
        .delete({
          TableName: tableName,
          Key: { path: queryResponse.Items[0].path },
        })
        .promise();
      return {
        statusCode: 200,
        body: {
          lock: formatLockResponseFromTableEntry(queryResponse.Items[0]),
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
export let handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  let username: string = "";
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
