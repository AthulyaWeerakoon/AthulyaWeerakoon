# Huggy Cloudflare Worker

This Worker proxies the public portfolio frontend to the Huggy Hugging Face Space without exposing the shared secret in browser JavaScript.

## Endpoints

- `POST /api/huggy/wakeup`
- `POST /api/huggy/chat`
- `POST /api/huggy/compact-context`

The Worker injects `x-huggy-secret` before forwarding requests to the Space.

It also applies a per-IP daily fair-use budget before the request reaches Hugging Face. If the visitor is over budget, the Worker returns a Huggy-shaped `backend_refused: true` response itself, so the frontend can handle it like any other short-circuit response without spending Groq tokens.

The Worker also handles cheap request-validation short circuits before touching Hugging Face or KV:

- empty chat messages
- overlong chat messages
- overlong long-term context
- no-op context compaction requests with no history and no previous context

These responses keep Huggy's normal API shape but do not spend model tokens and do not count against the daily IP budget.

## Setup

Install Wrangler if needed:

```bash
npm install -g wrangler
```

Copy the config template:

```bash
cd cloudflare/huggy-worker
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`:

```toml
HUGGY_SPACE_URL = "https://atleebugs-huggy.hf.space"
ALLOWED_ORIGIN = "https://athulyaweerakoon.xyz"
HUGGY_CONTEXT_WORDS = "552"
HUGGY_CONTEXT_TOKENS = "1000"
HUGGY_SHARED_DAILY_REQUESTS = "1000"
HUGGY_SHARED_DAILY_TOKENS = "200000"
HUGGY_FAIR_USER_COUNT = "10"
HUGGY_AVERAGE_OUTPUT_TOKENS = "160"
HUGGY_UPSTREAM_START_TIMEOUT_MS = "15000"
HUGGY_WAKE_RETRY_AFTER_SECONDS = "3"
# Optional conversation limits. Keep these aligned with the Hugging Face Space.
# HUGGY_MAX_MESSAGE_WORDS = "160"
# HUGGY_MAX_HISTORY_WORDS = "700"
# HUGGY_MAX_LONG_TERM_WORDS = "360"
# HUGGY_COMPACT_HISTORY_WORDS = "900"
# HUGGY_COMPACT_TARGET_WORDS = "220"
# Optional:
# HUGGY_DAILY_REQUEST_LIMIT = "8"
# HUGGY_DAILY_WEIGHTED_WORD_LIMIT = "4800"
```

Use the Space app URL, not `https://huggingface.co/spaces/AtleeBugs/Huggy`.

Create a KV namespace for daily per-IP counters:

```bash
wrangler kv namespace create HUGGY_RATE_LIMIT_KV
```

Copy the returned namespace id into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "HUGGY_RATE_LIMIT_KV"
id = "your-kv-namespace-id"
```

The default budget is tuned for Groq `openai/gpt-oss-20b` free-plan limits:

```text
shared daily request pool = 1000 requests per day
shared daily token pool = 200000 tokens per day
fair user count = 10
reserved average output = 160 tokens per answered request
daily requests per IP = about 17
daily weighted words per IP = about 9538
```

The request limit matters because every answered request carries Huggy's base context, even if the visitor only types a tiny message. Weighted words count that always-included context plus the incoming payload. Payload words are retained as telemetry, while the weighted budget is the enforced token-cost estimate.

Wake-up is deliberately asynchronous across the Worker and browser. A sleeping
Hugging Face Space commonly answers the first request with `503`; the Worker
translates transient startup responses and start-request timeouts into `202`
with `retry-after`, and the portfolio retries with increasing delays capped at
one minute. This avoids holding a single Cloudflare request open throughout a
potentially long Space cold start.

The Worker only commits usage after Huggy returns a non-refused answer. Backend-refused responses, upstream errors, and `wakeup` do not count against the daily budget because they do not spend LLM tokens.

Set the same shared secret you configured in the Hugging Face Space:

```bash
wrangler secret put HUGGY_CLOUDFLARE_SECRET
```

Run locally:

```bash
wrangler dev
```

Deploy:

```bash
wrangler deploy
```

## Test Locally

Wake Huggy:

```bash
curl -i -X POST http://127.0.0.1:8787/api/huggy/wakeup
```

Ask a question:

```bash
curl -i -X POST http://127.0.0.1:8787/api/huggy/chat \
  -H "content-type: application/json" \
  --data '{
    "message": "What can you tell me about Athulya security engineering?",
    "chat_history": [],
    "long_term_context": {"summary": ""}
  }'
```

The JSON body includes `metadata.rate_limit.headers` when Huggy receives Groq rate-limit headers.

The Worker also copies those headers onto the HTTP response when available:

- `x-ratelimit-limit-requests`
- `x-ratelimit-limit-tokens`
- `x-ratelimit-remaining-requests`
- `x-ratelimit-remaining-tokens`
- `x-ratelimit-reset-requests`
- `x-ratelimit-reset-tokens`
- `retry-after`

It also mirrors them with a `huggy-` prefix, for example `huggy-x-ratelimit-remaining-tokens`, so frontend code can read them even if another layer later uses the original header names.

For chat and context-compaction requests, the Worker also adds its own daily IP budget metadata to `metadata.worker_rate_limit` and exposes these Worker-owned headers:

- `huggy-worker-ratelimit-limit-requests`
- `huggy-worker-ratelimit-used-requests`
- `huggy-worker-ratelimit-remaining-requests`
- `huggy-worker-ratelimit-limit-payload-words`
- `huggy-worker-ratelimit-used-payload-words`
- `huggy-worker-ratelimit-requested-payload-words`
- `huggy-worker-ratelimit-remaining-payload-words`
- `huggy-worker-ratelimit-limit-weighted-words`
- `huggy-worker-ratelimit-used-weighted-words`
- `huggy-worker-ratelimit-requested-weighted-words`
- `huggy-worker-ratelimit-remaining-weighted-words`
- `huggy-worker-ratelimit-reset-seconds`

When the Worker blocks a visitor for the daily IP budget, it returns HTTP `429`, a `retry-after` header, and the same Huggy-style response shape:

```json
{
  "reply": "You've been hanging with me for an awfully long time today...",
  "backend_refused": true,
  "accepted_history": [],
  "forwarded_history": [],
  "ignored_history": [],
  "metadata": {
    "error": "worker_daily_rate_limited"
  }
}
```

## Frontend Payloads

Chat:

```json
{
  "message": "What did Athulya do at WSO2?",
  "chat_history": [
    {"user": "Tell me about Athulya", "assistant": "Athulya is..."}
  ],
  "long_term_context": {"summary": ""}
}
```

Compact context:

```json
{
  "chat_history": [
    {"user": "Tell me about Athulya", "assistant": "Athulya is..."}
  ],
  "previous_long_term_context": {"summary": ""}
}
```

Long-message marker:

```json
{
  "type": "message_too_long",
  "preview": "User pasted a long explanation about WSO2, security, AI, writing, and portfolio mechanics.",
  "refusal": "That message is too long for me to handle."
}
```
