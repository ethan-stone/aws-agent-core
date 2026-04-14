import { demoIncidents } from "../../../../shared/pulseforge-domain/src/index.js";
import { Link } from "react-router-dom";
import { fetchIncidents } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function IncidentsPage() {
  const { data } = useResource(fetchIncidents, demoIncidents, []);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Incidents</h2>
        </div>
      </header>

      <div className="incident-list">
        {data.map((incident) => (
          <article key={incident.id} className="panel incident-card">
            <div className="incident-heading">
              <p className={`pill ${incident.severity}`}>{incident.severity}</p>
              <p>{incident.status}</p>
            </div>
            <h3>
              <Link to={`/incidents/${incident.id}`}>{incident.title}</Link>
            </h3>
            <p>{incident.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
