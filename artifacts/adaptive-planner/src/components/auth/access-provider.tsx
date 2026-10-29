import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';

export type MemberRole = 'admin' | 'member';
export type MemberStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type Member = {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
  legacyImportAvailable: boolean;
};

export const ACCESS_CHANGED_EVENT = 'align:access-changed';
const API = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;
const POLL_MS = 12000;

/** Cookie-authenticated JSON fetch. Never attaches tokens. Dispatches access-changed on 403. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
    if (res.status === 401 || res.status === 403) window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch { /* ignore */ }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

type AccessState = {
  member: Member | null;
  /** true until the first /auth/me result for the current Clerk user arrives */
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const AccessContext = createContext<AccessState>({ member: null, loading: true, error: null, refresh: () => {} });

export function AccessProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const userRef = useRef<string | null>(null);
  userRef.current = isSignedIn ? userId ?? null : null;

  const refresh = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return;
    const id = ++reqId.current;
    try {
      const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
      if (id !== reqId.current || userRef.current !== uid) return;
      if (res.status === 401) {
        setMember(null);
        setError(null);
      } else if (res.status === 403) {
        setMember(null);
        setError('Your email or account access needs verification. Check your account and try again.');
      } else if (!res.ok) {
        // keep last known member on transient errors, but surface the failure
        setError(`Could not check access (${res.status})`);
      } else {
        const next = (await res.json()) as Member;
        if (id !== reqId.current || userRef.current !== uid) return;
        if (next.id !== uid) {
          setMember(null);
          setError('Your sign-in changed. Refresh the page to continue safely.');
          return;
        }
        setMember(next);
        setError(null);
      }
    } catch {
      if (id === reqId.current) setError('Network unavailable. Retrying.');
    } finally {
      if (id === reqId.current && userRef.current === uid) setLoadedFor(uid);
    }
  }, []);

  // identity change: wipe immediately so nothing from a previous account renders
  useEffect(() => {
    setMember(null);
    setError(null);
    setLoadedFor(null);
    reqId.current++;
    if (isLoaded && isSignedIn && userId) void refresh();
  }, [isLoaded, isSignedIn, userId, refresh]);

  useEffect(() => {
    if (!isSignedIn) return;
    const t = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onChanged = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(ACCESS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(ACCESS_CHANGED_EVENT, onChanged);
    };
  }, [isSignedIn, refresh]);

  const loading = !isLoaded || (!!isSignedIn && loadedFor !== userId);
  const value: AccessState = { member: isSignedIn && member?.id === userId ? member : null, loading, error, refresh: () => void refresh() };
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}
