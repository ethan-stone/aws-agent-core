import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { fromIni } from "@aws-sdk/credential-providers";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config({
  quiet: true,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---

const PORT = parseInt(process.env.WEBAPP_PORT || "9090");
const REGION = process.env.AWS_REGION || "us-east-1";
const RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;
const ENDPOINT_URL =
  process.env.BEDROCK_AGENT_CORE_ENDPOINT_URL ??
  `https://bedrock-agentcore.${REGION}.amazonaws.com`;

if (!RUNTIME_ARN) {
  console.error("AGENT_RUNTIME_ARN environment variable is required");
  process.exit(1);
}

const RUNTIME_URL = `${ENDPOINT_URL}/runtimes/${encodeURIComponent(
  RUNTIME_ARN
)}/invocations?qualifier=DEFAULT`;

const bedrockClient = new BedrockAgentCoreClient({
  region: REGION,
  ...(process.env.AWS_PROFILE && {
    credentials: fromIni({ profile: process.env.AWS_PROFILE }),
  }),
});

// --- Fastify setup ---

const app = Fastify({ logger: true });

await app.register(fastifyCookie);
await app.register(fastifySession, {
  secret:
    process.env.SESSION_SECRET ||
    "dev-secret-change-in-production-" + randomUUID(),
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
});

// --- Helpers ---

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
}

// --- Types ---

declare module "fastify" {
  interface Session {
    userId?: string;
    userToken?: string;
  }
}

// --- Routes ---

app.get("/ping", async () => ({ status: "ok" }));

app.post<{ Body: { prompt: string } }>("/api/chat", async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply
      .code(401)
      .send({ error: "Missing or invalid Authorization header" });
  }

  const jwt = authHeader.slice(7);

  let userId: string;
  try {
    const payload = decodeJwtPayload(jwt);
    userId = payload.sub as string;
  } catch {
    return reply.code(401).send({ error: "Invalid JWT format" });
  }

  const { prompt } = request.body ?? {};
  if (!prompt) {
    return reply.code(400).send({ error: "Missing prompt in request body" });
  }

  // Store JWT in session for the OAuth callback
  request.session.userId = userId;
  request.session.userToken = jwt;
  await request.session.save();

  const sessionId = `${userId}-${randomUUID()}`;

  const response = await fetch(RUNTIME_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${jwt}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": userId,
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    request.log.error(
      { status: response.status, body: errorBody },
      "Runtime error"
    );
    return reply
      .code(response.status)
      .send({ error: `Runtime error: ${errorBody}` });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return reply.code(500).send({ error: "No response body from runtime" });
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const decoder = new TextDecoder();
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      reply.raw.write(decoder.decode(result.value, { stream: true }));
    }
  }
  reply.raw.end();
});

app.get<{ Querystring: { session_id?: string } }>(
  "/oauth2/callback",
  async (request, reply) => {
    const sessionUri = request.query.session_id;
    const userToken = request.session.userToken;
    const userId = request.session.userId;

    if (!sessionUri) {
      return reply.code(400).type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Error</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1 style="color:#ef4444">Missing session_id</h1>
          <p>The OAuth callback URL is missing the session_id parameter.</p>
        </body></html>
      `);
    }

    if (!userToken) {
      return reply.code(400).type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Error</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1 style="color:#ef4444">Session Not Found</h1>
          <p>No user token found. Please send a chat request first.</p>
        </body></html>
      `);
    }

    try {
      await bedrockClient.send(
        new CompleteResourceTokenAuthCommand({
          sessionUri,
          userIdentifier: { userToken },
        })
      );

      request.log.info({ userId }, "OAuth completed");

      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Authorization Complete</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px">
          <div style="color:#10b981;font-size:48px">&#10003;</div>
          <h1>Authorization Complete</h1>
          <p>You can close this window and return to the app.</p>
        </body></html>
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      request.log.error({ error }, "OAuth completion error");

      return reply.code(500).type("text/html").send(`
        <!DOCTYPE html>
        <html><head><title>Error</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1 style="color:#ef4444">Authorization Failed</h1>
          <p>${message}</p>
        </body></html>
      `);
    }
  }
);

// --- Start ---

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Webapp listening on http://localhost:${PORT}`);
