const DEFAULT_ALLOWED_ORIGIN = "https://athulyaweerakoon.xyz";
const DEFAULT_SECRET_HEADER = "x-huggy-secret";

const ROUTES = {
  "/api/huggy/wakeup": {
    endpoint: "wakeup",
    buildArgs: () => [],
  },
  "/api/huggy/chat": {
    endpoint: "chat",
    buildArgs: (body) => [
      String(body.message || ""),
      body.chat_history || [],
      body.long_term_context || { summary: "" },
    ],
  },
  "/api/huggy/compact-context": {
    endpoint: "compact_context",
    buildArgs: (body) => [
      body.chat_history || [],
      body.previous_long_term_context || body.long_term_context || { summary: "" },
    ],
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }

    const route = ROUTES[url.pathname];
    if (!route) {
      return jsonResponse(
        { error: "not_found", message: "Unknown Huggy endpoint." },
        404,
        allowedOrigin,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "method_not_allowed", message: "Use POST." },
        405,
        allowedOrigin,
      );
    }

    const upstreamBase = requiredEnv(env, "HUGGY_SPACE_URL");
    const sharedSecret = requiredEnv(env, "HUGGY_CLOUDFLARE_SECRET");
    const secretHeader = env.HUGGY_SECRET_HEADER || DEFAULT_SECRET_HEADER;

    let body = {};
    if (route.endpoint !== "wakeup") {
      body = await readJson(request);
      if (body instanceof Response) {
        return withCors(body, allowedOrigin);
      }
    }

    const upstreamResult = await callGradioEndpoint({
      upstreamBase,
      endpoint: route.endpoint,
      args: route.buildArgs(body),
      secretHeader,
      sharedSecret,
    });

    const responseHeaders = corsHeaders(allowedOrigin);
    responseHeaders.set("content-type", "application/json; charset=utf-8");
    copyRateLimitHeaders(upstreamResult.data, responseHeaders);

    const status = statusFromPayload(upstreamResult.data);
    return new Response(JSON.stringify(upstreamResult.data), {
      status,
      headers: responseHeaders,
    });
  },
};

async function callGradioEndpoint({ upstreamBase, endpoint, args, secretHeader, sharedSecret }) {
  const base = upstreamBase.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    [secretHeader]: sharedSecret,
  };

  const startUrl = `${base}/gradio_api/call/${endpoint}`;
  const startResponse = await fetch(startUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: args }),
  });

  const startText = await startResponse.text();
  if (!startResponse.ok) {
    return {
      data: {
        error: "upstream_start_failed",
        status: startResponse.status,
        body: safeJsonOrText(startText),
      },
    };
  }

  const startPayload = safeJsonOrText(startText);
  const eventId = startPayload && startPayload.event_id;
  if (!eventId) {
    return { data: unwrapGradioData(startPayload) };
  }

  const resultResponse = await fetch(`${startUrl}/${eventId}`, {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      [secretHeader]: sharedSecret,
    },
  });

  const resultText = await resultResponse.text();
  if (!resultResponse.ok) {
    return {
      data: {
        error: "upstream_result_failed",
        status: resultResponse.status,
        body: safeJsonOrText(resultText),
      },
    };
  }

  return { data: parseGradioEventStream(resultText) };
}

function parseGradioEventStream(text) {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length).trim())
    .filter(Boolean);

  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    const parsed = safeJsonOrText(dataLines[index]);
    const unwrapped = unwrapGradioData(parsed);
    if (unwrapped !== undefined) {
      return unwrapped;
    }
  }

  return { error: "empty_gradio_response" };
}

function unwrapGradioData(payload) {
  if (Array.isArray(payload)) {
    return payload[0];
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data[0];
  }
  return payload;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

function safeJsonOrText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function statusFromPayload(payload) {
  if (payload && payload.metadata && payload.metadata.error === "missing_or_invalid_cloudflare_secret_header") {
    return 502;
  }
  if (
    payload &&
    payload.metadata &&
    payload.metadata.rate_limit &&
    payload.metadata.rate_limit.error === "rate_limited"
  ) {
    return 429;
  }
  if (payload && payload.error) {
    return 502;
  }
  return 200;
}

function copyRateLimitHeaders(payload, headers) {
  const rateLimitHeaders = payload && payload.metadata && payload.metadata.rate_limit && payload.metadata.rate_limit.headers;
  if (!rateLimitHeaders) {
    return;
  }

  for (const [name, value] of Object.entries(rateLimitHeaders)) {
    const headerName = name.toLowerCase();
    if (headerName === "retry-after" || headerName.startsWith("x-ratelimit-")) {
      headers.set(headerName, String(value));
      headers.set(`huggy-${headerName}`, String(value));
    }
  }
}

function corsHeaders(allowedOrigin) {
  return new Headers({
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-expose-headers": [
      "retry-after",
      "x-ratelimit-limit-requests",
      "x-ratelimit-limit-tokens",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-reset-requests",
      "x-ratelimit-reset-tokens",
      "huggy-retry-after",
      "huggy-x-ratelimit-limit-requests",
      "huggy-x-ratelimit-limit-tokens",
      "huggy-x-ratelimit-remaining-requests",
      "huggy-x-ratelimit-remaining-tokens",
      "huggy-x-ratelimit-reset-requests",
      "huggy-x-ratelimit-reset-tokens",
    ].join(", "),
    vary: "Origin",
  });
}

function withCors(response, allowedOrigin) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(allowedOrigin)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, status, allowedOrigin) {
  const headers = corsHeaders(allowedOrigin);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
