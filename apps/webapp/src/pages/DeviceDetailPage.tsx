import {
  type DeviceMetricSnapshot,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchDevice, fetchDeviceTelemetry } from "../lib/api-client.js";
import { queryKeys } from "../lib/query-keys.js";

export function DeviceDetailPage() {
  const { deviceId = "" } = useParams();
  const { data: device, isLoading, error } = useQuery({
    queryKey: queryKeys.device(deviceId),
    queryFn: () => fetchDevice(deviceId),
    enabled: Boolean(deviceId),
  });
  const { data: telemetry = [] } = useQuery({
    queryKey: queryKeys.deviceTelemetry(deviceId),
    queryFn: () => fetchDeviceTelemetry(deviceId),
    enabled: Boolean(deviceId),
  });
  const recentTelemetry = mostRecentTelemetryWindow(telemetry, 15);

  if (!device) {
    return (
      <section className="rounded-md border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px] text-slate-200">
        {error?.message ?? (isLoading ? "Loading device..." : "Device not found.")}
      </section>
    );
  }

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {device.type}
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            {device.name}
          </h2>
        </div>
      </header>

      <div className="grid gap-3.5 md:grid-cols-2">
        <article className="rounded-md border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Current state
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
            <li>Status: {device.status}</li>
            <li>Source: {device.source}</li>
            <li>Firmware: {device.firmwareVersion}</li>
            <li>Battery: {device.batteryPercent}%</li>
            <li>Connectivity: {device.connectivityPercent}%</li>
          </ul>
        </article>
        <article className="rounded-md border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-[15px] tracking-normal text-slate-100">
                Recent telemetry
              </h3>
              <p className="m-0 mt-1 text-xs text-slate-500">
                Last 15 minutes from the newest sample
              </p>
            </div>
            <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">
              {recentTelemetry.length} samples
            </span>
          </div>
          <div className="mt-4 grid gap-2">
            {recentTelemetry.length > 0 ? (
              recentTelemetry.map((point) => (
                <TelemetryRow key={point.timestamp} point={point} />
              ))
            ) : (
              <p className="m-0 text-sm text-slate-500">
                No telemetry in the latest 15-minute window.
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function mostRecentTelemetryWindow(
  telemetry: DeviceMetricSnapshot[],
  minutes: number
): DeviceMetricSnapshot[] {
  const sorted = [...telemetry].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
  const latest = sorted.at(-1);
  if (!latest) {
    return [];
  }

  const latestTime = new Date(latest.timestamp).getTime();
  const cutoff = latestTime - minutes * 60 * 1000;
  return sorted.filter((point) => new Date(point.timestamp).getTime() >= cutoff);
}

function TelemetryRow(props: { point: DeviceMetricSnapshot }) {
  const point = props.point;
  const signalPercent = clampPercent(point.signalStrength);
  const packetLossPercent = clampPercent(point.packetLossPercent);
  const batteryPercent = clampPercent(point.batteryPercent);

  return (
    <div className="grid gap-2 rounded-md border border-white/8 bg-black/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-200">
          {new Date(point.timestamp).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {typeof point.temperatureC === "number" ? (
          <span className="text-xs text-slate-400">
            {point.temperatureC.toFixed(1)} C
          </span>
        ) : typeof point.vibrationMmS === "number" ? (
          <span className="text-xs text-slate-400">
            {point.vibrationMmS.toFixed(1)} mm/s
          </span>
        ) : null}
      </div>
      <TelemetryBar
        label="Signal"
        value={`${point.signalStrength}%`}
        percent={signalPercent}
        tone="sky"
      />
      <TelemetryBar
        label="Packet loss"
        value={`${point.packetLossPercent}%`}
        percent={packetLossPercent}
        tone={point.packetLossPercent > 10 ? "rose" : "amber"}
      />
      <TelemetryBar
        label="Battery"
        value={`${point.batteryPercent}%`}
        percent={batteryPercent}
        tone="emerald"
      />
    </div>
  );
}

function TelemetryBar(props: {
  label: string;
  value: string;
  percent: number;
  tone: "sky" | "amber" | "rose" | "emerald";
}) {
  const fillClass =
    props.tone === "rose"
      ? "bg-rose-300"
      : props.tone === "amber"
        ? "bg-amber-300"
        : props.tone === "emerald"
          ? "bg-emerald-300"
          : "bg-sky-300";

  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_42px] items-center gap-2 text-xs">
      <span className="text-slate-500">{props.label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full ${fillClass}`}
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <span className="text-right text-slate-300">{props.value}</span>
    </div>
  );
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
