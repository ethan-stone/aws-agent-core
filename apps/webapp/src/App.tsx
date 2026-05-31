import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth-context.js";
import { ConfirmSignupPage } from "./pages/ConfirmSignupPage.js";
import {
  CopilotConversationPage,
  CopilotPage,
} from "./pages/CopilotPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DeviceDetailPage } from "./pages/DeviceDetailPage.js";
import { DevicesPage } from "./pages/DevicesPage.js";
import { IncidentDetailPage } from "./pages/IncidentDetailPage.js";
import { IncidentsPage } from "./pages/IncidentsPage.js";
import { LoginPage, SignupPage } from "./pages/LoginPage.js";
import { OAuthCallbackPage } from "./pages/OAuthCallbackPage.js";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/confirm-signup" element={<ConfirmSignupPage />} />
      <Route path="/oauth2/callback" element={<OAuthCallbackPage />} />
      <Route path="/*" element={<ProtectedAppShell />} />
    </Routes>
  );
}

function ProtectedAppShell() {
  const { authEnabled, loading, session, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090d12] px-6 py-12 text-sm text-slate-400">
        Loading PulseForge...
      </main>
    );
  }

  if (authEnabled && !session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[296px_1fr]">
      <aside className="flex flex-col justify-between border-r border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_35%),rgba(7,10,14,0.88)] px-6 py-8">
        <div className="grid gap-[18px]">
          <div className="grid gap-1.5">
            <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
              PulseForge
            </p>
            <h1 className="m-0 text-[28px] leading-none font-medium tracking-normal text-slate-50">
              IoT Operations
            </h1>
          </div>
          <p className="max-w-[23ch] text-sm text-slate-400">
            Monitor fleet health, investigate incidents, and coordinate
            agent-assisted remediation.
          </p>
          <div className="mt-2 grid gap-2.5">
            <div className="flex justify-between gap-4 border-t border-white/8 pt-2.5 text-[11px] uppercase tracking-[0.08em]">
              <span className="text-slate-500">Mode</span>
              <strong className="text-slate-50">AWS runtime</strong>
            </div>
            <div className="flex justify-between gap-4 border-t border-white/8 pt-2.5 text-[11px] uppercase tracking-[0.08em]">
              <span className="text-slate-500">Storage</span>
              <strong className="text-slate-50">MongoDB</strong>
            </div>
            <div className="flex justify-between gap-4 border-t border-white/8 pt-2.5 text-[11px] uppercase tracking-[0.08em]">
              <span className="text-slate-500">Auth</span>
              <strong className="text-slate-50">{authEnabled ? "Cognito" : "Disabled"}</strong>
            </div>
          </div>
        </div>

        <div className="grid gap-6">
          <nav className="grid gap-1.5">
            <AppNavLink to="/dashboard">Dashboard</AppNavLink>
            <AppNavLink to="/devices">Devices</AppNavLink>
            <AppNavLink to="/incidents">Incidents</AppNavLink>
            <AppNavLink to="/copilot">Copilot</AppNavLink>
          </nav>

          <div className="grid gap-3 border-t border-white/8 pt-4">
            <div className="grid gap-1">
              <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                Signed in
              </span>
              <strong className="text-sm text-slate-100">
                {session?.email ?? "Local development"}
              </strong>
            </div>
            {authEnabled ? (
              <button
                type="button"
                onClick={signOut}
                className="border border-white/10 px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:border-white/20 hover:text-slate-50"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="p-0 md:p-6">
        <div className="min-h-screen border-0 border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_24%),rgba(10,14,20,0.94)] px-[18px] py-6 md:min-h-[calc(100vh-48px)] md:border md:px-8 md:py-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/devices/:deviceId" element={<DeviceDetailPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
            <Route path="/copilot" element={<CopilotPage />} />
            <Route path="/copilot/:conversationId" element={<CopilotConversationPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function AppNavLink(props: { to: string; children: string }) {
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) =>
        `border-b border-white/8 py-2.5 text-sm ${
          isActive ? "text-slate-50" : "text-slate-400"
        }`
      }
    >
      {props.children}
    </NavLink>
  );
}
