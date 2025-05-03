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
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  completedMultipartUploadNotificationObjectSuffix,
  ISODateString,
} from "../util/util";

const bucketName = process.env.BUCKET_NAME;
if (!bucketName) throw new Error("BUCKET_NAME environment variable not set");
const urlExpiry = 21600; // 6 hours; max for url from metadata creds
const basicTransferUploadSizeLimit = 5_000_000_000;
const multipart3uploadTransferTypeName = "multipart3upload";
const s3Client = new S3Client({});

type MultipartS3UploadHref = {
  completionurl: string;
  presignedurls: string[];
  uploadid: string;
};

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
): Promise<Record<string, unknown>> {
  const baseResponse = { oid, size };

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: oid,
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

/** Generate pre-signed multipart upload requests for large objects */
async function getBatchMultipartUploadObject(
  oid: string,
  size: number,
): Promise<Record<string, unknown>> {
  const baseResponse = { oid, size };

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: oid,
      }),
    );

    // upload request for existing object (no-op)
    return baseResponse;
  } catch (err) {
    if (err.name === "NotFound") {
      // upload request for missing object
      const mimeType = "application/octet-stream";

      console.log(
        `multipart upload: Creating multipart upload for oid: ${oid}`,
      );
      const createMultipartUploadRes = s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucketName,
          ContentType: mimeType,
          Key: oid,
        }),
      );

      // Each part completion will update progress on the client
      // so there's some advantage to smaller parts
      // (with an AWS maximum of 10,000 parts)
      const partSize =
        Math.ceil(size / 50_000_000) > 10_000 ? 5_000_000_000 : 50_000_000;

      const uploadId = (await createMultipartUploadRes).UploadId;
      const uploadUrlExpiry = getExpiryString();
      const presignedurls: Promise<string>[] = [];
      for (const partNumber of Array.from(
        { length: Math.ceil(size / partSize) },
        (_, i) => i + 1,
      )) {
        presignedurls.push(
          getSignedUrl(
            s3Client,
            new UploadPartCommand({
              Bucket: bucketName,
              Key: oid,
              PartNumber: partNumber,
              UploadId: uploadId,
            }),
            { expiresIn: urlExpiry },
          ),
        );
      }

      const completionurl = getSignedUrl(
        s3Client,
        new PutObjectCommand({
          Bucket: bucketName,
          ContentType: mimeType,
          Key: oid + completedMultipartUploadNotificationObjectSuffix,
        }),
        { expiresIn: urlExpiry },
      );

      console.log("multipart upload: Awaiting url generation and returning");
      return {
        ...baseResponse,
        actions: {
          upload: {
            expires_at: uploadUrlExpiry,
            header: { "Content-Type": mimeType },
            href: JSON.stringify({
              completionurl: await completionurl,
              presignedurls: await Promise.all(presignedurls),
              uploadid: uploadId,
            } as MultipartS3UploadHref),
          },
        },
        authenticated: true,
      };
    } else {
      throw err;
    }
  }
}

/** Iterate through requested objects and get the storage response for each of them */
async function getBatchResponse(
  body: any,
  transferType: string,
): Promise<Record<string, unknown>> {
  const objects: Array<Promise<any>> = [];

  if (transferType == "basic") {
    for (const entry of body.objects) {
      objects.push(getBatchObject(body.operation, entry.oid, entry.size));
    }
  } else if (transferType == multipart3uploadTransferTypeName) {
    for (const entry of body.objects) {
      objects.push(getBatchMultipartUploadObject(entry.oid, entry.size));
    }
  }
  return { transfer: transferType, objects: await Promise.all(objects) };
}

/** AWS Lambda entrypoint */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context, // eslint-disable-line @typescript-eslint/no-unused-vars
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

  if (["download", "upload"].includes(body.operation)) {
    if (
      body.operation === "download" &&
      "transfers" in body &&
      !body.transfers.includes("basic")
    ) {
      console.log("Invalid transfer type requested");
      return {
        body: JSON.stringify({
          errorType: "BadRequest",
          message:
            "Invalid transfer type requested; only basic is supported for downloads",
        }),
        statusCode: 400,
      };
    }

    let requiresMultiPartUpload = false;

    if (body.operation === "upload") {
      requiresMultiPartUpload = body.objects.some(
        (obj) => obj.size > basicTransferUploadSizeLimit,
      );
      if (
        requiresMultiPartUpload &&
        body.objects.some((obj) => obj.size > 5_000_000_000_000)
      ) {
        console.log("Impressive - attempt to upload a file larger than 5TB!");
        return {
          body: JSON.stringify({
            errorType: "BadRequest",
            message: `Maximum S3 file upload size is 5TB`,
          }),
          statusCode: 400,
        };
      }
      if (
        requiresMultiPartUpload &&
        (!("transfers" in body) ||
          !body.transfers.includes(multipart3uploadTransferTypeName))
      ) {
        console.log("Invalid transfer type requested");
        return {
          body: JSON.stringify({
            errorType: "BadRequest",
            message: `Invalid transfer type requested; >=5GB uploads require the ${multipart3uploadTransferTypeName} transfer type`,
          }),
          statusCode: 400,
        };
      } else if (
        !requiresMultiPartUpload &&
        "transfers" in body &&
        !body.transfers.includes("basic")
      ) {
        console.debug(
          "No large files being uploaded but no basic transfer type requested",
        );
        return {
          body: JSON.stringify({
            errorType: "BadRequest",
            message:
              "Invalid transfer type requested; upload requires basic transfer type",
          }),
          statusCode: 400,
        };
      }
    }

    const batchResponse = await getBatchResponse(
      body,
      requiresMultiPartUpload ? multipart3uploadTransferTypeName : "basic",
    );
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
