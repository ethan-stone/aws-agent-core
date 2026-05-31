import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";

export function ConfirmSignupPage() {
  const { confirmSignUp, resendCode } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      await confirmSignUp(email, code);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to confirm sign-up");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError(null);
    setNotice(null);

    try {
      await resendCode(email);
      setNotice("A new confirmation code was sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend code");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d12] px-6 py-12">
      <section className="grid w-full max-w-md gap-6 rounded-md border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),transparent_35%),rgba(12,16,22,0.96)] p-8">
        <header className="grid gap-2">
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">
            PulseForge Access
          </p>
          <h1 className="m-0 text-[30px] leading-[1.05] font-medium tracking-[-0.05em] text-slate-50">
            Confirm sign-up
          </h1>
          <p className="m-0 text-sm text-slate-400">
            Enter the verification code Cognito sent to your email address.
          </p>
        </header>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
              Email
            </span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              className="rounded-md border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
              placeholder="ops@pulseforge.io"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.08em] text-slate-500">
              Verification code
            </span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="rounded-md border border-white/10 bg-black/15 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-white/25"
              placeholder="123456"
            />
          </label>

          {error ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-400/8 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-md border border-emerald-400/30 bg-emerald-400/8 px-3 py-2 text-sm text-emerald-200">
              {notice}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md border border-white/10 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {submitting ? "Confirming..." : "Confirm account"}
          </button>
        </form>

        <div className="flex items-center justify-between gap-4 text-sm text-slate-400">
          <Link className="underline decoration-white/20 underline-offset-4" to="/login">
            Back to sign in
          </Link>
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resending}
            className="text-slate-100 underline decoration-white/20 underline-offset-4 disabled:text-slate-500"
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
        </div>
      </section>
    </main>
  );
}
