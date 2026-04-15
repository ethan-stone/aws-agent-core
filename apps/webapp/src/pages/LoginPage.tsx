import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";

export function LoginPage() {
  const { authEnabled, loading, session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && (!authEnabled || session)) {
    const nextPath = (location.state as { from?: string } | null)?.from ?? "/dashboard";
    return <Navigate to={nextPath} replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await signIn(email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      eyebrow="PulseForge Access"
      title="Sign in"
      description="Authenticate with the app user pool before accessing the operations console."
      footer={
        <p className="text-sm text-slate-400">
          Need an account?{" "}
          <Link className="text-slate-100 underline decoration-white/20 underline-offset-4" to="/signup">
            Create one
          </Link>
        </p>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="ops@pulseforge.io"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="Enter your password"
        />
        {error ? <ErrorBanner message={error} /> : null}
        <button
          type="submit"
          disabled={submitting}
          className="border border-white/10 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export function SignupPage() {
  const { authEnabled, loading, session, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && (!authEnabled || session)) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signUp(email, password);
      if (result.requiresConfirmation) {
        navigate(`/confirm-signup?email=${encodeURIComponent(email)}`, {
          replace: true,
        });
      } else {
        navigate("/login", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign up");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      eyebrow="PulseForge Access"
      title="Create account"
      description="Set up a user in the app user pool. Email confirmation is required before sign-in."
      footer={
        <p className="text-sm text-slate-400">
          Already have an account?{" "}
          <Link className="text-slate-100 underline decoration-white/20 underline-offset-4" to="/login">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="ops@pulseforge.io"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="Use at least 8 characters"
        />
        {error ? <ErrorBanner message={error} /> : null}
        <button
          type="submit"
          disabled={submitting}
          className="border border-white/10 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? "Creating..." : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}

function AuthCard(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d12] px-6 py-12">
      <section className="grid w-full max-w-md gap-6 border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_35%),rgba(12,16,22,0.96)] p-8">
        <header className="grid gap-2">
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            {props.eyebrow}
          </p>
          <h1 className="m-0 text-[30px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            {props.title}
          </h1>
          <p className="m-0 text-sm text-slate-400">{props.description}</p>
        </header>
        {props.children}
        {props.footer}
      </section>
    </main>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
        {props.label}
      </span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        type={props.type ?? "text"}
        className="border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
        placeholder={props.placeholder}
      />
    </label>
  );
}

function ErrorBanner(props: { message: string }) {
  return (
    <div className="border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
      {props.message}
    </div>
  );
}
