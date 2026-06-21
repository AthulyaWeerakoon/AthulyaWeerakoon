# Huggy Cloudflare Worker

This Worker proxies the public portfolio frontend to the Huggy Hugging Face Space without exposing the shared secret in browser JavaScript.

## Endpoints

- `POST /api/huggy/wakeup`
- `POST /api/huggy/chat`
- `POST /api/huggy/compact-context`

The Worker injects `x-huggy-secret` before forwarding requests to the Space.

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
```

Use the Space app URL, not `https://huggingface.co/spaces/AtleeBugs/Huggy`.

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
