import { streamHandle } from "hono/aws-lambda";
import type { LambdaContext, LambdaEvent } from "hono/aws-lambda";
import { app } from "./app.js";

type LambdaCallback<TResult = unknown> = (
  error?: Error | string | null,
  result?: TResult,
) => void;

type LambdaHandler<TResult = unknown> = (
  event: LambdaEvent,
  context: LambdaContext,
  callback: LambdaCallback<TResult>,
) => void | Promise<TResult>;

export const handler: LambdaHandler = streamHandle(app);
