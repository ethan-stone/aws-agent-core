import {
  demoIncidents,
  demoSnapshot,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { fetchIncident } from "../lib/api-client.js";
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
    </section>
  );
}
