/**
 * /objects/batch S3 module
 */

// This doesn't really need to exist separately from the primary API module,
// but it's currently easier to test as a separate module.
// Specifically, jest mocks of getSignedUrl need to be made from a
// client imported by "import * as S3 from 'aws-sdk/clients/s3'", while
// other mocks like headObject need to be made from a client imported by
// " import { S3 } from 'aws-sdk'".

/** imports (delete comment after https://github.com/TypeStrong/typedoc/issues/603 resolution) */
import { S3 } from "aws-sdk";

export class S3Adapter {
  public s3Client: S3;
  constructor() {
    this.s3Client = new S3();
  }

  public async getSignedUrlPromise(operation: string, params: any) {
    // Can simplify this to a direct getSignedUrlPromise invocation after
    // shipped sdk updated to >=2.520.0
    // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
    return new Promise((resolve, reject) => {
      this.s3Client.getSignedUrl(operation, params, (err, url) => {
        if (err) {
          reject(err);
        } else {
          resolve(url);
        }
      });
    });
  }

  public headObject(params: S3.Types.HeadObjectRequest) {
    return this.s3Client.headObject(params);
  }
}
