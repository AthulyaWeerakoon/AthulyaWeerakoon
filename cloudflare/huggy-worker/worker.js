const DEFAULT_ALLOWED_ORIGIN = "https://athulyaweerakoon.xyz";
const DEFAULT_SECRET_HEADER = "x-huggy-secret";
const DEFAULT_CONTEXT_WORDS = 552;
const DEFAULT_CONTEXT_TOKENS = 1000;
const DEFAULT_SHARED_DAILY_REQUESTS = 1000;
const DEFAULT_SHARED_DAILY_TOKENS = 200000;
const DEFAULT_FAIR_USER_COUNT = 20;
const DEFAULT_AVERAGE_OUTPUT_TOKENS = 160;
const DEFAULT_MAX_MESSAGE_WORDS = 160;
const DEFAULT_MAX_HISTORY_WORDS = 700;
const DEFAULT_MAX_LONG_TERM_WORDS = 360;
const DEFAULT_COMPACT_HISTORY_WORDS = 900;
const DEFAULT_COMPACT_TARGET_WORDS = 220;

const memoryRateLimitStore = new Map();

const LONG_MESSAGE_REFUSALS = [
  "That message is too chunky for my tiny free-tier backpack. Ask me the short version.",
  "I respect the essay energy, but the backend has refused this one on budget grounds. Trim it and try again.",
  "That question is larger than my hosting plan's emotional support allowance. Smaller, please.",
  "I am but a modest free-tier bot. That message is too long for me to answer responsibly.",
  "Nope, that prompt tried to move in and sign a lease. Give me the compact version.",
  "Backend says no. I agree with backend. This message needs fewer words and fewer dramatic entrances.",
  "That is too long for this little portfolio bot. Condense it before the server starts judging both of us.",
  "I cannot process that much text on this setup. Free-tier dignity has boundaries.",
  "That message exceeded my tiny-token patience meter. Ask it in one clean question.",
  "I am hosted on a budget, not in a data center throne room. Shorten that and I will behave.",
  "The backend refused this because it is too long. Honestly, fair.",
  "That prompt is trying to become a novel. I support literature, but not inside this chat box.",
  "Too long. My free-tier knees buckled. Send a tighter version.",
  "I would answer, but the budget simply said no.",
  "That is beyond my current context budget. Give me the main question and I will answer it.",
];

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
    quotaChecked: true,
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

    if (route.endpoint !== "wakeup") {
      const shortCircuit = shortCircuitPayload(route.endpoint, body, env);
      if (shortCircuit) {
        return jsonResponse(shortCircuit, 200, allowedOrigin);
      }
    }

    let workerRateLimit = null;
    if (route.rateLimited || route.quotaChecked) {
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
      if (route.rateLimited && shouldCountUpstreamPayload(upstreamResult.data)) {
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

function shortCircuitPayload(endpoint, body, env) {
  const limits = conversationLimits(env);

  if (endpoint === "chat") {
    const message = String(body.message || "").trim();
    if (!message) {
      return errorResponse("Ask me something about Athulya first. I promise this works better with input.", limits);
    }

    if (countWords(message) > limits.maxMessageWords) {
      return errorResponse(refusalForLongMessage(message), limits);
    }

    const longTermWords = countWords(normalizeLongTermContext(body.long_term_context));
    if (longTermWords > limits.maxLongTermWords) {
      return errorResponse(
        `Long-term context is too large. Limit it to ${limits.maxLongTermWords} words before sending it back.`,
        limits,
      );
    }
  }

  if (endpoint === "compact_context") {
    const previousLongTermContext = body.previous_long_term_context || body.long_term_context || {};
    const longTermWords = countWords(normalizeLongTermContext(previousLongTermContext));
    if (longTermWords > limits.maxLongTermWords) {
      return {
        long_term_context: { summary: "" },
        backend_refused: true,
        error: `Long-term context is too large. Limit it to ${limits.maxLongTermWords} words before sending it back.`,
        accepted_history: [],
        ignored_end_history: [],
        ignored_history: [],
        metadata: { max_long_term_words: limits.maxLongTermWords },
      };
    }

    const compactHistoryWords = countWords(body.chat_history || []);
    if (!compactHistoryWords && !longTermWords) {
      return {
        long_term_context: { summary: "" },
        backend_refused: false,
        accepted_history: [],
        ignored_end_history: [],
        ignored_history: [],
        metadata: {
          accepted_history_words: 0,
          ignored_end_history_words: 0,
          compact_history_word_limit: limits.compactHistoryWords,
          target_words: limits.compactTargetWords,
        },
      };
    }
  }

  return null;
}

function conversationLimits(env) {
  return {
    maxMessageWords: positiveInt(env.HUGGY_MAX_MESSAGE_WORDS, DEFAULT_MAX_MESSAGE_WORDS),
    maxHistoryWords: positiveInt(env.HUGGY_MAX_HISTORY_WORDS, DEFAULT_MAX_HISTORY_WORDS),
    maxLongTermWords: positiveInt(env.HUGGY_MAX_LONG_TERM_WORDS, DEFAULT_MAX_LONG_TERM_WORDS),
    compactHistoryWords: positiveInt(env.HUGGY_COMPACT_HISTORY_WORDS, DEFAULT_COMPACT_HISTORY_WORDS),
    compactTargetWords: positiveInt(env.HUGGY_COMPACT_TARGET_WORDS, DEFAULT_COMPACT_TARGET_WORDS),
  };
}

function errorResponse(message, limits) {
  return {
    reply: message,
    backend_refused: true,
    accepted_history: [],
    forwarded_history: [],
    ignored_history: [],
    metadata: {
      accepted_history_words: 0,
      forwarded_history_words: 0,
      max_message_words: limits.maxMessageWords,
      max_history_words: limits.maxHistoryWords,
      max_long_term_words: limits.maxLongTermWords,
    },
  };
}

function refusalForLongMessage(message) {
  return LONG_MESSAGE_REFUSALS[countWords(message) % LONG_MESSAGE_REFUSALS.length];
}

function normalizeLongTermContext(rawContext) {
  if (rawContext === null || rawContext === undefined) {
    return "";
  }
  if (typeof rawContext === "string") {
    return rawContext.trim();
  }
  if (typeof rawContext === "object" && !Array.isArray(rawContext)) {
    for (const key of ["summary", "context", "long_term_context", "memory"]) {
      if (typeof rawContext[key] === "string") {
        return rawContext[key].trim();
      }
    }
    return "";
  }
  return String(rawContext).trim();
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
    nextWeightedWords <= policy.dailyWeightedWordLimit;
  const reason =
    nextRequests > policy.dailyRequestLimit
      ? "daily_ip_request_limit_reached"
      : "daily_ip_weighted_word_limit_reached";

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
    payloadWordLimit: null,
    payloadWords: currentPayloadWords,
    requestedPayloadWords,
    remainingPayloadWords: null,
    weightedWords: currentWeightedWords,
    requestedWeightedWords,
    weightedWordLimit: policy.dailyWeightedWordLimit,
    remainingWeightedWords: Math.max(0, policy.dailyWeightedWordLimit - currentWeightedWords),
    resetSeconds,
    resetAt: new Date(now.getTime() + resetSeconds * 1000).toISOString(),
    contextWords: policy.contextWords,
    contextTokens: policy.contextTokens,
    sharedDailyTokens: policy.sharedDailyTokens,
    averageOutputTokens: policy.averageOutputTokens,
    perUserDailyTokenBudget: policy.perUserDailyTokenBudget,
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
  committed.remainingPayloadWords = null;
  committed.weightedWords = rateLimit.nextWeightedWords;
  committed.remainingWeightedWords = Math.max(
    0,
    rateLimit.weightedWordLimit - rateLimit.nextWeightedWords,
  );
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
  const sharedDailyTokens = positiveInt(env.HUGGY_SHARED_DAILY_TOKENS, DEFAULT_SHARED_DAILY_TOKENS);
  const fairUserCount = positiveInt(env.HUGGY_FAIR_USER_COUNT, DEFAULT_FAIR_USER_COUNT);
  const averageOutputTokens = positiveInt(
    env.HUGGY_AVERAGE_OUTPUT_TOKENS,
    DEFAULT_AVERAGE_OUTPUT_TOKENS,
  );
  const estimatedTokensPerWord = contextTokens / contextWords;
  const perUserDailyTokenBudget = Math.max(1, Math.floor(sharedDailyTokens / fairUserCount));
  const computedDailyRequestLimitFromRequests = Math.max(
    1,
    Math.floor(sharedDailyRequests / fairUserCount),
  );
  const computedDailyRequestLimitFromTokens = Math.max(
    1,
    Math.floor(perUserDailyTokenBudget / (contextTokens + averageOutputTokens)),
  );
  const computedDailyRequestLimit = Math.min(
    computedDailyRequestLimitFromRequests,
    computedDailyRequestLimitFromTokens,
  );
  const outputReserveTokens = computedDailyRequestLimit * averageOutputTokens;
  const computedDailyWeightedWordLimit = Math.max(
    contextWords,
    Math.floor((perUserDailyTokenBudget - outputReserveTokens) / estimatedTokensPerWord),
  );
  return {
    contextWords,
    contextTokens,
    sharedDailyTokens,
    averageOutputTokens,
    perUserDailyTokenBudget,
    estimatedTokensPerWord,
    sharedDailyRequests,
    fairUserCount,
    dailyRequestLimit: positiveInt(env.HUGGY_DAILY_REQUEST_LIMIT, computedDailyRequestLimit),
    dailyWeightedWordLimit: positiveInt(
      env.HUGGY_DAILY_WEIGHTED_WORD_LIMIT,
      computedDailyWeightedWordLimit,
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
        payload_words: rateLimit.payloadWords,
        requested_payload_words: rateLimit.requestedPayloadWords,
        weighted_word_limit: rateLimit.weightedWordLimit,
        weighted_words: rateLimit.weightedWords,
        requested_weighted_words: rateLimit.requestedWeightedWords,
        remaining_weighted_words: rateLimit.remainingWeightedWords,
        reset_seconds: rateLimit.resetSeconds,
        reset_at: rateLimit.resetAt,
        context_words: rateLimit.contextWords,
        context_tokens: rateLimit.contextTokens,
        shared_daily_tokens: rateLimit.sharedDailyTokens,
        average_output_tokens: rateLimit.averageOutputTokens,
        per_user_daily_token_budget: rateLimit.perUserDailyTokenBudget,
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
    payload_words: rateLimit.payloadWords,
    requested_payload_words: rateLimit.requestedPayloadWords,
    weighted_word_limit: rateLimit.weightedWordLimit,
    weighted_words: rateLimit.weightedWords,
    requested_weighted_words: rateLimit.requestedWeightedWords,
    remaining_weighted_words: rateLimit.remainingWeightedWords,
    reset_seconds: rateLimit.resetSeconds,
    reset_at: rateLimit.resetAt,
    context_words: rateLimit.contextWords,
    context_tokens: rateLimit.contextTokens,
    shared_daily_tokens: rateLimit.sharedDailyTokens,
    average_output_tokens: rateLimit.averageOutputTokens,
    per_user_daily_token_budget: rateLimit.perUserDailyTokenBudget,
    estimated_tokens_per_word: rateLimit.estimatedTokensPerWord,
    fair_user_count: rateLimit.fairUserCount,
  };
}

function addWorkerRateLimitHeaders(headers, rateLimit) {
  if (!rateLimit.allowed) {
    headers.set("retry-after", String(rateLimit.resetSeconds));
  }
  headers.set("huggy-worker-ratelimit-limit-requests", String(rateLimit.requestLimit));
  headers.set("huggy-worker-ratelimit-used-requests", String(rateLimit.requestCount));
  headers.set("huggy-worker-ratelimit-remaining-requests", String(rateLimit.remainingRequests));
  headers.set("huggy-worker-ratelimit-used-payload-words", String(rateLimit.payloadWords));
  headers.set(
    "huggy-worker-ratelimit-requested-payload-words",
    String(rateLimit.requestedPayloadWords),
  );
  headers.set("huggy-worker-ratelimit-limit-weighted-words", String(rateLimit.weightedWordLimit));
  headers.set("huggy-worker-ratelimit-used-weighted-words", String(rateLimit.weightedWords));
  headers.set(
    "huggy-worker-ratelimit-requested-weighted-words",
    String(rateLimit.requestedWeightedWords),
  );
  headers.set(
    "huggy-worker-ratelimit-remaining-weighted-words",
    String(rateLimit.remainingWeightedWords),
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
      "huggy-worker-ratelimit-used-payload-words",
      "huggy-worker-ratelimit-requested-payload-words",
      "huggy-worker-ratelimit-limit-weighted-words",
      "huggy-worker-ratelimit-used-weighted-words",
      "huggy-worker-ratelimit-requested-weighted-words",
      "huggy-worker-ratelimit-remaining-weighted-words",
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
