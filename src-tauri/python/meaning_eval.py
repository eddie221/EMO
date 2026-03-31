"""
EMO Meaning Evaluator — persistent stdin/stdout process.
Loads google/gemma-3-1b-it once, then evaluates user descriptions on demand.
Protocol: JSON lines in, JSON lines out.
  Input:  {"word": str, "description": str, "user_answer": str}
  Output: {"correct": bool, "feedback": str}
  Ready signal: {"status": "ready"}
  Error:  {"error": str}
"""

import sys
import json
import os

MODEL_ID = "google/gemma-3-1b-it"


def get_device():
    import torch
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps", torch.float16
    return "cpu", torch.float32


def _from_pretrained(cls, model_id, **kwargs):
    """Load from local cache only. Model must be downloaded by first-time setup."""
    try:
        return cls.from_pretrained(model_id, local_files_only=True, **kwargs)
    except OSError as e:
        raise OSError(
            f"Model '{model_id}' is not found in local cache. "
            f"Please run first-time setup to download it.\n(Detail: {e})"
        ) from e


def load_model():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device, dtype = get_device()
    tokenizer = _from_pretrained(AutoTokenizer, MODEL_ID)

    if device == "cuda":
        model = _from_pretrained(
            AutoModelForCausalLM, MODEL_ID,
            torch_dtype=dtype, device_map="auto",
        )
    else:
        model = _from_pretrained(
            AutoModelForCausalLM, MODEL_ID,
            torch_dtype=dtype,
        )
        try:
            model = model.to(device)
        except Exception:
            model = model.to("cpu")

    model.eval()
    return model, tokenizer


def build_prompt(word: str, description: str, user_answer: str) -> str:
    if description:
        ref = f'Correct definition: "{description}"'
    else:
        ref = "(No reference definition provided — use your general knowledge.)"
    return (
        f"You are a strict but fair language-learning evaluator.\n\n"
        f'Word: "{word}"\n'
        f"{ref}\n"
        f'Answer: "{user_answer}"\n\n'
        f"Does the answer correctly capture the meaning of the word? "
        f"Reply with CORRECT or INCORRECT on the first line, then one short sentence of feedback."
    )


def evaluate(model, tokenizer, word: str, description: str, user_answer: str) -> dict:
    import torch

    prompt = build_prompt(word, description, user_answer)
    messages = [{"role": "user", "content": prompt}]

    inputs = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=True,
    ).to(model.device)

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=120,
            do_sample=False,
        )

    generated_ids = outputs[0][inputs["input_ids"].shape[-1]:]
    generated = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()

    first_line = generated.split("\n")[0].strip().upper()
    correct = first_line.startswith("CORRECT") and not first_line.startswith("INCORRECT")
    return {"correct": correct, "feedback": generated}


def main():
    os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    try:
        model, tokenizer = load_model()
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model: {e}"}), flush=True)
        sys.exit(1)

    print(json.dumps({"status": "ready"}), flush=True)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            result = evaluate(
                model, tokenizer,
                req["word"],
                req.get("description", ""),
                req["user_answer"],
            )
            print(json.dumps(result), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
