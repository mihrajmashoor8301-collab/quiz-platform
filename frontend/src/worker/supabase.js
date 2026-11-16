export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function authenticateHost(request, env, fetchImpl = fetch) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9._~-]{20,4096})$/i.exec(authorization);
  if (!match) throw new HttpError(401, "Sign in to host a quiz.");
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError(503, "Supabase Auth is not configured.");
  }
  let response;
  try {
    response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${match[1]}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(503, "Supabase Auth could not be reached.");
  }
  if (!response.ok) throw new HttpError(401, "Your session is invalid or expired. Sign in again.");
  let user;
  try {
    user = await response.json();
  } catch {
    throw new HttpError(401, "Supabase returned an invalid session.");
  }
  if (typeof user?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    throw new HttpError(401, "Supabase returned an invalid user.");
  }
  return { id: user.id, email: typeof user.email === "string" ? user.email : null };
}

export async function supabaseRest(env, path, init = {}, fetchImpl = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, "Supabase database is not configured.");
  }
  let response;
  try {
    response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpError(503, "Supabase database could not be reached.");
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const error = new HttpError(response.status === 409 ? 409 : 503, "Supabase database rejected the request.");
    error.details = body;
    throw error;
  }
  return body;
}

export function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new HttpError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "Request body is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}
