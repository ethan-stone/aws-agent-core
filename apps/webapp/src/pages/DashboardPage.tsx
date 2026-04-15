import { demoDashboard } from "../../../../shared/pulseforge-domain/src/index.js";
import { fetchDashboard } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DashboardPage() {
  const { data } = useResource(fetchDashboard, demoDashboard, []);

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Overview
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            Fleet health at a glance
          </h2>
        </div>
        <p className="m-0 max-w-[34ch] text-sm text-slate-400">
          A compact operating picture for incidents, fleet health, and agent
          readiness.
        </p>
      </header>

      <div className="mb-3.5 grid gap-3.5 md:grid-cols-4">
        <MetricCard label="Sites" value={data.totalSites} />
        <MetricCard label="Devices" value={data.totalDevices} />
        <MetricCard label="Open incidents" value={data.openIncidents} />
        <MetricCard label="Critical incidents" value={data.criticalIncidents} />
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Device status
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
            <li>Healthy: {data.healthyDevices}</li>
            <li>Warning: {data.warningDevices}</li>
            <li>Critical: {data.criticalDevices}</li>
            <li>Offline: {data.offlineDevices}</li>
          </ul>
        </article>
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Next build targets
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
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
    <article className="flex flex-col gap-1.5 border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
      <span className="text-xs uppercase tracking-[0.1em] text-slate-500">
        {props.label}
      </span>
      <strong className="text-[40px] font-semibold tracking-[-0.08em] text-slate-50">
        {props.value}
      </strong>
    </article>
  );
}
