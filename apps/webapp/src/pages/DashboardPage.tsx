import { demoDashboard } from "../../../../shared/pulseforge-domain/src/index.js";
import { fetchDashboard } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DashboardPage() {
  const { data } = useResource(fetchDashboard, demoDashboard, []);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Fleet health at a glance</h2>
        </div>
      </header>

      <div className="grid four">
        <MetricCard label="Sites" value={data.totalSites} />
        <MetricCard label="Devices" value={data.totalDevices} />
        <MetricCard label="Open incidents" value={data.openIncidents} />
        <MetricCard label="Critical incidents" value={data.criticalIncidents} />
      </div>

      <div className="grid two">
        <article className="panel">
          <h3>Device status</h3>
          <ul className="stat-list">
            <li>Healthy: {data.healthyDevices}</li>
            <li>Warning: {data.warningDevices}</li>
            <li>Critical: {data.criticalDevices}</li>
            <li>Offline: {data.offlineDevices}</li>
          </ul>
        </article>
        <article className="panel">
          <h3>Next build targets</h3>
          <ul className="stat-list">
            <li>Incident investigation workspace</li>
            <li>Backend AgentCore invocation service</li>
            <li>Autonomous remediation job pipeline</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

function MetricCard(props: { label: string; value: number }) {
  return (
    <article className="panel metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}
