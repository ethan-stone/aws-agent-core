export interface StoredAuthSession {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt: string;
  email?: string;
}

const AUTH_STORAGE_KEY = "pulseforge.auth.session";

export function getStoredAuthSession(): StoredAuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredAuthSession;
  } catch {
    return null;
  }
}

export function storeAuthSession(session: StoredAuthSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getStoredAccessToken() {
  const session = getStoredAuthSession();
  if (!session) {
    return null;
  }

  return new Date(session.expiresAt).getTime() > Date.now()
    ? session.accessToken
    : null;
}
