import { NavLink, Route, Routes } from "react-router-dom";
import { CopilotPage } from "./pages/CopilotPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DeviceDetailPage } from "./pages/DeviceDetailPage.js";
import { DevicesPage } from "./pages/DevicesPage.js";
import { IncidentDetailPage } from "./pages/IncidentDetailPage.js";
import { IncidentsPage } from "./pages/IncidentsPage.js";

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">PulseForge</p>
          <h1>IoT Operations</h1>
          <p className="sidebar-copy">
            Monitor fleet health, investigate incidents, and coordinate
            agent-assisted remediation.
          </p>
        </div>
        <nav className="nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/incidents">Incidents</NavLink>
          <NavLink to="/copilot">Copilot</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:deviceId" element={<DeviceDetailPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
          <Route path="/copilot" element={<CopilotPage />} />
        </Routes>
      </main>
    </div>
  );
}
