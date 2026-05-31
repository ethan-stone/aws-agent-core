import { type Device } from "../../../../shared/pulseforge-domain/src/index.js";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createDevice, fetchDevices } from "../lib/api-client.js";
import { useResource } from "../lib/use-resource.js";

export function DevicesPage() {
  const { data, loading, error: loadError } = useResource(
    fetchDevices,
    [] as Device[],
    []
  );
  const [devices, setDevices] = useState(data);
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("site-atl-1");
  const [type, setType] = useState<Device["type"]>("freezer-sensor");
  const [firmwareVersion, setFirmwareVersion] = useState("1.0.0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDevices(data);
  }, [data]);

  return (
    <section className="grid gap-5">
      <header className="flex flex-col items-start justify-between gap-5 md:flex-row">
        <div>
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            Inventory
          </p>
          <h2 className="mt-1.5 text-[32px] leading-tight font-semibold tracking-normal text-slate-50">
            Devices
          </h2>
        </div>
        <p className="m-0 max-w-[34ch] text-sm text-slate-500">
          Create simulated devices, watch telemetry roll in, and trigger scenarios
          from the backend simulator.
        </p>
      </header>
      <form
        className="grid gap-3 rounded-md border border-white/10 bg-white/[0.03] p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1.2fr)_minmax(140px,0.8fr)_minmax(160px,0.8fr)_minmax(120px,0.6fr)_auto]"
        onSubmit={(event) => void handleCreateDevice(event)}
      >
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.08em] text-slate-500">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Cold-chain sensor"
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-300/50"
          />
        </label>
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.08em] text-slate-500">
          Site
          <input
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-emerald-300/50"
          />
        </label>
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.08em] text-slate-500">
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value as Device["type"])}
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-emerald-300/50"
          >
            <option value="freezer-sensor">Freezer sensor</option>
            <option value="vibration-monitor">Vibration monitor</option>
            <option value="gateway">Gateway</option>
            <option value="power-meter">Power meter</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.08em] text-slate-500">
          Firmware
          <input
            value={firmwareVersion}
            onChange={(event) => setFirmwareVersion(event.target.value)}
            className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm normal-case tracking-normal text-slate-100 outline-none transition-colors focus:border-emerald-300/50"
          />
        </label>
        <div className="flex items-end md:col-span-2 xl:col-span-1">
          <button
            type="submit"
            disabled={saving || !name.trim() || !siteId.trim()}
            className="h-10 w-full rounded-md border border-emerald-200/20 bg-emerald-200 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-600 disabled:text-slate-300 xl:w-auto"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
        {error ? (
          <div className="text-sm normal-case tracking-normal text-rose-200 md:col-span-5">
            {error}
          </div>
        ) : null}
      </form>
      <div className="overflow-x-auto rounded-md border border-white/10 bg-white/[0.03]">
        {loadError ? (
          <div className="m-4 rounded-md border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
            {loadError}
          </div>
        ) : null}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-white/[0.025]">
              <th className="border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Name
              </th>
              <th className="border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Status
              </th>
              <th className="border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                Firmware
              </th>
              <th className="hidden border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500 lg:table-cell">
                Source
              </th>
              <th className="hidden border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500 xl:table-cell">
                Battery
              </th>
              <th className="hidden border-b border-white/8 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.08em] text-slate-500 xl:table-cell">
                Connectivity
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && devices.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="border-b border-white/8 px-4 py-4 text-slate-500"
                >
                  Loading devices...
                </td>
              </tr>
            ) : null}
            {!loading && devices.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="border-b border-white/8 px-4 py-4 text-slate-500"
                >
                  No devices yet.
                </td>
              </tr>
            ) : null}
            {devices.map((device) => (
              <tr key={device.id} className="transition-colors hover:bg-white/[0.025]">
                <td className="border-b border-white/8 px-4 py-3.5">
                  <Link
                    to={`/devices/${device.id}`}
                    className="font-medium text-slate-50 transition-colors hover:text-emerald-100"
                  >
                    {device.name}
                  </Link>
                </td>
                <td className="border-b border-white/8 px-4 py-3.5 text-slate-300">
                  <StatusBadge status={device.status} />
                </td>
                <td className="border-b border-white/8 px-4 py-3.5 text-slate-300">
                  {device.firmwareVersion}
                </td>
                <td className="hidden border-b border-white/8 px-4 py-3.5 text-slate-300 lg:table-cell">
                  {device.source}
                </td>
                <td className="hidden border-b border-white/8 px-4 py-3.5 text-slate-300 xl:table-cell">
                  {device.batteryPercent}%
                </td>
                <td className="hidden border-b border-white/8 px-4 py-3.5 text-slate-300 xl:table-cell">
                  {device.connectivityPercent}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  async function handleCreateDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createDevice({
        name: name.trim(),
        siteId: siteId.trim(),
        type,
        firmwareVersion: firmwareVersion.trim() || undefined,
        tags: ["simulated"],
      });
      setDevices((current) =>
        [...current, created].sort((left, right) =>
          left.name.localeCompare(right.name)
        )
      );
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create device");
    } finally {
      setSaving(false);
    }
  }
}

function StatusBadge(props: { status: Device["status"] }) {
  const className =
    props.status === "healthy"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : props.status === "warning"
        ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
        : props.status === "critical"
          ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
          : "border-slate-300/20 bg-slate-300/8 text-slate-300";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs capitalize ${className}`}>
      {props.status}
    </span>
  );
}
