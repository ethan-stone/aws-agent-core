import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ApiAuthConfig,
} from "../../../../shared/pulseforge-domain/src/index.js";
import { fetchAuthConfig } from "./api-client.js";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  storeAuthSession,
  type StoredAuthSession,
} from "./auth-storage.js";
import {
  confirmSignUpWithCognito,
  resendConfirmationCode,
  signInWithCognito,
  signUpWithCognito,
} from "./cognito-auth.js";

interface AuthContextValue {
  authConfig: ApiAuthConfig | null;
  authEnabled: boolean;
  loading: boolean;
  session: StoredAuthSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ requiresConfirmation: boolean }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isSessionValid(session: StoredAuthSession | null) {
  return Boolean(session && new Date(session.expiresAt).getTime() > Date.now());
}

export function AuthProvider(props: { children: ReactNode }) {
  const [authConfig, setAuthConfig] = useState<ApiAuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<StoredAuthSession | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const config = await fetchAuthConfig();
        if (!active) {
          return;
        }

        setAuthConfig(config);

        const storedSession = getStoredAuthSession();
        if (isSessionValid(storedSession)) {
          setSession(storedSession);
        } else {
          clearStoredAuthSession();
          setSession(null);
        }
      } catch {
        if (active) {
          setAuthConfig({
            enabled: false,
            provider: "none",
          });
          setSession(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function signIn(email: string, password: string) {
    if (!authConfig) {
      throw new Error("Auth config has not loaded yet");
    }

    const nextSession = await signInWithCognito(authConfig, email, password);
    storeAuthSession(nextSession);
    setSession(nextSession);
  }

  async function signUp(email: string, password: string) {
    if (!authConfig) {
      throw new Error("Auth config has not loaded yet");
    }

    const result = await signUpWithCognito(authConfig, email, password);
    return {
      requiresConfirmation: !result.userConfirmed,
    };
  }

  async function confirmSignUp(email: string, code: string) {
    if (!authConfig) {
      throw new Error("Auth config has not loaded yet");
    }

    await confirmSignUpWithCognito(authConfig, email, code);
  }

  async function resendCode(email: string) {
    if (!authConfig) {
      throw new Error("Auth config has not loaded yet");
    }

    await resendConfirmationCode(authConfig, email);
  }

  function signOut() {
    clearStoredAuthSession();
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{
        authConfig,
        authEnabled: Boolean(authConfig?.enabled),
        loading,
        session,
        signIn,
        signUp,
        confirmSignUp,
        resendCode,
        signOut,
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
