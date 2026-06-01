import { type Incident } from "../../../../shared/pulseforge-domain/src/index.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchIncidents } from "../lib/api-client.js";
import { queryKeys } from "../lib/query-keys.js";

export function IncidentsPage() {
  const { data = [] as Incident[], isLoading, error } = useQuery({
    queryKey: queryKeys.incidents,
    queryFn: fetchIncidents,
  });

  return (
    <section className="grid gap-5">
      <header className="flex flex-col items-start justify-between gap-5 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Operations
          </p>
          <h2 className="mt-1.5 text-[32px] leading-tight font-semibold tracking-normal text-slate-50">
            Incidents
          </h2>
        </div>
        <p className="m-0 max-w-[34ch] text-sm text-slate-500">
          Follow simulator-triggered incidents and open the investigation thread
          when the copilot starts working.
        </p>
      </header>

      <div className="grid gap-3">
        {error ? (
          <div className="rounded-md border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
            {error.message}
          </div>
        ) : null}
        {isLoading && data.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-[22px] text-sm text-slate-500">
            Loading incidents...
          </div>
        ) : null}
        {!isLoading && data.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-[22px] text-sm text-slate-500">
            No incidents yet.
          </div>
        ) : null}
        {data.map((incident) => (
          <article
            key={incident.id}
            className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-4 transition-colors hover:border-white/15 hover:bg-white/[0.045]"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={incident.severity} />
                <StatusBadge status={incident.status} />
              </div>
              <p className="m-0 text-xs text-slate-500">
                {new Date(incident.updatedAt).toLocaleString()}
              </p>
            </div>
            <h3 className="m-0 text-[16px] font-semibold tracking-normal text-slate-100">
              <Link
                to={`/incidents/${incident.id}`}
                className="transition-colors hover:text-emerald-100"
              >
                {incident.title}
              </Link>
            </h3>
            <p className="m-0 mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              {incident.summary}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SeverityBadge(props: { severity: Incident["severity"] }) {
  const className =
    props.severity === "critical"
      ? "border-rose-300/35 bg-rose-300/10 text-rose-100"
      : props.severity === "high"
        ? "border-orange-300/35 bg-orange-300/10 text-orange-100"
        : props.severity === "medium"
          ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
          : "border-slate-300/20 bg-slate-300/8 text-slate-300";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs capitalize ${className}`}>
      {props.severity}
    </span>
  );
}

function StatusBadge(props: { status: Incident["status"] }) {
  const className =
    props.status === "resolved"
      ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-100"
      : props.status === "open"
        ? "border-rose-300/35 bg-rose-300/10 text-rose-100"
        : props.status === "investigating"
          ? "border-sky-300/35 bg-sky-300/10 text-sky-100"
          : "border-amber-300/35 bg-amber-300/10 text-amber-100";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium capitalize ${className}`}>
      {props.status}
    </span>
  );
}
