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
    return <section className="panel">Incident not found.</section>;
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">{data.incident.category}</p>
          <h2>{data.incident.title}</h2>
        </div>
      </header>
      <div className="grid two">
        <article className="panel">
          <h3>Summary</h3>
          <p>{data.incident.summary}</p>
        </article>
        <article className="panel">
          <h3>Timeline</h3>
          <ul className="stat-list">
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
