import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { MemoryHook } from "./memory-hook.js";
import { withAccessToken } from "bedrock-agentcore/identity";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({
  quiet: true,
});

const bedrockAgentCoreClient = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_PROFILE
    ? fromIni({
        profile: process.env.AWS_PROFILE,
      })
    : undefined,
});

const memoryId = process.env.MEMORY_ID;
if (!memoryId) {
  throw new Error("MEMORY_ID environment variable is required");
}

const memoryHook = new MemoryHook({
  client: bedrockAgentCoreClient,
  memoryId,
});

const bedrockModel = new BedrockModel({
  modelId: "us.anthropic.claude-opus-4-5-20251101-v1:0",
  clientConfig: process.env.AWS_PROFILE
    ? {
        credentials: fromIni({
          profile: process.env.AWS_PROFILE,
        }),
      }
    : undefined,
});

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  const json = Buffer.from(payload, "base64url").toString("utf-8");
  return JSON.parse(json);
}

function createAuthSignal() {
  let resolve: ((url: string) => void) | null = null;
  let promise = new Promise<string>((r) => {
    resolve = r;
  });

  return {
    emit(url: string) {
      resolve?.(url);
      promise = new Promise<string>((r) => {
        resolve = r;
      });
    },
    wait() {
      return promise;
    },
  };
}

const authSignal = createAuthSignal();

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ prompt: z.string() }),
    process: async function* (request, context) {
      const prompt = request.prompt;
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      if (prompt === "introspect") {
        if (!context.workloadAccessToken) {
          yield {
            event: "error",
            data: { message: "No workload access token available" },
          };
          return;
        }

        const introspectToken = withAccessToken({
          providerName: "resource-provider-oauth-client-amkjf",
          scopes: ["openid"],
          authFlow: "USER_FEDERATION",
          onAuthUrl: (url) => {
            console.log("[agent] Auth required - URL received");
            authSignal.emit(url);
          },
          forceAuthentication: true,
          workloadIdentityToken: context.workloadAccessToken,
          callbackUrl:
            process.env.OAUTH_CALLBACK_URL ||
            "http://localhost:9090/oauth2/callback",
        })(async (token: string) => {
          return decodeJwt(token);
        });

        const tokenPromise = introspectToken();

        const authUrl = await authSignal.wait();
        yield { event: "auth_url", data: { authUrl } };

        const claims = await tokenPromise;
        yield { event: "token_claims", data: { claims } };
        return;
      }

      memoryHook.setSessionId(context.sessionId);

      const messages = await memoryHook.loadConversation(context.sessionId);

      console.log(
        `Loaded ${messages.length} messages from memory for session ${context.sessionId}`
      );

      const agent = new Agent({
        model: bedrockModel,
        hooks: [memoryHook],
        messages,
      });

      try {
        const result = await agent.invoke(prompt);
        yield { event: "message", data: { text: result } };
      } catch (error) {
        console.log(error);
      }
    },
  },
});

app.run();
