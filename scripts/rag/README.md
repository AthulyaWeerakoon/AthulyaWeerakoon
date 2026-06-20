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

The default Groq model is `llama-3.1-8b-instant`. Override it with:

```bash
export GROQ_MODEL="your-model-name"
```

Benchmark tiny no-RAG prompts:

```bash
python scripts/rag/benchmark_groq.py
```

## Run The Gradio App

```bash
export GEMINI_API_KEY="your-key-here"
python app.py
```

The Hugging Face Space should use the same `app.py` entrypoint. Store `GEMINI_API_KEY` as a Space secret, not in the repository.
Set `HUGGY_PROVIDER=groq` and store `GROQ_API_KEY` as a Space secret to use Groq instead of Gemini.

## Sync To A Hugging Face Space

The GitHub workflow at `.github/workflows/sync-huggingface-space.yml` pushes this repository to a Hugging Face Space when `main` is updated.

Add these GitHub repository secrets:

- `HF_TOKEN`: a Hugging Face access token with write access to the Space.
- `HF_SPACE_REPO`: the Space repo path, such as `athulyaweerakoon/huggy`.

Add this Hugging Face Space secret:

- `GEMINI_API_KEY`: the Gemini key used by `app.py`.
