import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  AgentRun,
  ContentBlock,
  ConversationDetail,
  ConversationSummary,
  RunItem,
} from "../../../../shared/pulseforge-domain/src/index.js";
import {
  createConversation,
  createConversationRun,
  fetchConversation,
  fetchConversations,
  resolveRequiredAction,
} from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

const starterPrompts = [
  {
    label: "Incident summary",
    prompt: "Summarize incident inc-1001 and recommend the next operator action.",
  },
  {
    label: "Fleet question",
    prompt: "Which fleet issues should an operator prioritize right now?",
  },
  {
    label: "Device focus",
    prompt: "What looks abnormal about dev-freezer-014 based on the current context?",
  },
];
const timelinePreviewLimit = 520;

export function CopilotPage() {
  const { data: conversations } = useResource(
    () => fetchConversations(),
    [] as ConversationSummary[],
    []
  );
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(starterPrompts[0].prompt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError(null);

    try {
      const nextConversation = await createConversation({
        agentKind: "ops-copilot",
        prompt,
      });
      navigate(`/copilot/${nextConversation.conversation.id}`);
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
          Start a new conversation or reopen prior copilot work.
        </p>
      </header>

      <div className="grid gap-3.5">
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <NewConversationForm
            prompt={prompt}
            loading={loading}
            onPromptChange={setPrompt}
            onSubmit={handleSubmit}
          />

          {error ? (
            <div className="mt-4 border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </article>

        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-normal text-slate-100">
            Conversations
          </h3>
          <div className="mt-4 grid gap-2">
            {conversations.length > 0 ? (
              conversations.map((item) => (
                <Link
                  key={item.conversation.id}
                  to={`/copilot/${item.conversation.id}`}
                  className="border border-white/8 bg-black/15 px-3 py-3 text-slate-200 transition-colors hover:border-sky-300/35 hover:bg-sky-300/5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium">
                      {item.title}
                    </span>
                    {item.latestRun &&
                    shouldShowConversationListStatus(item.latestRun.status) ? (
                      <span className={statusBadgeClass(item.latestRun.status)}>
                        {item.latestRun.status}
                      </span>
                    ) : null}
                  </div>
                  {item.preview ? (
                    <p className="m-0 mt-2 line-clamp-2 text-sm text-slate-400">
                      {cleanText(item.preview)}
                    </p>
                  ) : null}
                  <p className="m-0 mt-2 text-xs text-slate-600">
                    {new Date(item.updatedAt).toLocaleString()} · {item.itemCount}{" "}
                    {item.itemCount === 1 ? "item" : "items"}
                  </p>
                </Link>
              ))
            ) : (
              <p className="m-0 text-sm text-slate-400">
                No conversations yet.
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function NewConversationForm(props: {
  prompt: string;
  loading: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {starterPrompts.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              props.onPromptChange(item.prompt);
            }}
            className="border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-slate-50"
          >
            {item.label}
          </button>
        ))}
      </div>

      <form className="grid gap-4" onSubmit={props.onSubmit}>
        <label className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
            Start a new conversation
          </span>
          <textarea
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            rows={4}
            className="min-h-28 resize-y border border-white/10 bg-black/15 px-3 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
            placeholder="Ask the ops copilot to summarize an incident or explain abnormal fleet behavior."
          />
        </label>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={props.loading || props.prompt.trim().length === 0}
            className="border border-white/10 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-400"
          >
            {props.loading ? "Starting..." : "Start conversation"}
          </button>
        </div>
      </form>
    </>
  );
}

export function CopilotConversationPage() {
  const { conversationId = "" } = useParams();
  const { data, error } = useResource(
    () => fetchConversation(conversationId),
    null as ConversationDetail | null,
    [conversationId]
  );
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    null
  );

  useEffect(() => {
    setConversation(data);
  }, [data]);

  if (!conversation) {
    return (
      <section>
        <Link to="/copilot" className="text-sm text-slate-400 hover:text-slate-100">
          Back to conversations
        </Link>
        <div className="mt-5 border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px] text-sm text-slate-300">
          {error ?? "Loading conversation..."}
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-h-[calc(100vh-112px)] grid-rows-[auto_minmax(0,1fr)] gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-4">
        <div>
          <Link to="/copilot" className="text-sm text-slate-500 hover:text-slate-100">
            Back to conversations
          </Link>
          <h2 className="m-0 mt-2 text-[28px] leading-tight font-medium tracking-normal text-slate-50">
            Ops Copilot
          </h2>
          <p className="m-0 mt-1 text-sm text-slate-500">
            {conversation.conversation.incidentId ?? conversation.conversation.id}
          </p>
        </div>
        {latestRun(conversation) ? (
          <span className={statusBadgeClass(latestRun(conversation)!.status)}>
            {latestRun(conversation)!.status}
          </span>
        ) : null}
      </header>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
        <div className="min-h-0 overflow-y-auto px-1 py-2">
          <ConversationResultView
            detail={conversation}
            onDetailChange={setConversation}
          />
        </div>
        <ConversationReplyBox
          conversation={conversation}
          onDetailChange={setConversation}
        />
      </div>
    </section>
  );
}

export function ConversationReplyBox(props: {
  conversation: ConversationDetail;
  onDetailChange: (detail: ConversationDetail) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isObserveOnly =
    props.conversation.conversation.interactionMode === "observe_only";

  async function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || loading || isObserveOnly) {
      return;
    }
    setLoading(true);
    setError(null);
    setPrompt("");
    try {
      const detail = await createConversationRun(
        props.conversation.conversation.id,
        {
          prompt: trimmed,
          incidentId: props.conversation.conversation.incidentId,
        },
        props.onDetailChange
      );
      props.onDetailChange(detail);
    } catch (err) {
      setPrompt(trimmed);
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="grid gap-2 pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        value={prompt}
        disabled={isObserveOnly}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.metaKey) {
            event.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder={
          isObserveOnly
            ? "This conversation is observe-only."
            : "Send a message..."
        }
        className="min-h-20 resize-y border border-white/10 bg-black/15 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-300/35 disabled:cursor-not-allowed disabled:text-slate-500"
      />
      <div className="flex items-center justify-between gap-3">
        {error ? (
          <span className="text-sm text-rose-200">{error}</span>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={loading || !prompt.trim() || isObserveOnly}
          className="border border-white/10 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>
    </form>
  );
}

export function ConversationResultView(props: {
  detail: ConversationDetail;
  onDetailChange: (detail: ConversationDetail) => void;
}) {
  const entries = conversationTimelineEntries(props.detail);
  const items = conversationRunItems(props.detail);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const activeRun = [...props.detail.runs]
    .reverse()
    .find((run) => isRunActive(run.status));
  const authAction = findPendingAuthAction(items);
  const approval = findPendingToolApproval(props.detail);
  const approvalAction = approval?.action ?? null;
  const approvalRun = approval?.run ?? null;
  const [approvalLoading, setApprovalLoading] = useState<
    "allow_once" | "allow_always" | "decline" | null
  >(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  useEffect(() => {
    if (activeRun) {
      timelineEndRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeRun?.id, activeRun?.status, entries.length]);

  async function handleApproval(
    decision: "allow_once" | "allow_always" | "decline"
  ) {
    if (!approvalRun || !approvalAction) {
      return;
    }

    setApprovalLoading(decision);
    setApprovalError(null);
    try {
      const detail = await resolveRequiredAction(
        approvalRun.id,
        approvalAction.requiredActionId,
        {
          outcome: decision === "decline" ? "declined" : "resolved",
          decision,
        }
      );
      props.onDetailChange(detail);
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : "Failed to resolve action."
      );
    } finally {
      setApprovalLoading(null);
    }
  }

  return (
    <div className="grid gap-4">
      {entries.length > 0 ? (
        <div className="grid gap-0">
          {entries.map((entry) => (
            <ConversationTimelineRow key={entry.id} entry={entry} />
          ))}
          <div ref={timelineEndRef} />
        </div>
      ) : (
        <div className="border border-white/8 bg-black/15 px-4 py-3 text-sm text-slate-400">
          No conversation activity yet.
        </div>
      )}

      {authAction ? (
        <div className="grid gap-3 border border-amber-300/30 bg-amber-300/8 px-3 py-3 text-sm text-amber-100">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-amber-200/70">
              Authorization required
            </div>
            <p className="m-0 text-amber-100">
              Copilot requires authorization to perform delegated actions with{" "}
              {authAction.data.providerDisplayName ??
                authAction.data.providerName}
              .
            </p>
          </div>
          <div className="text-xs text-amber-100/75">
            Requested scopes: {authAction.data.scopes.join(", ")}
          </div>
          <a
            href={authAction.data.authUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit border border-amber-200/40 px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-amber-50 transition-colors hover:border-amber-100 hover:bg-amber-100 hover:text-slate-950"
          >
            Open authorization URL
          </a>
        </div>
      ) : null}

      {approval && approvalAction ? (
        <div className="grid gap-3 border border-sky-300/30 bg-sky-300/8 px-3 py-3 text-sm text-sky-100">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-sky-200/70">
              Approval required
            </div>
            <p className="m-0 text-sky-100">
              {approvalAction.data.approvalLabel ??
                approvalAction.data.description}
            </p>
          </div>
          <div className="grid gap-1 text-xs text-sky-100/75">
            <span>Tool: {approvalAction.data.toolName ?? "requested action"}</span>
            {approvalAction.data.risk ? (
              <span>Risk: {approvalAction.data.risk}</span>
            ) : null}
          </div>
          {approvalError ? (
            <div className="border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">
              {approvalError}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(approvalLoading)}
              onClick={() => handleApproval("allow_once")}
              className="max-w-full whitespace-normal border border-sky-100/40 bg-sky-100 px-3 py-1.5 text-xs uppercase leading-4 tracking-[0.08em] text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-sky-300/50"
            >
              {approvalLoading === "allow_once" ? "Approving..." : "Allow once"}
            </button>
            <button
              type="button"
              disabled={Boolean(approvalLoading)}
              onClick={() => handleApproval("allow_always")}
              className="max-w-full whitespace-normal border border-sky-100/40 bg-sky-100 px-3 py-1.5 text-xs uppercase leading-4 tracking-[0.08em] text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-sky-300/50"
            >
              {approvalLoading === "allow_always"
                ? "Approving..."
                : approvalAction.data.allowAlwaysLabel ?? "Always allow"}
            </button>
            <button
              type="button"
              disabled={Boolean(approvalLoading)}
              onClick={() => handleApproval("decline")}
              className="max-w-full whitespace-normal border border-sky-200/30 px-3 py-1.5 text-xs uppercase leading-4 tracking-[0.08em] text-sky-50 transition-colors hover:border-sky-100 hover:bg-sky-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approvalLoading === "decline" ? "Declining..." : "Decline"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ConversationTimelineEntry =
  | { id: string; type: "item"; run: AgentRun; item: RunItem }
  | {
      id: string;
      type: "internal_work";
      run: AgentRun;
      items: RunItem[];
      active: boolean;
    }
  | { id: string; type: "summary"; run: AgentRun; text: string }
  | {
      id: string;
      type: "investigation";
      run: AgentRun;
      investigation: {
        title: string;
        summary: string;
        findings: string[];
        recommendedActions: string[];
      };
    }
  | { id: string; type: "run_error"; run: AgentRun; message: string }
  | { id: string; type: "progress"; run: AgentRun; itemCount: number };

function conversationTimelineEntries(
  detail: ConversationDetail
): ConversationTimelineEntry[] {
  return [...detail.runs]
    .sort(compareRuns)
    .flatMap((run) => {
      const items = [...(detail.itemsByRunId[run.id] ?? [])].sort(
        (left, right) => left.sequence - right.sequence
      );
      const entries: ConversationTimelineEntry[] = [];
      let internalItems: RunItem[] = [];
      const flushInternalWork = () => {
        if (internalItems.length === 0) {
          return;
        }
        const first = internalItems[0];
        const last = internalItems.at(-1);
        entries.push({
          id: `${run.id}:internal:${first?.sequence ?? 0}:${
            last?.sequence ?? 0
          }`,
          type: "internal_work",
          run,
          items: internalItems,
          active: isRunActive(run.status),
        });
        internalItems = [];
      };

      for (const item of items) {
        if (isConversationMessage(item)) {
          flushInternalWork();
          entries.push({
            id: item.id,
            type: "item",
            run,
            item,
          });
        } else {
          internalItems.push(item);
        }
      }
      flushInternalWork();

      const hasAgentMessage = items.some(
        (item) => item.kind === "message" && item.role === "agent"
      );

      if (run.summary && !hasAgentMessage) {
        entries.push({
          id: `${run.id}:summary`,
          type: "summary",
          run,
          text: cleanText(run.summary),
        });
      }

      if (run.investigation && !hasAgentMessage && !run.summary) {
        entries.push({
          id: `${run.id}:investigation`,
          type: "investigation",
          run,
          investigation: {
            title: cleanText(run.investigation.title),
            summary: cleanText(run.investigation.summary),
            findings: run.investigation.findings.map(cleanText).filter(Boolean),
            recommendedActions: run.investigation.recommendedActions
              .map(cleanText)
              .filter(Boolean),
          },
        });
      }

      if (run.errorMessage) {
        entries.push({
          id: `${run.id}:error`,
          type: "run_error",
          run,
          message: run.errorMessage,
        });
      }

      if (isRunActive(run.status)) {
        entries.push({
          id: `${run.id}:progress`,
          type: "progress",
          run,
          itemCount: items.length,
        });
      }

      return entries;
    });
}

function conversationRunItems(detail: ConversationDetail): RunItem[] {
  return [...detail.runs]
    .sort(compareRuns)
    .flatMap((run) =>
      [...(detail.itemsByRunId[run.id] ?? [])].sort(
        (left, right) => left.sequence - right.sequence
      )
    );
}

function isConversationMessage(item: RunItem): boolean {
  return item.kind === "message";
}

function compareRuns(left: AgentRun, right: AgentRun) {
  return runTimestamp(left).localeCompare(runTimestamp(right));
}

function runTimestamp(run: AgentRun) {
  return run.startedAt ?? run.completedAt ?? "";
}

function ConversationTimelineRow(props: { entry: ConversationTimelineEntry }) {
  if (props.entry.type === "item") {
    return <RunItemRow item={props.entry.item} />;
  }

  if (props.entry.type === "internal_work") {
    return <InternalWorkRow entry={props.entry} />;
  }

  if (props.entry.type === "summary") {
    return (
      <TimelineTextRow
        label="Agent response"
        tone="success"
        time={props.entry.run.completedAt ?? props.entry.run.startedAt}
      >
        <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-100">
          {props.entry.text}
        </p>
      </TimelineTextRow>
    );
  }

  if (props.entry.type === "investigation") {
    return (
      <TimelineTextRow
        label="Investigation"
        tone="success"
        time={props.entry.run.completedAt ?? props.entry.run.startedAt}
      >
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h4 className="m-0 text-sm font-medium text-slate-100">
              {props.entry.investigation.title}
            </h4>
            <p className="m-0 text-sm leading-6 text-slate-300">
              {props.entry.investigation.summary}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <ResultList
              label="Findings"
              items={props.entry.investigation.findings}
            />
            <ResultList
              label="Recommended actions"
              items={props.entry.investigation.recommendedActions}
            />
          </div>
        </div>
      </TimelineTextRow>
    );
  }

  if (props.entry.type === "run_error") {
    return (
      <TimelineTextRow
        label="Run failed"
        tone="danger"
        time={props.entry.run.completedAt ?? props.entry.run.startedAt}
      >
        <p className="m-0 text-sm leading-6 text-rose-100">
          {props.entry.message}
        </p>
      </TimelineTextRow>
    );
  }

  return (
    <RunProgressRow
      status={props.entry.run.status}
      itemCount={props.entry.itemCount}
    />
  );
}

function InternalWorkRow(props: {
  entry: Extract<ConversationTimelineEntry, { type: "internal_work" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const latestItem = props.entry.items.at(-1);
  const latestDetails = latestItem ? runItemDisplay(latestItem) : null;
  const summary = latestItem
    ? internalWorkSummary(latestItem, props.entry.active)
    : "Preparing the next step.";

  return (
    <TimelineTextRow
      label={props.entry.active ? "Copilot is working" : "Copilot work"}
      tone={props.entry.active ? "info" : "neutral"}
      time={latestItem?.createdAt}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group w-full border border-transparent px-2 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/[0.035] focus-visible:border-sky-300/40 focus-visible:bg-sky-300/5 focus-visible:outline-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm leading-6 text-slate-300 transition-colors group-hover:text-slate-100">
            {summary}
          </span>
          <span className="text-xs text-slate-500 transition-colors group-hover:text-sky-200">
            {expanded ? "Hide details" : "Show details"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600 transition-colors group-hover:text-slate-500">
          <span>
            {props.entry.items.length}{" "}
            {props.entry.items.length === 1 ? "step" : "steps"}
          </span>
          {latestDetails?.meta ? <span>{latestDetails.meta}</span> : null}
        </div>
      </button>

      {expanded ? (
        <div className="mt-2 border-l border-white/10 pl-3">
          {props.entry.items.map((item) => (
            <RunItemRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </TimelineTextRow>
  );
}

function TimelineTextRow(props: {
  children: ReactNode;
  label: string;
  tone: ReturnType<typeof runItemDisplay>["tone"];
  time?: string;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
          {props.label}
        </span>
        {props.time ? (
          <span className="text-xs text-slate-600">
            {formatTime(props.time)}
          </span>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

function RunItemRow(props: { item: RunItem }) {
  const details = runItemDisplay(props.item);
  const [expanded, setExpanded] = useState(false);
  const canExpand =
    props.item.kind !== "message" && details.body.length > timelinePreviewLimit;
  const visibleBody =
    canExpand && !expanded
      ? `${details.body.slice(0, timelinePreviewLimit).trimEnd()}...`
      : details.body;

  if (props.item.kind === "message") {
    return <MessageTimelineRow details={details} role={props.item.role} />;
  }

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-left">
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
            {details.label}
          </span>
          {details.meta ? (
            <span className={metaBadgeClass(details.tone)}>{details.meta}</span>
          ) : null}
          {details.time ? (
            <span className="text-xs text-slate-600">{details.time}</span>
          ) : null}
        </div>
        {details.title ? (
          <div className="mb-1 text-sm font-medium text-slate-100">
            {details.title}
          </div>
        ) : null}
        {canExpand ? (
          <OutputToggleButton
            expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          />
        ) : null}
        {details.format === "code" ? (
          <pre className="m-0 mt-2 overflow-x-auto whitespace-pre rounded border border-white/8 bg-black/20 px-3 py-2 font-mono text-xs leading-5 text-slate-200">
            {visibleBody}
          </pre>
        ) : (
          <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
            {visibleBody}
          </p>
        )}
        {canExpand && expanded ? (
          <OutputToggleButton
            expanded={expanded}
            onClick={() => setExpanded(false)}
            position="bottom"
          />
        ) : null}
      </div>
    </div>
  );
}

function MessageTimelineRow(props: {
  details: ReturnType<typeof runItemDisplay>;
  role: Extract<RunItem, { kind: "message" }>["role"];
}) {
  const isUser = props.role === "user";

  return (
    <div
      className={`flex py-3 first:pt-0 last:pb-0 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[78%] min-w-0 ${
          isUser ? "text-right" : "text-left"
        }`}
      >
        <div
          className={`mb-1 flex flex-wrap items-center gap-2 ${
            isUser ? "justify-end" : "justify-start"
          }`}
        >
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
            {props.details.label}
          </span>
          {props.details.time ? (
            <span className="text-xs text-slate-600">
              {props.details.time}
            </span>
          ) : null}
        </div>
        <p
          className={`m-0 whitespace-pre-wrap break-words text-sm leading-6 ${
            isUser ? "font-medium text-slate-100" : "text-slate-200"
          }`}
        >
          {props.details.body}
        </p>
      </div>
    </div>
  );
}

function OutputToggleButton(props: {
  expanded: boolean;
  onClick: () => void;
  position?: "top" | "bottom";
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`w-fit border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-sky-300/35 hover:bg-sky-300/5 hover:text-sky-100 focus-visible:border-sky-300/45 focus-visible:bg-sky-300/8 focus-visible:outline-none ${
        props.position === "bottom" ? "mt-2" : ""
      }`}
    >
      {props.expanded ? "Show preview" : "Show full output"}
    </button>
  );
}

function RunProgressRow(props: {
  itemCount: number;
  status: AgentRun["status"];
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
            {isRunActive(props.status) ? "Waiting" : "No activity"}
          </span>
          <span className="border border-sky-300/20 px-2 py-0.5 text-xs text-sky-200">
            {props.status}
          </span>
        </div>
        <p className="m-0 text-sm leading-6 text-slate-300">
          {isRunActive(props.status)
            ? props.itemCount > 0
              ? "Copilot is still working."
              : "Copilot is starting."
            : "No run items were recorded for this run."}
        </p>
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

type AuthRequiredActionItem = Extract<
  RunItem,
  { kind: "required_action" }
> & {
  actionType: "auth_required";
  data: {
    type: "auth_required";
    providerName: string;
    providerDisplayName?: string;
    authUrl: string;
    scopes: string[];
    agentRunId: string;
  };
};

type ToolApprovalActionItem = Extract<
  RunItem,
  { kind: "required_action" }
> & {
  actionType: "tool_approval";
  data: {
    type: "tool_approval";
    title: string;
    description: string;
    actionLabel: string;
    risk?: string;
    toolName?: string;
    toolUseId?: string;
    input?: unknown;
    approvalKey: string;
    approvalLabel: string;
    allowAlwaysLabel: string;
    agentRunId: string;
  };
};

function findPendingAuthAction(items: RunItem[]): AuthRequiredActionItem | null {
  return (
    items.find(
      (item): item is AuthRequiredActionItem =>
        item.kind === "required_action" &&
        item.actionType === "auth_required" &&
        item.status === "pending" &&
        isAuthRequiredActionData(item.data)
    ) ?? null
  );
}

function findPendingToolApprovalAction(
  items: RunItem[]
): ToolApprovalActionItem | null {
  return (
    items.find(
      (item): item is ToolApprovalActionItem =>
        item.kind === "required_action" &&
        item.actionType === "tool_approval" &&
        item.status === "pending" &&
        isToolApprovalActionData(item.data)
    ) ?? null
  );
}

function findPendingToolApproval(
  detail: ConversationDetail
): { run: AgentRun; action: ToolApprovalActionItem } | null {
  for (const run of [...detail.runs].reverse()) {
    const action = findPendingToolApprovalAction(
      detail.itemsByRunId[run.id] ?? []
    );
    if (action) {
      return { run, action };
    }
  }

  return null;
}

function isAuthRequiredActionData(
  value: unknown
): value is AuthRequiredActionItem["data"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "auth_required" &&
    "providerName" in value &&
    typeof value.providerName === "string" &&
    "authUrl" in value &&
    typeof value.authUrl === "string" &&
    "scopes" in value &&
    Array.isArray(value.scopes)
  );
}

function isToolApprovalActionData(
  value: unknown
): value is ToolApprovalActionItem["data"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "tool_approval" &&
    "title" in value &&
    typeof value.title === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "actionLabel" in value &&
    typeof value.actionLabel === "string" &&
    "approvalKey" in value &&
    typeof value.approvalKey === "string" &&
    "approvalLabel" in value &&
    typeof value.approvalLabel === "string" &&
    "allowAlwaysLabel" in value &&
    typeof value.allowAlwaysLabel === "string" &&
    "agentRunId" in value &&
    typeof value.agentRunId === "string"
  );
}

function runItemDisplay(item: RunItem): {
  label: string;
  body: string;
  title?: string;
  meta?: string;
  time?: string;
  format?: "text" | "code";
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
} {
  if (item.kind === "message") {
    return {
      label: item.role === "agent" ? "Agent response" : item.role,
      body: contentToText(item.content) || "No message content returned.",
      time: formatTime(item.createdAt),
      tone: item.role === "agent" ? "success" : "neutral",
    };
  }

  if (item.kind === "tool_call") {
    return {
      label: "Tool call",
      title: item.toolName,
      body: formatJson(item.arguments),
      meta: item.status,
      time: formatTime(item.createdAt),
      format: "code",
      tone:
        item.status === "succeeded"
          ? "success"
          : item.status === "failed"
            ? "danger"
            : "info",
    };
  }

  if (item.kind === "tool_result") {
    return {
      label: item.isError ? "Tool error" : "Tool result",
      body: contentToText(item.content) || "Tool completed.",
      meta: item.isError ? "failed" : "received",
      time: formatTime(item.createdAt),
      format: hasJsonContent(item.content) ? "code" : "text",
      tone: item.isError ? "danger" : "success",
    };
  }

  if (item.kind === "required_action") {
    if (
      item.actionType === "tool_approval" &&
      isToolApprovalActionData(item.data)
    ) {
      return {
        label: "Approval required",
        body: item.data.description,
        title: item.data.title,
        meta: item.status,
        time: formatTime(item.createdAt),
        tone: "warning",
      };
    }

    if (
      item.actionType === "auth_required" &&
      isAuthRequiredActionData(item.data)
    ) {
      return {
        label: "Authorization required",
        body: `Authorize ${item.data.providerDisplayName ?? item.data.providerName}.`,
        meta: item.status,
        time: formatTime(item.createdAt),
        tone: "warning",
      };
    }

    return {
      label: "Action required",
      body: contentToText(item.content) || item.actionType,
      meta: item.status,
      time: formatTime(item.createdAt),
      tone: "warning",
    };
  }

  if (item.kind === "action_resolution") {
    return {
      label: "Action resolved",
      body: contentToText(item.content ?? []) || `Action ${item.outcome}.`,
      meta: item.outcome,
      time: formatTime(item.createdAt),
      tone: item.outcome === "resolved" ? "success" : "warning",
    };
  }

  if (item.kind === "run_agent") {
    return {
      label: "Agent run",
      body: item.agentKind,
      meta: item.status,
      time: formatTime(item.createdAt),
      tone: isRunActive(item.status) ? "info" : "success",
    };
  }

  return {
    label: "Run note",
    body: cleanText(item.message),
    meta: item.noteType,
    time: formatTime(item.createdAt),
    tone: "neutral",
  };
}

function internalWorkSummary(item: RunItem, active: boolean): string {
  if (item.kind === "tool_call") {
    if (item.status === "pending" || active) {
      return `Calling ${item.toolName}.`;
    }
    return `Called ${item.toolName}.`;
  }

  if (item.kind === "tool_result") {
    return item.isError ? "A tool returned an error." : "Reading tool results.";
  }

  if (item.kind === "required_action") {
    if (
      item.actionType === "tool_approval" &&
      isToolApprovalActionData(item.data)
    ) {
      return item.status === "pending"
        ? `Waiting for approval: ${item.data.approvalLabel}.`
        : `Approval ${item.status}.`;
    }
    if (
      item.actionType === "auth_required" &&
      isAuthRequiredActionData(item.data)
    ) {
      return item.status === "pending"
        ? `Waiting for authorization with ${
            item.data.providerDisplayName ?? item.data.providerName
          }.`
        : `Authorization ${item.status}.`;
    }
    return item.status === "pending"
      ? "Waiting for operator action."
      : `Action ${item.status}.`;
  }

  if (item.kind === "action_resolution") {
    return `Action ${item.outcome}.`;
  }

  if (item.kind === "run_agent") {
    return active
      ? `Running ${agentKindLabel(item.agentKind)}.`
      : `${agentKindLabel(item.agentKind)} finished.`;
  }

  if (item.kind === "message") {
    return contentToText(item.content) || "Reading the latest message.";
  }

  return cleanText(item.message);
}

function agentKindLabel(agentKind: AgentRun["agentKind"]): string {
  if (agentKind === "ops-copilot") {
    return "copilot";
  }
  if (agentKind === "incident-responder") {
    return "incident responder";
  }
  return agentKind;
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isRunActive(status: AgentRun["status"]): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "auth_required" ||
    status === "waiting_for_action"
  );
}

function shouldShowConversationListStatus(status: AgentRun["status"]): boolean {
  return (
    status === "running" ||
    status === "auth_required" ||
    status === "waiting_for_action"
  );
}

function timelineDotClass(
  tone: ReturnType<typeof runItemDisplay>["tone"] = "neutral"
): string {
  const base = "absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full border";
  if (tone === "success") {
    return `${base} border-emerald-300/60 bg-emerald-300/30`;
  }
  if (tone === "warning") {
    return `${base} border-amber-300/60 bg-amber-300/30`;
  }
  if (tone === "danger") {
    return `${base} border-rose-300/60 bg-rose-300/30`;
  }
  if (tone === "info") {
    return `${base} border-sky-300/60 bg-sky-300/30`;
  }
  return `${base} border-slate-500 bg-slate-950`;
}

function metaBadgeClass(
  tone: ReturnType<typeof runItemDisplay>["tone"] = "neutral"
): string {
  const base = "border px-2 py-0.5 text-xs";
  if (tone === "success") {
    return `${base} border-emerald-300/20 text-emerald-200`;
  }
  if (tone === "warning") {
    return `${base} border-amber-300/20 text-amber-200`;
  }
  if (tone === "danger") {
    return `${base} border-rose-300/20 text-rose-200`;
  }
  if (tone === "info") {
    return `${base} border-sky-300/20 text-sky-200`;
  }
  return `${base} border-white/10 text-slate-500`;
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
