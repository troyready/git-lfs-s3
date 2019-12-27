/**
 * /objects/batch S3 mock module
 *
 * @packageDocumentation
 */

import { S3 } from "aws-sdk";

export class S3Adapter {
  public s3Client: undefined;
  constructor() {
    this.s3Client = undefined;
  }

  public async getSignedUrlPromise(operation: string, params: any) {
    return new Promise((resolve, reject) => {
      if (operation && "Bucket" in params && "Key" in params) {
        return resolve(
          "https://" +
            params.Bucket +
            ".s3.us-west-2.amazonaws.com/" +
            params.Key +
            "?...",
        );
      } else {
        reject(new Error("Missing required parameters"));
      }
    });
  }

  public headObject(params: S3.Types.HeadObjectRequest) {
    return {
      promise: () => {
        return new Promise((resolve, reject) => {
          if (["mockexists1", "mockexists2"].includes(params.Key)) {
            resolve({ ContentLength: 3191, ContentType: "image/jpeg" });
          } else {
            reject({ code: "NotFound" });
          }
        });
      },
    };
  }
}
