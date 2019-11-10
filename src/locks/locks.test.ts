import { handler } from "./locks";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

describe("Test handler", () => {
  test("Verify 404 is returned", async () => {
    function unusedCallback<T>() {
      return (undefined as any) as T;
    }

    const data = await handler(
      {} as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(),
    );
    expect((data as APIGatewayProxyResult).statusCode).toBe(404);
  });
});
