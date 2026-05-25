import {
  type ConversationDetail,
  demoIncidents,
  demoSnapshot,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { createConversation, fetchIncident } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function IncidentDetailPage() {
  const { incidentId = "" } = useParams();
  const initialValue = useMemo(() => {
    const incident = demoIncidents.find((item) => item.id === incidentId);
    if (!incident) {
      return null;
    }

    return {
      incident,
      events: demoSnapshot.incidentEvents.filter(
        (event) => event.incidentId === incidentId
      ),
    };
  }, [incidentId]);

  const { data } = useResource(
    () => fetchIncident(incidentId),
    initialValue,
    [incidentId]
  );
  const [investigation, setInvestigation] = useState<ConversationDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) {
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
            {data.incident.category}
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            {data.incident.title}
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
      <div className="grid gap-3.5 md:grid-cols-2">
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Summary
          </h3>
          <p className="mt-3.5 text-slate-300">{data.incident.summary}</p>
        </article>
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Timeline
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
            {data.events.map((event) => (
              <li key={event.id}>
                {new Date(event.timestamp).toLocaleTimeString()}: {event.message}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="mt-3.5 border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
        <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
          AI investigation
        </h3>

        {!investigation ? (
          <p className="mt-3.5 text-sm text-slate-400">
            Run an investigation to generate findings and recommended actions for this incident.
          </p>
        ) : (
          <div className="mt-3.5 grid gap-4">
            <div className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
                Summary
              </span>
              <p className="m-0 text-sm text-slate-200">
                {cleanText(
                  latestRun(investigation)?.summary ?? "Agent run completed."
                )}
              </p>
            </div>

            {latestRun(investigation)?.investigation ? (
              <div className="grid gap-3">
                <h4 className="m-0 text-sm font-medium text-slate-100">
                  {cleanText(
                    latestRun(investigation)?.investigation?.title ?? ""
                  )}
                </h4>
                <p className="m-0 text-sm text-slate-300">
                  {cleanText(
                    latestRun(investigation)?.investigation?.summary ?? ""
                  )}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <SimpleList
                    label="Findings"
                    items={
                      latestRun(investigation)?.investigation?.findings.map(
                        cleanText
                      ) ?? []
                    }
                  />
                  <SimpleList
                    label="Recommended actions"
                    items={
                      latestRun(investigation)?.investigation
                        ?.recommendedActions.map(cleanText) ?? []
                    }
                  />
                </div>
              </div>
            ) : null}

            {latestRun(investigation)?.errorMessage ? (
              <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
                {latestRun(investigation)?.errorMessage}
              </div>
            ) : null}
          </div>
        )}
      </article>
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
      setInvestigation(detail);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to investigate incident"
      );
    } finally {
      setRunning(false);
    }
  }
}

function latestRun(detail: ConversationDetail) {
  return detail.runs.at(-1) ?? null;
}

function cleanText(value: string): string {
  return value
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .trim();
}

function SimpleList(props: { label: string; items: string[] }) {
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
