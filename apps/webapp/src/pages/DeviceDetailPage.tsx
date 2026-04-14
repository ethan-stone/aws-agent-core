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
    return <section className="panel">Device not found.</section>;
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">{device.type}</p>
          <h2>{device.name}</h2>
        </div>
      </header>

      <div className="grid two">
        <article className="panel">
          <h3>Current state</h3>
          <ul className="stat-list">
            <li>Status: {device.status}</li>
            <li>Firmware: {device.firmwareVersion}</li>
            <li>Battery: {device.batteryPercent}%</li>
            <li>Connectivity: {device.connectivityPercent}%</li>
          </ul>
        </article>
        <article className="panel">
          <h3>Recent telemetry</h3>
          <ul className="stat-list">
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
