/**
 * Manage S3 events signaling completion of multipart uploads.
 *
 * @packageDocumentation
 */

import { S3Event, S3Handler } from "aws-lambda";
import {
  CompletedMultipartUpload,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { completedMultipartUploadNotificationObjectSuffix } from "../util/util";

interface CompletedMultipartUploadNotification {
  MultipartUpload: CompletedMultipartUpload;
  UploadId: string;
}

const s3Client = new S3Client({});

/** AWS Lambda entrypoint */
export const handler: S3Handler = async (event: S3Event): Promise<void> => {
  const completionPromises: Promise<void>[] = [];
  event.Records.forEach(async (record) => {
    completionPromises.push(
      completeS3Upload(record.s3.bucket.name, record.s3.object.key),
    );
  });

  await Promise.all(completionPromises);
};

/** CompleteMultipartUpload and cleanup notification  */
async function completeS3Upload(bucket: string, key: string): Promise<void> {
  const completedMultipartUploadNotification =
    await retrieveCompletedMultipartUploadNotification(bucket, key);

  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key.replace(
        RegExp(completedMultipartUploadNotificationObjectSuffix + "$"),
        "",
      ),
      MultipartUpload: completedMultipartUploadNotification.MultipartUpload,
      UploadId: completedMultipartUploadNotification.UploadId,
    }),
  );

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

/** Read file to string from S3 */
async function retrieveObjectFromS3(
  bucket: string,
  key: string,
): Promise<string> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  if (response.Body) {
    return await response.Body.transformToString();
  } else {
    throw new Error("Failed to retrieve S3 object");
  }
}

async function retrieveCompletedMultipartUploadNotification(
  bucket: string,
  key: string,
): Promise<CompletedMultipartUploadNotification> {
  const stringifiedNotification = await retrieveObjectFromS3(bucket, key);

  try {
    const parsedNotification = JSON.parse(
      stringifiedNotification,
    ) as CompletedMultipartUploadNotification;
    return parsedNotification;
  } catch (error) {
    throw new Error(`Failed to parse object contents as JSON: ${error}`);
  }
}
