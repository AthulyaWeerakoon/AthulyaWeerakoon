# Huggy RAG Scripts

These scripts are designed to work locally and later inside a Hugging Face Space with the same repository-relative paths.

## Build The Index

```bash
python scripts/rag/build_index.py
```

This writes:

- `rag_artifacts/knowledge.faiss`
- `rag_artifacts/chunks.json`
- `rag_artifacts/manifest.json`

Pull requests run `.github/workflows/rag-retrieval-check.yml`, which rebuilds the index into a temporary directory and runs the retrieval FAQ suite without modifying committed artifacts.

## Fetch Context

```bash
python scripts/rag/fetch_context.py "What did Athulya do at WSO2?"
```

By default, fetched context is rendered without retrieval scores so it is ready to pass into the chatbot prompt. Add `--include-scores` when debugging retrieval quality, and `--verbose` if you want model loading logs.

If the embedding model is already cached locally, skip Hugging Face network checks:

```bash
export RAG_LOCAL_FILES_ONLY=1
```

Run the retrieval quality suite locally:

```bash
python scripts/rag/evaluate_retrieval.py
```

## Try Huggy Locally

```bash
python scripts/rag/chat_local.py "What did Athulya do at WSO2?"
```

Use `--show-context` to inspect retrieved chunks.

DeepSeek-R1-Distill models recommend keeping instructions inside the user prompt rather than using a separate system prompt. `chat_local.py` follows that pattern by composing Huggy's chatbot context, retrieved knowledge, and the user message into one user prompt.

## HDD Cache Example

If your Python environment and model cache live on an HDD, set cache paths before running the scripts:

```bash
export HF_HOME=/media/atleebugs/HDD/PythonLib/ml-cache/huggingface
export TRANSFORMERS_CACHE=/media/atleebugs/HDD/PythonLib/ml-cache/huggingface/transformers
export TORCH_HOME=/media/atleebugs/HDD/PythonLib/ml-cache/torch
export TMPDIR=/media/atleebugs/HDD/PythonLib/ml-temp
```

Then run:

```bash
/media/atleebugs/HDD/PythonLib/ml-envs/portfolio-rag/bin/python \
scripts/rag/chat_local.py "What did Athulya do at WSO2?" \
--max-new-tokens 120 \
--show-context
```

The first run downloads `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B`. It can take a while. If interrupted, rerun the same command and Hugging Face should resume or reuse cached files.

## Try Huggy With Gemini

Set your Gemini key in the environment:

```bash
export GEMINI_API_KEY="your-key-here"
```

Then run:

```bash
python scripts/rag/chat_gemini.py "What did Athulya do at WSO2?"
```

`chat_gemini.py` uses the same FAISS RAG artifacts as `chat_local.py`, then calls Gemini with only the retrieved context and Huggy instructions. It does not enable Google Search or other Gemini tools.
It is silent by default. Add `--verbose` to see whether it is loading RAG, fetching context, or waiting on Gemini.

The Gemini request timeout defaults to 20 seconds. Override it with:

```bash
export GEMINI_TIMEOUT_MS=45000
```

Thinking config is disabled by default because some low-cost Gemini models do not support it. If you choose a model that supports thinking levels, opt in with:

```bash
export GEMINI_THINKING_LEVEL=MINIMAL
```

Use `--show-context --show-scores` to inspect retrieved chunks and similarity scores during local testing. Scores are not included in the model prompt by default.

The default model is `gemini-2.5-flash`. Override it with:

```bash
export GEMINI_MODEL="your-model-name"
```

If Gemini feels slow, benchmark tiny no-RAG prompts:

```bash
python scripts/rag/benchmark_gemini.py
```

The benchmark waits between model tests by default to avoid free-tier per-minute quota errors. Pick the fastest working model and set it with `GEMINI_MODEL`. If every Gemini model takes tens of seconds to first token, use a different API provider for the portfolio chatbot.

## Try Huggy With Groq

Create a Groq API key, then set:

```bash
export GROQ_API_KEY="your-key-here"
export RAG_LOCAL_FILES_ONLY=1
```

Run Huggy with Groq:

```bash
python scripts/rag/chat_groq.py "What did Athulya do at WSO2?" --verbose
```

The default Groq model is `openai/gpt-oss-20b`, the recommended replacement for the deprecated `llama-3.1-8b-instant`. Override it with:

```bash
export GROQ_MODEL="your-model-name"
```

Benchmark tiny no-RAG prompts:

```bash
python scripts/rag/benchmark_groq.py
```

## Run The Gradio App

```bash
export HUGGY_PROVIDER=groq
export GROQ_API_KEY="your-key-here"
python app.py
```

The Hugging Face Space should use the same `app.py` entrypoint. Store provider keys as Space secrets, not in the repository. Set `HUGGY_PROVIDER=groq` and store `GROQ_API_KEY` as a Space secret to use the current Groq path. Gemini still works with `HUGGY_PROVIDER=gemini` and `GEMINI_API_KEY`.

For deployment behind Cloudflare, hide the Gradio chat UI and require a shared secret header on API calls:

```bash
export HUGGY_API_ONLY=1
export HUGGY_REQUIRE_SECRET=1
export HUGGY_CLOUDFLARE_SECRET="long-random-shared-secret"
export HUGGY_SECRET_HEADER="x-huggy-secret"
export HUGGY_PORTFOLIO_URL="https://athulyaweerakoon.xyz"
```

In that mode the Space still registers the `wakeup`, `chat`, and `compact_context` API endpoints, but it does not show the public chat interface. It shows a small API-only note pointing visitors to `HUGGY_PORTFOLIO_URL`. Cloudflare should inject the configured header before forwarding requests to the Hugging Face Space. Browser clients should call your Cloudflare route, not the Space directly, because the shared secret must not be exposed in frontend code.

### Frontend API Contract

The visible Gradio chat works normally in local/dev mode and receives recent session history from Gradio. It does not manage long-term compact memory by itself. The app also exposes two JSON-oriented API actions for the portfolio frontend when you want both bounded recent history and compact long-term context.

`wakeup` accepts no payload. It loads Huggy, the RAG index, and model assets, then returns a preset greeting without calling the LLM:

```json
{
  "reply": "Huggy is awake now. Ask away.",
  "ready": true,
  "already_awake": false
}
```

Call this through Cloudflare when the portfolio loads or before opening the chat. If Huggy is already awake, it returns immediately with another preset greeting.

`chat` accepts:

```json
{
  "message": "What did Athulya do at WSO2?",
  "chat_history": [
    {"user": "Show me his experience", "assistant": "/navigate experience"}
  ],
  "long_term_context": {"summary": "The user prefers concise answers."}
}
```

It returns `reply`, `backend_refused`, `accepted_history`, `forwarded_history`, `ignored_history`, and `metadata`. Normal chat keeps the newest complete user/assistant pairs within the word budget and forwards older overflow back to the frontend for later compaction.

Groq `chat` and `compact_context` responses include a frontend-readable `metadata.rate_limit` object when Groq provides rate-limit headers. Huggy forwards every received `retry-after` and `x-ratelimit-*` header under `metadata.rate_limit.headers`, and also includes normalized underscore keys for convenience. On successful calls, this is where the frontend can read remaining request/token budget. On 429 errors, the same shape is returned with `backend_refused: true`:

```json
{
  "reply": "Huggy is being rate-limited. Tiny free-tier traffic jam. Try again in about 2 second(s).",
  "backend_refused": true,
  "metadata": {
    "rate_limit": {
      "error": "rate_limited",
      "provider": "groq",
      "status_code": 429,
      "headers": {
        "retry-after": "2",
        "x-ratelimit-remaining-requests": "14370",
        "x-ratelimit-remaining-tokens": "17997",
        "x-ratelimit-reset-requests": "2m59.56s",
        "x-ratelimit-reset-tokens": "7.66s"
      },
      "retry_after": "2",
      "x_ratelimit_remaining_requests": "14370",
      "x_ratelimit_remaining_tokens": "17997",
      "x_ratelimit_reset_requests": "2m59.56s",
      "x_ratelimit_reset_tokens": "7.66s"
    }
  }
}
```

The frontend or Cloudflare layer can use `retry_after`, remaining request count, remaining token count, and reset timings to back off before trying again.

If the frontend did not store a giant refused user message, it can send a compact marker in `chat_history` instead of the original content:

```json
{
  "type": "message_too_long",
  "preview": "User pasted a long numbered explanation about WSO2, security, AI, writing, and portfolio mechanics.",
  "refusal": "That message is too long for me to handle."
}
```

Huggy will treat that as a real conversation event. If the next user says "huh?", Huggy should explain that the previous message was rejected because it exceeded the context budget and ask them to split it into smaller questions.

`compact_context` accepts a previous `long_term_context` object plus history to compact. It keeps the oldest complete pairs within the compaction word budget, ignores overflow at the end, and returns:

```json
{
  "long_term_context": {"summary": "Compacted memory text"},
  "ignored_end_history": []
}
```

If a user message is too long, the backend returns `backend_refused: true` with a short refusal message. The frontend should not add that rejected message to chat history. If the previous long-term context exceeds the configured budget, the backend refuses the request until the frontend compacts or trims it.

Useful budget environment variables:

- `HUGGY_MAX_MESSAGE_WORDS`, default `160`
- `HUGGY_MAX_HISTORY_WORDS`, default `700`
- `HUGGY_MAX_LONG_TERM_WORDS`, default `360`
- `HUGGY_COMPACT_HISTORY_WORDS`, default `900`
- `HUGGY_COMPACT_TARGET_WORDS`, default `220`

## Sync To A Hugging Face Space

The GitHub workflow at `.github/workflows/sync-huggingface-space.yml` pushes this repository to a Hugging Face Space when `main` is updated.

Add these GitHub repository secrets:

- `HF_TOKEN`: a Hugging Face access token with write access to the Space.
- `HF_SPACE_REPO`: the Space repo path, such as `athulyaweerakoon/huggy`.

Add this Hugging Face Space secret:

- `GROQ_API_KEY`: the Groq key used by `app.py`.
- `HUGGY_API_ONLY`: set to `1` for deployment.
- `HUGGY_REQUIRE_SECRET`: set to `1` for deployment.
- `HUGGY_CLOUDFLARE_SECRET`: the shared secret Cloudflare injects into API requests.
- `HUGGY_SECRET_HEADER`: optional header name, defaults to `x-huggy-secret`.
- `HUGGY_PORTFOLIO_URL`: public portfolio URL shown on the API-only Space page.

If using Gemini instead of Groq, store `GEMINI_API_KEY` and set `HUGGY_PROVIDER=gemini`.
