"""
EMO Meaning Evaluator — llama.cpp inference via llama-cpp-python.
Uses Qwen/Qwen2.5-1.5B-Instruct-GGUF (no HF token required).

Protocol: JSON lines in, JSON lines out.
  Input:  {"word": str, "description": str, "user_answer": str}
  Output: {"correct": bool, "feedback": str}
  Ready:  {"status": "ready"}
  Error:  {"error": str}
"""

import sys
import json
from pathlib import Path

MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
MODEL_PATH = Path.home() / ".cache" / "emo" / "models" / MODEL_FILE


def load_model():
    from llama_cpp import Llama
    return Llama(
        model_path=str(MODEL_PATH),
        n_ctx=2048,
        n_gpu_layers=-1,  # use Metal/CUDA if available, else CPU
        verbose=False,
    )


def chat_prompt(user_msg: str) -> str:
    return (
        "<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n"
        f"<|im_start|>user\n{user_msg}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def evaluate(llm, word: str, description: str, user_answer: str) -> dict:
    ref = f'Correct definition: "{description}"' if description else \
          "(No reference definition — use your general knowledge.)"
    prompt = (
        "You are a strict but fair language-learning evaluator.\n\n"
        f'Word: "{word}"\n'
        f"{ref}\n"
        f'Answer: "{user_answer}"\n\n'
        "Does the answer correctly capture the meaning of the word? "
        "Reply with CORRECT or INCORRECT on the first line, "
        "then one short feedback sentence."
    )
    output = llm(
        chat_prompt(prompt),
        max_tokens=120,
        temperature=0.0,
        echo=False,
    )
    text  = output["choices"][0]["text"].strip()
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
