import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { completeResourceTokenAuth } from "../lib/api-client.js";
import { useAuth } from "../lib/auth-context.js";

type CallbackStatus = "loading" | "success" | "error";

export function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const { authEnabled, loading, session } = useAuth();
  const [status, setStatus] = useState<CallbackStatus>("loading");
  const [message, setMessage] = useState("Completing delegated authorization...");

  useEffect(() => {
    if (loading) {
      return;
    }

    const sessionUri = searchParams.get("session_id");
    if (!sessionUri) {
      setStatus("error");
      setMessage("The authorization callback is missing session_id.");
      return;
    }

    if (authEnabled && !session) {
      setStatus("error");
      setMessage("Sign in to PulseForge, then retry the authorization flow.");
      return;
    }

    let active = true;
    completeResourceTokenAuth(sessionUri)
      .then(() => {
        if (!active) {
          return;
        }
        setStatus("success");
        setMessage("Authorization complete. You can close this window.");
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Authorization completion failed."
        );
      });

    return () => {
      active = false;
    };
  }, [authEnabled, loading, searchParams, session]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d12] px-6 py-12 text-slate-100">
      <section className="w-full max-w-[520px] rounded-md border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_38%),rgba(10,14,20,0.96)] p-8 shadow-2xl shadow-black/40">
        <p className="mb-3 text-[11px] uppercase tracking-[0.16em] text-cyan-300">
          PulseForge delegated auth
        </p>
        <h1 className="mb-4 text-3xl font-medium tracking-[-0.04em]">
          {status === "success"
            ? "Authorization Complete"
            : status === "error"
              ? "Authorization Failed"
              : "Completing Authorization"}
        </h1>
        <p className="text-sm leading-6 text-slate-300">{message}</p>
        {status === "success" ? (
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-6 rounded-md border border-cyan-300/40 px-4 py-2 text-sm text-cyan-100 transition-colors hover:border-cyan-200 hover:text-white"
          >
            Close window
          </button>
        ) : null}
      </section>
    </main>
  );
}
