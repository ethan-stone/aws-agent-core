import { demoIncidents } from "../../../../shared/pulseforge-domain/src/index.js";
import { Link } from "react-router-dom";
import { fetchIncidents } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function IncidentsPage() {
  const { data } = useResource(fetchIncidents, demoIncidents, []);

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Operations
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            Incidents
          </h2>
        </div>
      </header>

      <div className="grid gap-3">
        {data.map((incident) => (
          <article
            key={incident.id}
            className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <p
                className={`inline-flex border px-2.5 py-1 text-xs capitalize ${
                  incident.severity === "critical"
                    ? "border-rose-300 text-rose-300"
                    : incident.severity === "high"
                      ? "border-orange-300 text-orange-300"
                      : "border-amber-300 text-amber-300"
                }`}
              >
                {incident.severity}
              </p>
              <p className="text-sm text-slate-400">{incident.status}</p>
            </div>
            <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
              <Link
                to={`/incidents/${incident.id}`}
                className="transition-colors hover:text-slate-300"
              >
                {incident.title}
              </Link>
            </h3>
            <p className="mt-2 text-slate-300">{incident.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
