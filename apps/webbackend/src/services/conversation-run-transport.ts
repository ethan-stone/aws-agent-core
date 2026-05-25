import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  AgentRun,
  ConversationDetail,
} from "../../../../shared/pulseforge-domain/src/index.js";
import type { ApiAppEnv } from "../types.js";
import {
  type WebBackendDiagnosticContext,
  extendDiagnostics,
  webBackendDiagnostics,
} from "./webbackend-diagnostics.js";

type ConversationRunHttpStatus = 200 | 201 | 502;

export function wantsConversationEventStream(acceptHeader?: string | null) {
  return acceptHeader?.includes("text/event-stream") ?? false;
}

export function conversationRunStatus(
  detail: ConversationDetail,
  successStatus: 200 | 201
): ConversationRunHttpStatus {
  return latestRun(detail)?.status === "failed" ? 502 : successStatus;
}

export function conversationDetailEventStream(
  c: Context<ApiAppEnv>,
  details: AsyncGenerator<ConversationDetail>,
  options: {
    status?: 200 | 201;
    diagnostics?: WebBackendDiagnosticContext;
  } = {}
) {
  const startedAt = Date.now();
  const status = options.status ?? 200;

  webBackendDiagnostics.conversationStreamOpened(options.diagnostics, {
    status,
  });

  c.status(status);
  c.header("cache-control", "no-cache, no-transform");
  c.header("connection", "keep-alive");

  return streamSSE(
    c,
    async (stream) => {
      let snapshots = 0;
      stream.onAbort(() => {
        webBackendDiagnostics.conversationStreamClosed(options.diagnostics, {
          snapshots,
          durationMs: Date.now() - startedAt,
        });
      });

      for await (const detail of details) {
        snapshots += 1;
        const run = latestRun(detail);
        webBackendDiagnostics.conversationStreamSnapshot(
          extendDiagnostics(options.diagnostics, {
            conversationId: detail.conversation.id,
            runId: run?.id,
            agentKind: run?.agentKind,
          }),
          {
            conversationId: detail.conversation.id,
            runId: run?.id,
            runStatus: run?.status,
            runItems: run ? (detail.itemsByRunId[run.id] ?? []).length : 0,
          }
        );
        await stream.writeSSE({
          event: "conversation",
          data: JSON.stringify(detail),
        });
      }

      webBackendDiagnostics.conversationStreamClosed(options.diagnostics, {
        snapshots,
        durationMs: Date.now() - startedAt,
      });
      await stream.close();
    },
    async (error, stream) => {
      webBackendDiagnostics.conversationStreamError(
        options.diagnostics,
        error
      );
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          error: error instanceof Error ? error.message : "Agent run failed.",
        }),
      });
      await stream.close();
    }
  );
}

function latestRun(detail: ConversationDetail): AgentRun | null {
  return detail.runs.at(-1) ?? null;
}
