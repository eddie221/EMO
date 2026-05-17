"""
EMO Meaning Evaluator — llama.cpp inference via llama-cpp-python.
Uses Qwen/Qwen3-8B-GGUF (no HF token required).

Protocol: JSON lines in, JSON lines out.
  Input:  {"word": str, "description": str, "user_answer": str}
  Output: {"correct": bool, "feedback": str}
  Ready:  {"status": "ready"}
  Error:  {"error": str}
"""

import re
import sys
import json
from pathlib import Path

MODEL_FILE = "Qwen3-8B-Q4_K_M.gguf"
MODEL_PATH = Path.home() / ".cache" / "emo" / "models" / MODEL_FILE


def load_model():
    from llama_cpp import Llama
    return Llama(
        model_path=str(MODEL_PATH),
        n_ctx=4096,
        n_gpu_layers=-1,  # use Metal/CUDA if available, else CPU
        verbose=False,
    )


def evaluate(llm, word: str, description: str, user_answer: str) -> dict:
    ref = f'Correct definition: "{description}"' if description else \
          "(No reference definition — use your general knowledge.)"
    # /no_think disables Qwen3's chain-of-thought mode for faster, direct output
    user_msg = (
        "You are a strict but fair language-learning evaluator.\n\n"
        f'Word: "{word}"\n'
        f"{ref}\n"
        f'Answer: "{user_answer}"\n\n'
        "Does the answer correctly capture the meaning of the word? "
        "Reply with CORRECT or INCORRECT on the first line, "
        "then one short feedback sentence. /no_think"
    )
    output = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user",   "content": user_msg},
        ],
        max_tokens=150,
        temperature=0.0,
    )
    raw   = output["choices"][0]["message"]["content"]
    text  = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    first = text.split("\n")[0].strip().upper()
    correct = first.startswith("CORRECT") and not first.startswith("INCORRECT")
    return {"correct": correct, "feedback": text}


def main():
    if not MODEL_PATH.exists():
        print(json.dumps({
            "error": f"Model not found at {MODEL_PATH}. Run first-time setup to download it."
        }), flush=True)
        sys.exit(1)

    try:
        llm = load_model()
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load model: {exc}"}), flush=True)
        sys.exit(1)

    print(json.dumps({"status": "ready"}), flush=True)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req    = json.loads(raw)
            result = evaluate(llm, req["word"], req.get("description", ""), req["user_answer"])
            print(json.dumps(result), flush=True)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
