import { demoDevices } from "../../../../shared/pulseforge-domain/src/index.js";
import { Link } from "react-router-dom";
import { fetchDevices } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DevicesPage() {
  const { data } = useResource(fetchDevices, demoDevices, []);

  return (
    <section>
      <header className="mb-7 flex flex-col items-start justify-between gap-6 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Inventory
          </p>
          <h2 className="mt-1.5 text-[34px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            Devices
          </h2>
        </div>
      </header>
      <div className="overflow-x-auto border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_30%),rgba(14,18,24,0.82)] px-5 py-[22px]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-white/8 px-1.5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Name
              </th>
              <th className="border-b border-white/8 px-1.5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Status
              </th>
              <th className="border-b border-white/8 px-1.5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Firmware
              </th>
              <th className="border-b border-white/8 px-1.5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Battery
              </th>
              <th className="border-b border-white/8 px-1.5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Connectivity
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((device) => (
              <tr key={device.id}>
                <td className="border-b border-white/8 px-1.5 py-3.5">
                  <Link
                    to={`/devices/${device.id}`}
                    className="text-slate-50 transition-colors hover:text-slate-300"
                  >
                    {device.name}
                  </Link>
                </td>
                <td className="border-b border-white/8 px-1.5 py-3.5 text-slate-300">
                  {device.status}
                </td>
                <td className="border-b border-white/8 px-1.5 py-3.5 text-slate-300">
                  {device.firmwareVersion}
                </td>
                <td className="border-b border-white/8 px-1.5 py-3.5 text-slate-300">
                  {device.batteryPercent}%
                </td>
                <td className="border-b border-white/8 px-1.5 py-3.5 text-slate-300">
                  {device.connectivityPercent}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
