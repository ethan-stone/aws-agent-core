import { demoDevices } from "../../../../shared/pulseforge-domain/src/index.js";
import { Link } from "react-router-dom";
import { fetchDevices } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DevicesPage() {
  const { data } = useResource(fetchDevices, demoDevices, []);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Devices</h2>
        </div>
      </header>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Firmware</th>
              <th>Battery</th>
              <th>Connectivity</th>
            </tr>
          </thead>
          <tbody>
            {data.map((device) => (
              <tr key={device.id}>
                <td>
                  <Link to={`/devices/${device.id}`}>{device.name}</Link>
                </td>
                <td>{device.status}</td>
                <td>{device.firmwareVersion}</td>
                <td>{device.batteryPercent}%</td>
                <td>{device.connectivityPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
