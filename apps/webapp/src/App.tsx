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
    <div className="grid min-h-screen bg-[#080b10] md:grid-cols-[264px_1fr]">
      <aside className="flex flex-col justify-between border-r border-white/10 bg-[#0b1016]/95 px-5 py-6">
        <div className="grid gap-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md border border-emerald-300/20 bg-emerald-300/10 text-sm font-semibold text-emerald-100">
              PF
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                PulseForge
              </p>
              <h1 className="m-0 text-[19px] leading-tight font-semibold tracking-normal text-slate-50">
                Operations
              </h1>
            </div>
          </div>

          <nav className="grid gap-1">
            <AppNavLink to="/dashboard">Dashboard</AppNavLink>
            <AppNavLink to="/devices">Devices</AppNavLink>
            <AppNavLink to="/incidents">Incidents</AppNavLink>
            <AppNavLink to="/copilot">Copilot</AppNavLink>
          </nav>
        </div>

        <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="grid gap-1">
            <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
              Signed in
            </span>
            <strong className="truncate text-sm font-medium text-slate-100">
              {session?.email ?? "Local development"}
            </strong>
          </div>
          {authEnabled ? (
            <button
              type="button"
              onClick={signOut}
              className="rounded-md border border-white/10 px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-slate-50"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0 p-0 md:p-5">
        <div className="min-h-screen bg-[#0d1218] px-[18px] py-6 md:min-h-[calc(100vh-40px)] md:rounded-md md:px-7 md:py-7">
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
        `rounded-md px-3 py-2.5 text-sm transition-colors ${
          isActive
            ? "bg-white/[0.06] text-slate-50 shadow-[inset_2px_0_0_rgba(110,231,183,0.65)]"
            : "text-slate-400 hover:bg-white/[0.035] hover:text-slate-100"
        }`
      }
    >
      {props.children}
    </NavLink>
  );
}
