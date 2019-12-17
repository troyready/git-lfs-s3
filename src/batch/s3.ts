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
    return this.s3Client.getSignedUrlPromise(operation, params);
  }

  public headObject(params: S3.Types.HeadObjectRequest) {
    return this.s3Client.headObject(params);
  }
}
