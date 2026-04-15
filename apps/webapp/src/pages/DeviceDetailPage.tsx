import { demoDevices } from "../../../../shared/pulseforge-domain/src/index.js";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { fetchDevice, fetchDeviceTelemetry } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DeviceDetailPage() {
  const { deviceId = "" } = useParams();
  const initialDevice = useMemo(
    () => demoDevices.find((device) => device.id === deviceId) ?? null,
    [deviceId]
  );
  const { data: device } = useResource(
    () => fetchDevice(deviceId),
    initialDevice,
    [deviceId]
  );
  const { data: telemetry } = useResource(
    () => fetchDeviceTelemetry(deviceId),
    [],
    [deviceId]
  );

  if (!device) {
    return (
      <section className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px] text-slate-200">
        Device not found.
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
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Current state
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
            <li>Status: {device.status}</li>
            <li>Firmware: {device.firmwareVersion}</li>
            <li>Battery: {device.batteryPercent}%</li>
            <li>Connectivity: {device.connectivityPercent}%</li>
          </ul>
        </article>
        <article className="border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
          <h3 className="m-0 text-[15px] tracking-[-0.02em] text-slate-100">
            Recent telemetry
          </h3>
          <ul className="mt-3.5 pl-[18px] text-slate-300">
            {telemetry.map((point) => (
              <li key={point.timestamp}>
                {new Date(point.timestamp).toLocaleTimeString()}: signal{" "}
                {point.signalStrength}, loss {point.packetLossPercent}%
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
