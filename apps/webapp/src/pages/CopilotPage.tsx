import { useState } from "react";
import type {
  AgentRun,
  ContentBlock,
  ConversationDetail,
  MessageRunItem,
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
        ? await createConversationRun(conversation.conversation.id, request)
        : await createConversation({
            agentKind: "ops-copilot",
            ...request,
          });
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
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            Ops Copilot Workspace
          </h2>
        </div>
        <p className="m-0 max-w-[34ch] text-sm text-slate-400">
          This page now executes through conversation runs, with ordered run
          items as the interaction source of truth.
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
                Backend route: `POST /api/conversations`
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
            <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
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
  const messages = items.filter(
    (item): item is MessageRunItem => item.kind === "message"
  );

  return (
    <div className="grid gap-5">
      <div className="grid gap-2 border-t border-white/8 pt-4">
        <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
          Summary
        </span>
        <p className="m-0 text-sm text-slate-200">
          {run.summary ?? "Agent run completed."}
        </p>
        {run.errorMessage ? (
          <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
            {run.errorMessage}
          </div>
        ) : null}
      </div>

      {run.investigation ? (
        <div className="grid gap-3 border-t border-white/8 pt-4">
          <h4 className="m-0 text-sm font-medium text-slate-100">
            {run.investigation.title}
          </h4>
          <p className="m-0 text-sm text-slate-300">
            {run.investigation.summary}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <ResultList label="Findings" items={run.investigation.findings} />
            <ResultList
              label="Recommended actions"
              items={run.investigation.recommendedActions}
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

      {messages.length > 0 ? (
        <div className="grid gap-3 border-t border-white/8 pt-4">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
            Messages
          </span>
          <div className="grid gap-2.5">
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} />
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

function MessageRow(props: { message: MessageRunItem }) {
  return (
    <div className="border border-white/8 bg-black/10 px-3 py-2.5">
      <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-slate-500">
        {props.message.role}
      </div>
      <p className="m-0 whitespace-pre-line text-sm text-slate-200">
        {contentToText(props.message.content)}
      </p>
    </div>
  );
}

function latestRun(detail: ConversationDetail): AgentRun | null {
  return detail.runs.at(-1) ?? null;
}

function contentToText(content: ContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      if (block.type === "json") {
        return JSON.stringify(block.value);
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
