const mockBucketName = "mocked-jest-bucket";
process.env.BUCKET_NAME = mockBucketName;

import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => {
  return {
    ...jest.requireActual("@aws-sdk/client-s3"),
    S3Client: function S3Client(): void {
      this.send = mockS3Send;
    },
  };
});
jest.mock("@aws-sdk/s3-request-presigner", () => {
  return {
    ...jest.requireActual("@aws-sdk/s3-request-presigner"),
    getSignedUrl: function getSignedUrl(
      client,
      command,
      options?,
    ): Promise<string> {
      return new Promise((resolve, reject) => {
        if ("Bucket" in command.input && "Key" in command.input) {
          resolve(
            "https://" +
              command.input.Bucket +
              ".s3.us-west-2.amazonaws.com/" +
              command.input.Key +
              "?...",
          );
        } else {
          reject(new Error("Missing required parameters"));
        }
      });
    },
  };
});
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getExpiryString, handler } from "./batch";

function unusedCallback<T>() {
  return undefined as any as T;
}
const mockS3SendImplementation = jest.fn().mockImplementation((command) => {
  if (command instanceof HeadObjectCommand) {
    return new Promise((resolve, reject) => {
      if (["mockexists1", "mockexists2"].includes(command.input.Key!)) {
        resolve({ ContentLength: 3191, ContentType: "image/jpeg" });
      } else {
        reject({ name: "NotFound" });
      }
    });
  }
});

describe("Utility tests", () => {
  test("getExpiryString format matches RFC 3339", () => {
    expect(getExpiryString()).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/,
    );
  });
});

describe("Handler tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("handler errors on request without body", async () => {
    const batchReturn = await handler(
      {} as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(batchReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler errors on non-basic transfer request", async () => {
    const batchReturn = await handler(
      {
        body: JSON.stringify({ transfers: ["somethingcrazy"] }),
      } as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(batchReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler errors on invalid operation", async () => {
    const batchReturn = await handler(
      {
        body: JSON.stringify({ operation: "somethingcrazy" }),
      } as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(batchReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler returns valid upload response for new and existing objects", async () => {
    mockS3Send.mockImplementation(mockS3SendImplementation);
    const batchReturn = await handler(
      {
        body: JSON.stringify({
          objects: [
            { oid: "mockexists1", size: 123 },
            { oid: "mocknew1", size: 456 },
          ],
          operation: "upload",
        }),
      } as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(batchReturn).toMatchObject({
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
    });
    const parsedBatchReturnBody = JSON.parse(
      (batchReturn as APIGatewayProxyResult).body,
    );
    expect(parsedBatchReturnBody.transfer).toBe("basic");
    expect(parsedBatchReturnBody.objects).toEqual(
      expect.arrayContaining([
        { oid: "mockexists1", size: 123 }, // ensure no "actions" on existing object
      ]),
    );
    expect(parsedBatchReturnBody.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: {
            upload: {
              expires_at: expect.any(String),
              header: {
                "Content-Type": "application/octet-stream",
              },
              href: "https://mocked-jest-bucket.s3.us-west-2.amazonaws.com/mocknew1?...",
            },
          },
          authenticated: true,
          oid: "mocknew1",
          size: 456,
        }),
      ]),
    );
  });

  test("handler returns valid download response for new and existing objects", async () => {
    mockS3Send.mockImplementation(mockS3SendImplementation);
    const batchReturn = await handler(
      {
        body: JSON.stringify({
          objects: [
            { oid: "mockexists1", size: 123 },
            { oid: "mocknew1", size: 456 },
          ],
          operation: "download",
        }),
      } as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect(batchReturn).toMatchObject({
      headers: { "Content-Type": "application/vnd.git-lfs+json" },
    });
    const parsedBatchReturnBody = JSON.parse(
      (batchReturn as APIGatewayProxyResult).body,
    );
    expect(parsedBatchReturnBody.transfer).toBe("basic");
    expect(parsedBatchReturnBody.objects).toEqual(
      expect.arrayContaining([
        // ensure no "actions" on missing object
        {
          error: { code: 404, message: "Object does not exist" },
          oid: "mocknew1",
          size: 456,
        },
      ]),
    );
    expect(parsedBatchReturnBody.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: {
            download: {
              expires_at: expect.any(String),
              href: "https://mocked-jest-bucket.s3.us-west-2.amazonaws.com/mockexists1?...",
            },
          },
          authenticated: true,
          oid: "mockexists1",
          size: 123,
        }),
      ]),
    );
  });
});
