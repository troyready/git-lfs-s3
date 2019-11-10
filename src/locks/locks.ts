/**
 * \<lfsendpoint\>/locks and \<lfsendpoint\>/locks/* API
 */

/** imports (delete comment after https://github.com/TypeStrong/typedoc/issues/603 resolution) */
import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import "source-map-support/register";

/** AWS Lambda entrypoint */
export let handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  // Lock API isn't implemented, and probably won't ever be necessary
  // for S3 storage
  return {
    body: JSON.stringify({ message: "lock API not yet implemented" }),
    statusCode: 404,
  };
};
