import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "../config.js";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/** Exchanges an OAuth authorization code (PKCE) and returns the VERIFIED profile. */
export async function exchangeCode(
  cfg: Config,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<GoogleProfile> {
  if (!cfg.allowedRedirects.includes(input.redirectUri)) throw new AuthError("redirect_not_allowed");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: cfg.GOOGLE_CLIENT_ID,
      client_secret: cfg.GOOGLE_CLIENT_SECRET,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new AuthError("google_exchange_failed");
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new AuthError("no_id_token");
  return verifyIdToken(cfg, body.id_token);
}

export async function verifyIdToken(cfg: Config, idToken: string): Promise<GoogleProfile> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    audience: cfg.GOOGLE_CLIENT_ID,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (payload.email_verified !== true || typeof payload.email !== "string" || typeof payload.sub !== "string") {
    throw new AuthError("email_not_verified");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export class AuthError extends Error {}
