/**
 * \<lfsendpoint\>/objects/batch API
 */

/** imports (delete comment after https://github.com/TypeStrong/typedoc/issues/603 resolution) */
import { APIGatewayProxyEvent, APIGatewayProxyHandler, APIGatewayProxyResult, Context } from "aws-lambda";
import "source-map-support/register";
import { S3Adapter } from "./s3";

const bucketName = process.env.BUCKET_NAME;
const urlExpiry = 21600; // 6 hours; max for url from metadata creds
const s3Client = new S3Adapter();

/** Generate a RFC 3339 date string */
export function getExpiryString(): string {
  function ISODateString(d: Date) {
    function pad(num: number) {
      return num < 10 ? "0" + num : num;
    }
    return d.getUTCFullYear() + "-"
        + pad(d.getUTCMonth() + 1) + "-"
        + pad(d.getUTCDate()) + "T"
        + pad(d.getUTCHours()) + ":"
        + pad(d.getUTCMinutes()) + ":"
        + pad(d.getUTCSeconds()) + "Z";
  }

  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + urlExpiry);
  return ISODateString(expiryDate);
}

/** Primary API logic tree: Get the appropriate object response for uploads & downloads of new & existing S3 objects */
async function getBatchObject(operation: string, oid: string, size: number): Promise<object> {
  const baseResponse = {oid, size};

  try {
    await s3Client.headObject({
      Bucket: bucketName!,
      Key: oid!,
    }).promise();
    if (operation === "upload") {
      return baseResponse; // upload request for existing object (no-op)
    } else if (operation === "download") { // download request for existing object
      const downloadUrlExpiry = getExpiryString();
      const downloadUrl = await s3Client.getSignedUrlPromise("getObject",
                                                             {Bucket: bucketName,
                                                              Expires: urlExpiry,
                                                              Key: oid});
      return {...baseResponse,
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
    if (err.code === "NotFound") {
      if (operation === "upload") { // upload request for missing object
        const mimeType = "application/octet-stream";
        const uploadUrlExpiry = getExpiryString();
        const uploadUrl = await s3Client.getSignedUrlPromise("putObject",
                                                             {Bucket: bucketName,
                                                              ContentType: mimeType,
                                                              Expires: urlExpiry,
                                                              Key: oid});
        return {
          ...baseResponse,
          actions: {
            upload: {
              expires_at: uploadUrlExpiry,
              header: {"Content-Type": mimeType},
              href: uploadUrl,
            },
          },
          authenticated: true,
        };
      } else if (operation === "download") { // download request for missing object
        return {
          ...baseResponse,
          error: {
            code: 404,
            message: "Object does not exist",
          },
        };
      }
    } else {
      throw(err);
    }
  }
  throw(new Error("getBatchObject invoked with invalid parameters"));
}

/** Iterate through requested objects and get the storage response for each of them */
async function getBatchResponse(body: any): Promise<object> {
  const objects: Array<Promise<any>> = [];
  for (const entry of body.objects) {
    objects.push(getBatchObject(body.operation, entry.oid, entry.size));
  }
  return {transfer: "basic", objects: await Promise.all(objects)};
}

/** AWS Lambda entrypoint */
export let handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent,
                                                    context: Context): Promise<APIGatewayProxyResult> => {
  let body: any = {};
  if (event.body) {
    body = JSON.parse(event.body);
  } else {
    console.log("Body not found on event");
    return {
      body: JSON.stringify({errorType : "BadRequest",
                            message: "Missing body in request"}),
      statusCode: 400,
    };
  }

  if (("transfers" in body) && !(body.transfers.includes("basic"))) {
    console.log("Invalid transfer type requested");
    return {
      body: JSON.stringify({errorType : "BadRequest",
                            message: "Invalid transfer type requested; only basic is supported"}),
      statusCode: 400,
    };
  }

  if ((body.operation === "upload") || (body.operation === "download")) {
    const batchResponse = await getBatchResponse(body);
    return {
      body: JSON.stringify(batchResponse),
      headers: {"Content-Type": "application/vnd.git-lfs+json"},
      statusCode: 200,
    };
  } else {
    return {
      body: JSON.stringify(
        {errorType : "BadRequest",
         message: "Invalid operation requested"}),
      statusCode: 400,
    };
  }
};
