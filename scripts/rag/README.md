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

## Fetch Context

```bash
python scripts/rag/fetch_context.py "What did Athulya do at WSO2?"
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
