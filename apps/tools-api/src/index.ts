import { handle } from "hono/aws-lambda";
import { toolsApi } from "./app.js";

export const handler = handle(toolsApi);
