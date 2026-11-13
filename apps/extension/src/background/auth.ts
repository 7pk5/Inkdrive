import type { AuthResult, Meta } from "@ecd/shared";
import { API_URL, type AuthState } from "../protocol";

const b64url = (buf: Uint8Array) =>
  btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))); // 64 chars
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

const toState = (r: AuthResult): AuthState => ({
  accessToken: r.accessToken,
  accessExp: Date.now() + r.accessExpiresIn * 1000,
  refreshToken: r.refreshToken,
  user: r.user,
});

export const getAuth = async (): Promise<AuthState | null> => ((await chrome.storage.local.get("auth")).auth as AuthState | undefined) ?? null;
const saveAuth = (a: AuthState | null) => chrome.storage.local.set({ auth: a });

/** Google sign-in: OAuth code flow with PKCE; the backend verifies everything. */
export async function signIn(): Promise<AuthState> {
  const meta = (await (await fetch(`${API_URL}/v1/meta`)).json()) as Meta;
  if (!meta.googleClientId) throw new Error("Server has no Google client id configured");
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = chrome.identity.getRedirectURL();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: meta.googleClientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "select_account",
  }).toString();
  const done = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!done) throw new Error("Sign-in was cancelled");
  const back = new URL(done);
  if (back.searchParams.get("state") !== state) throw new Error("Sign-in state mismatch");
  const code = back.searchParams.get("code");
  if (!code) throw new Error(back.searchParams.get("error") ?? "No code returned");
  const res = await fetch(`${API_URL}/v1/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  const auth = toState((await res.json()) as AuthResult);
  await saveAuth(auth);
  return auth;
}

/** Local testing only: needs DEV_LOGIN=1 at build time and DEV_AUTH=1 on the API. */
export async function signInDev(email: string): Promise<AuthState> {
  if (!__DEV_LOGIN__) throw new Error("Dev sign-in is disabled in this build");
  const res = await fetch(`${API_URL}/v1/auth/dev`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: email.split("@")[0] }),
  });
  if (!res.ok) throw new Error(`Dev sign-in failed (${res.status}). Is the API running with DEV_AUTH=1?`);
  const auth = toState((await res.json()) as AuthResult);
  await saveAuth(auth);
  return auth;
}

let refreshing: Promise<AuthState | null> | null = null;

/** Single-flight refresh: rotating tokens must never be used twice in parallel. */
async function refresh(): Promise<AuthState | null> {
  refreshing ??= (async () => {
    const cur = await getAuth();
    if (!cur) return null;
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: cur.refreshToken }),
      });
      if (res.status === 401) {
        await saveAuth(null);
        return null;
      }
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      const next = toState((await res.json()) as AuthResult);
      await saveAuth(next);
      return next;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function getAccessToken(force = false): Promise<string | null> {
  const a = await getAuth();
  if (!a) return null;
  if (!force && a.accessExp - 30_000 > Date.now()) return a.accessToken;
  return (await refresh())?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  const a = await getAuth();
  if (a) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    }).catch(() => {});
  }
  await chrome.storage.local.set({ auth: null, open: null, status: { state: "signedout", at: Date.now() } });
}
