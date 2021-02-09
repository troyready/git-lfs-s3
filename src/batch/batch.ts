/**
 * \<lfsendpoint\>/objects/batch API
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
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ISODateString } from "../util/util";

const bucketName = process.env.BUCKET_NAME;
const urlExpiry = 21600; // 6 hours; max for url from metadata creds
const s3Client = new S3Client({});

/** Generate RFC 3339 date string set out in the future when S3 presigned URLs will expire */
export function getExpiryString(): string {
  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + urlExpiry);
  return ISODateString(expiryDate);
}

/** Primary API logic tree: Get the appropriate object response for uploads & downloads of new & existing S3 objects */
async function getBatchObject(
  operation: string,
  oid: string,
  size: number,
): Promise<object> {
  const baseResponse = { oid, size };

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName!,
        Key: oid!,
      }),
    );

    if (operation === "upload") {
      // upload request for existing object (no-op)
      return baseResponse;
    } else if (operation === "download") {
      // download request for existing object
      const downloadUrlExpiry = getExpiryString();
      const downloadUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucketName, Key: oid }),
        { expiresIn: urlExpiry },
      );
      return {
        ...baseResponse,
        actions: {
          download: {
            expires_at: downloadUrlExpiry,
            href: downloadUrl,
          },
        },
        authenticated: true,
      };
    }
  } catch (err) {
    if (err.name === "NotFound") {
      if (operation === "upload") {
        // upload request for missing object
        const mimeType = "application/octet-stream";
        const uploadUrlExpiry = getExpiryString();
        const uploadUrl = await getSignedUrl(
          s3Client,
          new PutObjectCommand({
            Bucket: bucketName,
            ContentType: mimeType,
            Key: oid,
          }),
          { expiresIn: urlExpiry },
        );
        return {
          ...baseResponse,
          actions: {
            upload: {
              expires_at: uploadUrlExpiry,
              header: { "Content-Type": mimeType },
              href: uploadUrl,
            },
          },
          authenticated: true,
        };
      } else if (operation === "download") {
        // download request for missing object
        return {
          ...baseResponse,
          error: {
            code: 404,
            message: "Object does not exist",
          },
        };
      }
    } else {
      throw err;
    }
  }
  throw new Error("getBatchObject invoked with invalid parameters");
}

/** Iterate through requested objects and get the storage response for each of them */
async function getBatchResponse(body: any): Promise<object> {
  const objects: Array<Promise<any>> = [];
  for (const entry of body.objects) {
    objects.push(getBatchObject(body.operation, entry.oid, entry.size));
  }
  return { transfer: "basic", objects: await Promise.all(objects) };
}

/** AWS Lambda entrypoint */
export let handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
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

  if ("transfers" in body && !body.transfers.includes("basic")) {
    console.log("Invalid transfer type requested");
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Invalid transfer type requested; only basic is supported",
      }),
      statusCode: 400,
    };
  }

  if (body.operation === "upload" || body.operation === "download") {
    const batchResponse = await getBatchResponse(body);
    return {
      body: JSON.stringify(batchResponse),
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
      statusCode: 200,
    };
  } else {
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Invalid operation requested",
      }),
      statusCode: 400,
    };
  }
};
