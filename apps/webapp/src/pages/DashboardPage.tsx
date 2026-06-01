import { fetchDashboard } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DashboardPage() {
  const { data, loading, error } = useResource(fetchDashboard, null, []);

  if (!data) {
    return (
      <section className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-[22px] text-slate-200">
        {error ?? (loading ? "Loading fleet health..." : "Dashboard unavailable.")}
      </section>
    );
  }

  const totalDevices = Math.max(data.totalDevices, 1);
  const healthyPercent = (data.healthyDevices / totalDevices) * 100;
  const warningPercent = (data.warningDevices / totalDevices) * 100;
  const criticalPercent = (data.criticalDevices / totalDevices) * 100;
  const offlinePercent = (data.offlineDevices / totalDevices) * 100;

  return (
    <section className="grid gap-6">
      <header className="flex flex-col items-start justify-between gap-5 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Overview
          </p>
          <h2 className="mt-1.5 text-[32px] leading-tight font-semibold tracking-normal text-slate-50">
            Fleet health
          </h2>
        </div>
        <div className="rounded-md border border-emerald-300/20 bg-emerald-300/8 px-3 py-2 text-sm text-emerald-100">
          {data.openIncidents} open incident{data.openIncidents === 1 ? "" : "s"}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Sites" value={data.totalSites} />
        <MetricCard label="Devices" value={data.totalDevices} />
        <MetricCard label="Warnings" value={data.warningDevices} tone="amber" />
        <MetricCard label="Critical" value={data.criticalIncidents} tone="rose" />
      </div>

      <section className="rounded-md border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h3 className="m-0 text-[16px] font-semibold tracking-normal text-slate-100">
              Device status
            </h3>
            <p className="m-0 mt-1 text-sm text-slate-500">
              Current simulator and fleet state from the backend.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 text-sm md:w-auto md:grid-cols-2 lg:grid-cols-4">
            <StatusLegend label="Healthy" value={data.healthyDevices} tone="emerald" />
            <StatusLegend label="Warning" value={data.warningDevices} tone="amber" />
            <StatusLegend label="Critical" value={data.criticalDevices} tone="rose" />
            <StatusLegend label="Offline" value={data.offlineDevices} tone="slate" />
          </div>
        </div>

        <div className="mt-5 flex h-3 overflow-hidden rounded-md bg-black/30">
          <div className="bg-emerald-300/75" style={{ width: `${healthyPercent}%` }} />
          <div className="bg-amber-300/75" style={{ width: `${warningPercent}%` }} />
          <div className="bg-rose-300/75" style={{ width: `${criticalPercent}%` }} />
          <div className="bg-slate-500/75" style={{ width: `${offlinePercent}%` }} />
        </div>
      </section>
    </section>
  );
}

function MetricCard(props: {
  label: string;
  value: number;
  tone?: "amber" | "rose";
}) {
  const toneClass =
    props.tone === "rose"
      ? "text-rose-200"
      : props.tone === "amber"
        ? "text-amber-200"
        : "text-slate-50";

  return (
    <article className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-4">
      <span className="text-xs uppercase tracking-[0.1em] text-slate-500">
        {props.label}
      </span>
      <strong className={`mt-1 block text-[34px] font-semibold tracking-normal ${toneClass}`}>
        {props.value}
      </strong>
    </article>
  );
}

function StatusLegend(props: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const dotClass =
    props.tone === "emerald"
      ? "bg-emerald-300"
      : props.tone === "amber"
        ? "bg-amber-300"
        : props.tone === "rose"
          ? "bg-rose-300"
          : "bg-slate-500";

  return (
    <div className="flex min-w-28 items-center justify-between gap-3 rounded-md bg-black/15 px-2.5 py-2 text-slate-300">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span>{props.label}</span>
      </span>
      <strong className="font-semibold text-slate-100">{props.value}</strong>
    </div>
  );
}
