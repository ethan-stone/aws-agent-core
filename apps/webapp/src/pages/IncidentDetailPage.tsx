import {
  type ConversationDetail,
  type IncidentActivity,
  type IncidentComment,
  demoIncidents,
  demoSnapshot,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  createConversation,
  fetchConversation,
  fetchIncident,
  postIncidentComment,
} from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";
import {
  ConversationReplyBox,
  ConversationResultView,
} from "./CopilotPage.js";

export function IncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const initialValue = useMemo(() => {
    const incident = demoIncidents.find((item) => item.id === incidentId);
    if (!incident) {
      return null;
    }

    return {
      incident,
      activities: demoSnapshot.incidentActivities.filter(
        (activity) => activity.incidentId === incidentId
      ),
      comments: demoSnapshot.incidentComments.filter(
        (comment) => comment.incidentId === incidentId
      ),
      agentMentions: demoSnapshot.incidentAgentMentions.filter(
        (mention) => mention.incidentId === incidentId
      ),
      actionApprovals: demoSnapshot.incidentActionApprovals.filter(
        (approval) => approval.incidentId === incidentId
      ),
    };
  }, [incidentId]);

  const { data } = useResource(
    () => fetchIncident(incidentId),
    initialValue,
    [incidentId]
  );
  const [postedDetail, setPostedDetail] = useState<typeof data>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [linkedConversation, setLinkedConversation] =
    useState<ConversationDetail | null>(null);
  const [linkedConversationError, setLinkedConversationError] = useState<
    string | null
  >(null);
  const [linkedConversationLoading, setLinkedConversationLoading] =
    useState(false);
  const detail = postedDetail ?? data;

  if (!detail) {
    return (
      <section className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px] text-slate-200">
        Incident not found.
      </section>
    );
  }

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {detail.incident.category}
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-normal text-slate-50">
            {detail.incident.title}
          </h2>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <button
            type="button"
            onClick={() => void handleInvestigate()}
            disabled={running}
            className="border border-white/10 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {running ? "Investigating..." : "Investigate with AI"}
          </button>
          {error ? (
            <div className="max-w-sm border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </div>
      </header>
      <div className="grid gap-3.5">
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <h3 className="m-0 text-[15px] tracking-normal text-slate-100">
                Summary
              </h3>
              <p className="mt-3.5 text-base leading-7 text-slate-300">
                {detail.incident.summary}
              </p>
            </div>
            <dl className="m-0 grid min-w-56 gap-2 text-xs uppercase tracking-[0.08em]">
              <div className="flex justify-between gap-4 border-t border-white/8 pt-2">
                <dt className="text-slate-500">Status</dt>
                <dd className="m-0 text-slate-100">{detail.incident.status}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/8 pt-2">
                <dt className="text-slate-500">Severity</dt>
                <dd className="m-0 text-slate-100">{detail.incident.severity}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/8 pt-2">
                <dt className="text-slate-500">Opened</dt>
                <dd className="m-0 text-slate-100">
                  {new Date(detail.incident.createdAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-normal text-slate-100">
            Activity
          </h3>
          <IncidentThread
            activities={detail.activities}
            comments={detail.comments}
            onOpenConversation={(conversationId) =>
              void handleOpenLinkedConversation(conversationId)
            }
          />
          <form
            className="mt-5 grid gap-3 border-t border-white/8 pt-5"
            onSubmit={(event) => void handlePostComment(event)}
          >
            <textarea
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
              rows={3}
              placeholder="Leave a comment..."
              className="min-h-24 resize-y border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-300/40"
            />
            <div className="flex items-center justify-between gap-3">
              <span />
              <button
                type="submit"
                disabled={postingComment || !commentBody.trim()}
                className="border border-white/10 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {postingComment ? "Posting..." : "Post comment"}
              </button>
            </div>
            {commentError ? (
              <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
                {commentError}
              </div>
            ) : null}
          </form>
        </article>
      </div>

      <LinkedConversationDrawer
        conversation={linkedConversation}
        error={linkedConversationError}
        loading={linkedConversationLoading}
        onClose={() => {
          setLinkedConversation(null);
          setLinkedConversationError(null);
        }}
        onDetailChange={setLinkedConversation}
      />
    </section>
  );

  async function handleInvestigate() {
    setRunning(true);
    setError(null);

    try {
      const detail = await createConversation({
        agentKind: "ops-copilot",
        prompt: `Investigate incident ${incidentId}. Summarize the likely cause, strongest evidence, and next operator actions.`,
        incidentId,
      });
      setLinkedConversation(detail);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to investigate incident"
      );
    } finally {
      setRunning(false);
    }
  }

  async function handlePostComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body) {
      return;
    }

    setPostingComment(true);
    setCommentError(null);
    try {
      const next = await postIncidentComment(incidentId, body);
      setPostedDetail(next);
      setCommentBody("");
    } catch (err) {
      setCommentError(
        err instanceof Error ? err.message : "Failed to post comment"
      );
    } finally {
      setPostingComment(false);
    }
  }

  async function handleOpenLinkedConversation(conversationId: string) {
    setLinkedConversationLoading(true);
    setLinkedConversationError(null);
    try {
      setLinkedConversation(await fetchConversation(conversationId));
    } catch (err) {
      setLinkedConversation(null);
      setLinkedConversationError(
        err instanceof Error ? err.message : "Failed to load conversation"
      );
    } finally {
      setLinkedConversationLoading(false);
    }
  }

}

function IncidentThread(props: {
  activities: IncidentActivity[];
  comments: IncidentComment[];
  onOpenConversation: (conversationId: string) => void;
}) {
  const items = [
    ...props.activities.map((activity) => ({
      id: `activity:${activity.id}`,
      timestamp: activity.timestamp,
      kind: "activity" as const,
      activity,
    })),
    ...props.comments.map((comment) => ({
      id: `comment:${comment.id}`,
      timestamp: comment.createdAt,
      kind: "comment" as const,
      comment,
    })),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return (
    <div className="mt-4 grid gap-0">
      {items.map((item) =>
        item.kind === "activity" ? (
          <ActivityItem
            key={item.id}
            activity={item.activity}
            onOpenConversation={props.onOpenConversation}
          />
        ) : (
          <CommentItem key={item.id} comment={item.comment} />
        )
      )}
    </div>
  );
}

function ActivityItem(props: {
  activity: IncidentActivity;
  onOpenConversation: (conversationId: string) => void;
}) {
  const activity = props.activity;
  const isAgentCard = Boolean(activity.conversationId);
  const isMentionResponse = Boolean(activity.causedByCommentId);
  const content = (
    <>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-100">
          {isAgentCard ? agentDisplayName(activity.agentKind) : activity.title ?? activity.message}
        </span>
        {activity.agentStatus ? (
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
            {activity.agentStatus.replaceAll("_", " ")}
          </span>
        ) : null}
      </div>
      {isAgentCard ? (
        <p className="m-0 mt-2 text-xs text-slate-500">{activity.message}</p>
      ) : null}
      {activity.summary && activity.summary !== activity.title ? (
        <p className="m-0 mt-2 text-sm leading-6 text-slate-300">
          {activity.summary}
        </p>
      ) : null}
      <p className="m-0 mt-2 text-xs text-slate-600">
        {new Date(activity.timestamp).toLocaleString()}
      </p>
    </>
  );

  if (isAgentCard && activity.conversationId) {
    return (
      <TimelineShell tone="agent" inset={isMentionResponse}>
        <button
          type="button"
          onClick={() => props.onOpenConversation(activity.conversationId!)}
          className="w-full border border-sky-300/35 bg-sky-300/5 px-4 py-3 text-left text-slate-200 transition-colors hover:border-sky-200/60 hover:bg-sky-300/10"
        >
          {content}
          <div className="mt-3 flex items-center justify-between border-t border-sky-200/10 pt-2 text-xs text-sky-200/75">
            <span>{activity.title ?? "Open conversation"}</span>
            <span>Open</span>
          </div>
        </button>
      </TimelineShell>
    );
  }

  return (
    <TimelineShell tone="default">
      <div className="border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-slate-300">
        {content}
      </div>
    </TimelineShell>
  );
}

function CommentItem(props: { comment: IncidentComment }) {
  return (
    <TimelineShell tone="comment">
      <div className="border border-white/8 bg-black/15 px-4 py-3 text-sm text-slate-200">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>{props.comment.authorUserId}</span>
          <span>{new Date(props.comment.createdAt).toLocaleString()}</span>
        </div>
        <p className="m-0 whitespace-pre-wrap">
          {renderCommentBody(props.comment.body)}
        </p>
      </div>
    </TimelineShell>
  );
}

function TimelineShell(props: {
  children: ReactNode;
  inset?: boolean;
  tone: "default" | "comment" | "agent";
}) {
  const dotClass =
    props.tone === "agent"
      ? "border-sky-300/60 bg-sky-300/35"
      : props.tone === "comment"
        ? "border-fuchsia-300/50 bg-fuchsia-300/35"
        : "border-slate-400/40 bg-slate-400/25";

  return (
    <div
      className={`grid grid-cols-[22px_minmax(0,1fr)] gap-3 border-l border-white/10 pb-3 last:pb-0 ${
        props.inset ? "ml-7" : ""
      }`}
    >
      <div className="relative">
        <span
          className={`absolute left-[-6px] top-3 h-3 w-3 rounded-full border ${dotClass}`}
        />
      </div>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

function LinkedConversationDrawer(props: {
  conversation: ConversationDetail | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onDetailChange: (detail: ConversationDetail) => void;
}) {
  if (!props.conversation && !props.loading && !props.error) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/55"
      onClick={props.onClose}
    >
      <aside
        className="grid h-full w-full max-w-[620px] grid-rows-[auto_minmax(0,1fr)] border-l border-sky-200/20 bg-[#0d1219] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
          <div>
            <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Linked conversation
            </p>
            <h3 className="m-0 mt-1 text-[18px] tracking-normal text-slate-100">
              {props.conversation?.conversation.rootAgentKind ?? "Loading..."}
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/20 hover:text-slate-50"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          {props.loading ? (
            <p className="text-sm text-slate-400">Loading conversation...</p>
          ) : null}
          {props.error ? (
            <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
              {props.error}
            </div>
          ) : null}
          {props.conversation ? (
            <div className="grid gap-4">
              <ConversationResultView
                detail={props.conversation}
                onDetailChange={props.onDetailChange}
              />
              <ConversationReplyBox
                key={props.conversation.conversation.id}
                conversation={props.conversation}
                onDetailChange={props.onDetailChange}
              />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function renderCommentBody(body: string) {
  return body.split(/(@copilot)/g).map((part, index) =>
    part === "@copilot" ? (
      <span
        key={`${part}-${index}`}
        className="border border-sky-300/25 bg-sky-300/10 px-1.5 py-0.5 text-sky-100"
      >
        {part}
      </span>
    ) : (
      part
    )
  );
}

function agentDisplayName(agentKind?: IncidentActivity["agentKind"]) {
  if (agentKind === "ops-copilot") {
    return "Copilot conversation";
  }
  if (agentKind === "incident-responder") {
    return "Incident responder";
  }
  return "Agent conversation";
}
