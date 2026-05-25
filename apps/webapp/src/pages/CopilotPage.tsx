import { useState } from "react";
import type {
  AgentRun,
  ContentBlock,
  ConversationDetail,
  RunItem,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  createConversation,
  createConversationRun,
} from "../lib/api-client.js";

const starterPrompts = [
  {
    label: "Incident summary",
    prompt: "Summarize incident inc-1001 and recommend the next operator action.",
    incidentId: "inc-1001",
  },
  {
    label: "Fleet question",
    prompt: "Which fleet issues should an operator prioritize right now?",
  },
  {
    label: "Device focus",
    prompt: "What looks abnormal about dev-freezer-014 based on the current context?",
    deviceId: "dev-freezer-014",
  },
];

export function CopilotPage() {
  const [prompt, setPrompt] = useState(starterPrompts[0].prompt);
  const [incidentId, setIncidentId] = useState(
    starterPrompts[0].incidentId ?? ""
  );
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    null
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError(null);

    try {
      const request = {
        prompt,
        incidentId: incidentId || undefined,
        deviceId: deviceId || undefined,
      };
      const nextConversation = conversation
        ? await createConversationRun(
            conversation.conversation.id,
            request,
            setConversation
          )
        : await createConversation(
            {
              agentKind: "ops-copilot",
              ...request,
            },
            setConversation
          );
      setConversation(nextConversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Agents
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-normal text-slate-50">
            Ops Copilot Workspace
          </h2>
        </div>
        <p className="m-0 max-w-[34ch] text-sm text-slate-400">
          Current incident context, fleet evidence, and operator-ready next
          actions.
        </p>
      </header>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <div className="mb-5 flex flex-wrap gap-2">
            {starterPrompts.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setPrompt(item.prompt);
                  setIncidentId(item.incidentId ?? "");
                  setDeviceId(item.deviceId ?? "");
                }}
                className="border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-slate-50"
              >
                {item.label}
              </button>
            ))}
          </div>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                Prompt
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={6}
                className="min-h-36 resize-y border border-white/10 bg-black/15 px-3 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
                placeholder="Ask the ops copilot to summarize an incident or explain abnormal fleet behavior."
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                  Incident Id
                </span>
                <input
                  value={incidentId}
                  onChange={(event) => setIncidentId(event.target.value)}
                  className="border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
                  placeholder="inc-1001"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                  Device Id
                </span>
                <input
                  value={deviceId}
                  onChange={(event) => setDeviceId(event.target.value)}
                  className="border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
                  placeholder="dev-freezer-014"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="text-xs uppercase tracking-[0.08em] text-slate-500">
                {conversation ? "Conversation open" : "New conversation"}
              </div>
              <button
                type="submit"
                disabled={loading || prompt.trim().length === 0}
                className="border border-white/10 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-400"
              >
                {loading ? "Running..." : "Run agent"}
              </button>
            </div>
          </form>
        </article>

        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="m-0 text-[15px] tracking-normal text-slate-100">
              Latest run
            </h3>
            {conversation ? (
              <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                {latestRun(conversation)?.status}
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {!conversation && !error ? (
            <p className="text-sm text-slate-400">
              Submit a prompt to create an auditable conversation through the API.
            </p>
          ) : null}

          {conversation ? <ConversationResultView detail={conversation} /> : null}
        </article>
      </div>
    </section>
  );
}

function ConversationResultView(props: { detail: ConversationDetail }) {
  const run = latestRun(props.detail);
  if (!run) {
    return null;
  }

  const items = props.detail.itemsByRunId[run.id] ?? [];
  const summary = cleanText(run.summary ?? "No summary returned.");
  const investigation = run.investigation
    ? {
        title: cleanText(run.investigation.title),
        summary: cleanText(run.investigation.summary),
        findings: run.investigation.findings.map(cleanText).filter(Boolean),
        recommendedActions: run.investigation.recommendedActions
          .map(cleanText)
          .filter(Boolean),
      }
    : null;

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 border-t border-white/8 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
            Run summary
          </span>
          <span className={statusBadgeClass(run.status)}>{run.status}</span>
        </div>
        <p className="m-0 text-sm leading-6 text-slate-100">{summary}</p>
        {run.errorMessage ? (
          <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
            {run.errorMessage}
          </div>
        ) : null}
      </div>

      {investigation ? (
        <div className="grid gap-3 border-t border-white/8 pt-4">
          <div className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
              Investigation
            </span>
            <h4 className="m-0 text-sm font-medium text-slate-100">
              {investigation.title}
            </h4>
          </div>
          <p className="m-0 text-sm leading-6 text-slate-300">
            {investigation.summary}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <ResultList label="Findings" items={investigation.findings} />
            <ResultList
              label="Recommended actions"
              items={investigation.recommendedActions}
            />
          </div>
        </div>
      ) : null}

      {run.authRequired ? (
        <div className="grid gap-3 border border-amber-300/30 bg-amber-300/8 px-3 py-3 text-sm text-amber-100">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-amber-200/70">
              Authorization required
            </div>
            <p className="m-0 text-amber-100">
              Copilot requires authorization to perform delegated actions with{" "}
              {run.authRequired.providerDisplayName ??
                run.authRequired.providerName}
              .
            </p>
          </div>
          <div className="text-xs text-amber-100/75">
            Requested scopes: {run.authRequired.scopes.join(", ")}
          </div>
          <a
            href={run.authRequired.authUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit border border-amber-200/40 px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-amber-50 transition-colors hover:border-amber-100 hover:bg-amber-100 hover:text-slate-950"
          >
            Open authorization URL
          </a>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="grid gap-3 border-t border-white/8 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
              Activity
            </span>
            <span className="text-xs text-slate-500">{items.length} items</span>
          </div>
          <div className="grid gap-0">
            {items.map((item) => (
              <RunItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-1 border-t border-white/8 pt-4 text-xs uppercase tracking-[0.08em] text-slate-500">
        <span>Conversation Id: {props.detail.conversation.id}</span>
        <span>Run Id: {run.id}</span>
        <span>Agent: {run.agentKind}</span>
        {run.startedAt ? (
          <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
        ) : null}
      </div>
    </div>
  );
}

function RunItemRow(props: { item: RunItem }) {
  const details = runItemDisplay(props.item);

  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 border-l border-white/10 py-3 first:pt-0 last:pb-0">
      <div className="relative">
        <span className="absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full border border-slate-500 bg-slate-950" />
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
            {details.label}
          </span>
          {details.meta ? (
            <span className="text-xs text-slate-600">{details.meta}</span>
          ) : null}
        </div>
        {details.format === "code" ? (
          <pre className="m-0 overflow-x-auto whitespace-pre rounded border border-white/8 bg-black/20 px-3 py-2 font-mono text-xs leading-5 text-slate-200">
            {details.body}
          </pre>
        ) : (
          <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
            {details.body}
          </p>
        )}
      </div>
    </div>
  );
}

function latestRun(detail: ConversationDetail): AgentRun | null {
  return detail.runs.at(-1) ?? null;
}

function contentToText(content: ContentBlock[]): string {
  const text = content
    .map((block) => {
      if (block.type === "text") {
        return cleanText(block.text);
      }

      if (block.type === "json") {
        return JSON.stringify(block.value, null, 2);
      }

      if (block.type === "resource_ref") {
        return `${block.resourceType}: ${block.resourceId}`;
      }

      if (block.type === "file") {
        return block.name ?? block.fileId;
      }

      return block.alt ?? block.fileId;
    })
    .join("\n");

  return cleanText(text);
}

function ResultList(props: { label: string; items: string[] }) {
  return (
    <div className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
        {props.label}
      </span>
      {props.items.length > 0 ? (
        <ul className="grid gap-2 pl-[18px] text-sm text-slate-300">
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-slate-500">No items returned.</p>
      )}
    </div>
  );
}

function runItemDisplay(item: RunItem): {
  label: string;
  body: string;
  meta?: string;
  format?: "text" | "code";
} {
  if (item.kind === "message") {
    return {
      label: item.role === "agent" ? "Agent response" : item.role,
      body: contentToText(item.content) || "No message content returned.",
      meta: formatTime(item.createdAt),
    };
  }

  if (item.kind === "tool_call") {
    return {
      label: "Tool call",
      body: item.toolName,
      meta: item.status,
    };
  }

  if (item.kind === "tool_result") {
    return {
      label: item.isError ? "Tool error" : "Tool result",
      body: contentToText(item.content) || "Tool completed.",
      meta: item.toolCallId,
      format: hasJsonContent(item.content) ? "code" : "text",
    };
  }

  if (item.kind === "required_action") {
    return {
      label: "Action required",
      body: contentToText(item.content) || item.actionType,
      meta: item.status,
    };
  }

  if (item.kind === "action_resolution") {
    return {
      label: "Action resolved",
      body: contentToText(item.content ?? []) || `Action ${item.outcome}.`,
      meta: item.requiredActionId,
    };
  }

  if (item.kind === "run_agent") {
    return {
      label: "Agent run",
      body: item.agentKind,
      meta: item.status,
    };
  }

  return {
    label: "Run note",
    body: cleanText(item.message),
    meta: item.noteType,
  };
}

function hasJsonContent(content: ContentBlock[]): boolean {
  return content.some((block) => block.type === "json");
}

function cleanText(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: AgentRun["status"]): string {
  const base =
    "border px-2 py-1 text-[11px] uppercase tracking-[0.08em]";
  if (status === "completed") {
    return `${base} border-emerald-300/25 text-emerald-200`;
  }
  if (status === "failed" || status === "cancelled") {
    return `${base} border-rose-300/25 text-rose-200`;
  }
  if (status === "auth_required" || status === "waiting_for_action") {
    return `${base} border-amber-300/25 text-amber-200`;
  }
  return `${base} border-sky-300/25 text-sky-200`;
}
