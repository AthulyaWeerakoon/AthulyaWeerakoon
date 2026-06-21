const DEFAULT_ALLOWED_ORIGIN = "https://athulyaweerakoon.xyz";
const DEFAULT_SECRET_HEADER = "x-huggy-secret";
const DEFAULT_CONTEXT_WORDS = 552;
const DEFAULT_CONTEXT_TOKENS = 1000;
const DEFAULT_SHARED_DAILY_REQUESTS = 500;
const DEFAULT_FAIR_USER_COUNT = 20;
const DEFAULT_DAILY_PAYLOAD_WORD_LIMIT = 6000;

const memoryRateLimitStore = new Map();

const DAILY_LIMIT_REPLIES = [
  "You've been hanging with me for an awfully long time today. Huggy's free-tier wallet is tapping the sign. Come back tomorrow.",
  "Huggy loves the attention, but the daily tiny-backend ration is gone for this IP. Heroic restraint until tomorrow, please.",
  "That is today's Huggy quota spent. I am flattered. Also poor. Try again after the daily reset.",
  "You've successfully talked this free-tier bot into needing a nap. Daily limit reached for this IP.",
  "Huggy has enjoyed our little intellectual marathon, but the budget committee is now glaring. Come back tomorrow.",
  "Daily Huggy allowance reached. This is not rejection. This is resource-aware affection.",
  "You have extracted today's legally permitted amount of wisdom from a tiny backend. Impressive. Try again tomorrow.",
  "The free-tier meter says we've been best friends for long enough today. Huggy will be back after reset.",
  "Huggy is cutting you off with warmth and fiscal responsibility. Daily limit reached for this IP.",
  "Tiny backend, big dreams, finite quota. You've hit today's Huggy limit for this IP.",
];

const ROUTES = {
  "/api/huggy/wakeup": {
    endpoint: "wakeup",
    buildArgs: () => [],
  },
  "/api/huggy/chat": {
    endpoint: "chat",
    rateLimited: true,
    buildArgs: (body) => [
      String(body.message || ""),
      body.chat_history || [],
      body.long_term_context || { summary: "" },
    ],
  },
  "/api/huggy/compact-context": {
    endpoint: "compact_context",
    rateLimited: true,
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

    let workerRateLimit = null;
    if (route.rateLimited) {
      workerRateLimit = await checkDailyBudget(request, env, body, route.endpoint);
      if (!workerRateLimit.allowed) {
        const responseHeaders = corsHeaders(allowedOrigin);
        responseHeaders.set("content-type", "application/json; charset=utf-8");
        addWorkerRateLimitHeaders(responseHeaders, workerRateLimit);
        return new Response(JSON.stringify(workerRateLimitPayload(workerRateLimit)), {
          status: 429,
          headers: responseHeaders,
        });
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
    if (workerRateLimit) {
      if (shouldCountUpstreamPayload(upstreamResult.data)) {
        workerRateLimit = await commitDailyBudget(workerRateLimit);
      }
      addWorkerRateLimitHeaders(responseHeaders, workerRateLimit);
      attachWorkerRateLimitMetadata(upstreamResult.data, workerRateLimit);
    }

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

async function checkDailyBudget(request, env, body, endpoint) {
  const policy = dailyBudgetPolicy(env);
  const ipHash = await clientKey(request);
  const now = new Date();
  const key = `huggy:daily:${now.toISOString().slice(0, 10)}:${ipHash}`;
  const resetSeconds = secondsUntilNextUtcDay(now);
  const requestedPayloadWords = requestPayloadWords(body, endpoint);
  const requestedWeightedWords = policy.contextWords + requestedPayloadWords;
  const store = rateLimitStore(env);
  const current = await readDailyUsage(store, key);
  const currentPayloadWords = current.payloadWords || current.usedWords || 0;
  const currentWeightedWords = current.weightedWords || current.usedWords || 0;
  const currentRequests = current.requests || 0;
  const nextPayloadWords = currentPayloadWords + requestedPayloadWords;
  const nextWeightedWords = currentWeightedWords + requestedWeightedWords;
  const nextRequests = currentRequests + 1;
  const allowed =
    nextRequests <= policy.dailyRequestLimit &&
    nextPayloadWords <= policy.dailyPayloadWordLimit;
  const reason =
    nextRequests > policy.dailyRequestLimit
      ? "daily_ip_request_limit_reached"
      : "daily_ip_payload_word_limit_reached";

  const result = {
    allowed,
    counted: false,
    reason: allowed ? "" : reason,
    store,
    key,
    requestLimit: policy.dailyRequestLimit,
    requestCount: currentRequests,
    requestedRequests: 1,
    remainingRequests: Math.max(0, policy.dailyRequestLimit - currentRequests),
    payloadWordLimit: policy.dailyPayloadWordLimit,
    payloadWords: currentPayloadWords,
    requestedPayloadWords,
    remainingPayloadWords: Math.max(0, policy.dailyPayloadWordLimit - currentPayloadWords),
    weightedWords: currentWeightedWords,
    requestedWeightedWords,
    resetSeconds,
    resetAt: new Date(now.getTime() + resetSeconds * 1000).toISOString(),
    contextWords: policy.contextWords,
    contextTokens: policy.contextTokens,
    estimatedTokensPerWord: policy.estimatedTokensPerWord,
    sharedDailyRequests: policy.sharedDailyRequests,
    fairUserCount: policy.fairUserCount,
    storage: store ? "kv" : "memory",
  };

  if (!allowed) {
    return result;
  }

  result.nextRequests = nextRequests;
  result.nextPayloadWords = nextPayloadWords;
  result.nextWeightedWords = nextWeightedWords;
  return result;
}

async function commitDailyBudget(rateLimit) {
  const committed = { ...rateLimit, counted: true };
  committed.requestCount = rateLimit.nextRequests;
  committed.remainingRequests = Math.max(0, rateLimit.requestLimit - rateLimit.nextRequests);
  committed.payloadWords = rateLimit.nextPayloadWords;
  committed.remainingPayloadWords = Math.max(
    0,
    rateLimit.payloadWordLimit - rateLimit.nextPayloadWords,
  );
  committed.weightedWords = rateLimit.nextWeightedWords;
  await writeDailyUsage(
    rateLimit.store,
    rateLimit.key,
    {
      requests: rateLimit.nextRequests,
      payloadWords: rateLimit.nextPayloadWords,
      weightedWords: rateLimit.nextWeightedWords,
    },
    rateLimit.resetSeconds,
  );
  return committed;
}

function shouldCountUpstreamPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (payload.backend_refused) {
    return false;
  }
  if (payload.error) {
    return false;
  }
  return true;
}

function dailyBudgetPolicy(env) {
  const contextWords = positiveInt(env.HUGGY_CONTEXT_WORDS, DEFAULT_CONTEXT_WORDS);
  const contextTokens = positiveInt(env.HUGGY_CONTEXT_TOKENS, DEFAULT_CONTEXT_TOKENS);
  const sharedDailyRequests = positiveInt(
    env.HUGGY_SHARED_DAILY_REQUESTS,
    DEFAULT_SHARED_DAILY_REQUESTS,
  );
  const fairUserCount = positiveInt(env.HUGGY_FAIR_USER_COUNT, DEFAULT_FAIR_USER_COUNT);
  const estimatedTokensPerWord = contextTokens / contextWords;
  const computedDailyRequestLimit = Math.max(1, Math.floor(sharedDailyRequests / fairUserCount));
  const computedPayloadWordLimit = Math.floor(
    computedDailyRequestLimit * (contextWords / 2),
  );
  const defaultPayloadWordLimit = Math.min(
    DEFAULT_DAILY_PAYLOAD_WORD_LIMIT,
    computedPayloadWordLimit,
  );

  return {
    contextWords,
    contextTokens,
    estimatedTokensPerWord,
    sharedDailyRequests,
    fairUserCount,
    dailyRequestLimit: positiveInt(env.HUGGY_DAILY_REQUEST_LIMIT, computedDailyRequestLimit),
    dailyPayloadWordLimit: positiveInt(
      env.HUGGY_DAILY_PAYLOAD_WORD_LIMIT,
      positiveInt(env.HUGGY_DAILY_WORD_LIMIT, defaultPayloadWordLimit),
    ),
  };
}

function rateLimitStore(env) {
  return env.HUGGY_RATE_LIMIT_KV || env["huggy-rate-limit-kv"] || null;
}

function requestPayloadWords(body, endpoint) {
  if (endpoint === "compact_context") {
    return (
      countWords(body.chat_history || []) +
      countWords(body.previous_long_term_context || body.long_term_context || {})
    );
  }

  return (
    countWords(body.message || "") +
    countWords(body.chat_history || []) +
    countWords(body.long_term_context || {})
  );
}

async function readDailyUsage(store, key) {
  if (!store) {
    return memoryRateLimitStore.get(key) || { usedWords: 0 };
  }

  const value = await store.get(key, "json");
  return value || { usedWords: 0 };
}

async function writeDailyUsage(store, key, usage, resetSeconds) {
  const value = { ...usage, updatedAt: new Date().toISOString() };
  if (!store) {
    memoryRateLimitStore.set(key, value);
    return;
  }

  await store.put(key, JSON.stringify(value), {
    expirationTtl: Math.max(60, resetSeconds + 300),
  });
}

async function clientKey(request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "local-dev";
  const bytes = new TextEncoder().encode(ip.split(",")[0].trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function secondsUntilNextUtcDay(now) {
  const nextDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
  );
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
}

function workerRateLimitPayload(rateLimit) {
  return {
    reply: DAILY_LIMIT_REPLIES[Math.floor(Math.random() * DAILY_LIMIT_REPLIES.length)],
    backend_refused: true,
    accepted_history: [],
    forwarded_history: [],
    ignored_history: [],
    metadata: {
      error: "worker_daily_rate_limited",
      rate_limit: {
        provider: "cloudflare-worker",
        error: rateLimit.reason,
        counted: rateLimit.counted,
        request_limit: rateLimit.requestLimit,
        request_count: rateLimit.requestCount,
        remaining_requests: rateLimit.remainingRequests,
        payload_word_limit: rateLimit.payloadWordLimit,
        payload_words: rateLimit.payloadWords,
        requested_payload_words: rateLimit.requestedPayloadWords,
        remaining_payload_words: rateLimit.remainingPayloadWords,
        weighted_words: rateLimit.weightedWords,
        requested_weighted_words: rateLimit.requestedWeightedWords,
        reset_seconds: rateLimit.resetSeconds,
        reset_at: rateLimit.resetAt,
        context_words: rateLimit.contextWords,
        context_tokens: rateLimit.contextTokens,
        estimated_tokens_per_word: rateLimit.estimatedTokensPerWord,
        fair_user_count: rateLimit.fairUserCount,
      },
    },
  };
}

function attachWorkerRateLimitMetadata(payload, rateLimit) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (!payload.metadata || typeof payload.metadata !== "object") {
    payload.metadata = {};
  }
  payload.metadata.worker_rate_limit = {
    provider: "cloudflare-worker",
    counted: rateLimit.counted,
    request_limit: rateLimit.requestLimit,
    request_count: rateLimit.requestCount,
    remaining_requests: rateLimit.remainingRequests,
    payload_word_limit: rateLimit.payloadWordLimit,
    payload_words: rateLimit.payloadWords,
    requested_payload_words: rateLimit.requestedPayloadWords,
    remaining_payload_words: rateLimit.remainingPayloadWords,
    weighted_words: rateLimit.weightedWords,
    requested_weighted_words: rateLimit.requestedWeightedWords,
    reset_seconds: rateLimit.resetSeconds,
    reset_at: rateLimit.resetAt,
    context_words: rateLimit.contextWords,
    context_tokens: rateLimit.contextTokens,
    estimated_tokens_per_word: rateLimit.estimatedTokensPerWord,
    fair_user_count: rateLimit.fairUserCount,
  };
}

function addWorkerRateLimitHeaders(headers, rateLimit) {
  headers.set("retry-after", String(rateLimit.resetSeconds));
  headers.set("huggy-worker-ratelimit-limit-requests", String(rateLimit.requestLimit));
  headers.set("huggy-worker-ratelimit-used-requests", String(rateLimit.requestCount));
  headers.set("huggy-worker-ratelimit-remaining-requests", String(rateLimit.remainingRequests));
  headers.set("huggy-worker-ratelimit-limit-payload-words", String(rateLimit.payloadWordLimit));
  headers.set("huggy-worker-ratelimit-used-payload-words", String(rateLimit.payloadWords));
  headers.set(
    "huggy-worker-ratelimit-requested-payload-words",
    String(rateLimit.requestedPayloadWords),
  );
  headers.set(
    "huggy-worker-ratelimit-remaining-payload-words",
    String(rateLimit.remainingPayloadWords),
  );
  headers.set("huggy-worker-ratelimit-used-weighted-words", String(rateLimit.weightedWords));
  headers.set(
    "huggy-worker-ratelimit-requested-weighted-words",
    String(rateLimit.requestedWeightedWords),
  );
  headers.set("huggy-worker-ratelimit-reset-seconds", String(rateLimit.resetSeconds));
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function countWords(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "string") {
    return (value.match(/\b[\w'-]+\b/g) || []).length;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return countWords(String(value));
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countWords(item), 0);
  }
  if (typeof value === "object") {
    return Object.values(value).reduce((total, item) => total + countWords(item), 0);
  }
  return 0;
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
      "huggy-worker-ratelimit-limit-requests",
      "huggy-worker-ratelimit-used-requests",
      "huggy-worker-ratelimit-remaining-requests",
      "huggy-worker-ratelimit-limit-payload-words",
      "huggy-worker-ratelimit-used-payload-words",
      "huggy-worker-ratelimit-requested-payload-words",
      "huggy-worker-ratelimit-remaining-payload-words",
      "huggy-worker-ratelimit-used-weighted-words",
      "huggy-worker-ratelimit-requested-weighted-words",
      "huggy-worker-ratelimit-reset-seconds",
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
