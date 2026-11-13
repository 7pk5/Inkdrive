import { API_URL } from "../protocol";
import { getAccessToken } from "./auth";

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** The one place that talks to our backend: adds the token, retries once after a refresh. */
export async function callApi<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  if (!path.startsWith("/v1/")) throw new Error("bad path");
  const attempt = async (force: boolean) => {
    const token = await getAccessToken(force);
    if (!token) return { status: 401, body: { error: "unauthorized" } as T };
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const first = await attempt(false);
  return first.status === 401 ? attempt(true) : first;
}
