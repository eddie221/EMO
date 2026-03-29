"""
EMO Meaning Evaluator — persistent stdin/stdout process.
Loads Qwen3-VL-2B-Instruct once, then evaluates user descriptions on demand.
Protocol: JSON lines in, JSON lines out.
  Input:  {"word": str, "description": str, "user_answer": str}
  Output: {"correct": bool, "feedback": str}
  Ready signal: {"status": "ready"}
  Error:  {"error": str}
"""

import sys
import json
import os

MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"


def get_device():
    import torch
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps", torch.float16
    return "cpu", torch.float32


def load_model():
    import torch
    from transformers import Qwen3VLForConditionalGeneration, AutoProcessor

    device, dtype = get_device()
    processor = AutoProcessor.from_pretrained(MODEL_ID)

    if device == "cuda":
        model = Qwen3VLForConditionalGeneration.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            device_map="auto",
        )
    else:
        model = Qwen3VLForConditionalGeneration.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
        )
        try:
            model = model.to(device)
        except Exception:
            model = model.to("cpu")

    model.eval()
    return model, processor


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


def evaluate(model, processor, word: str, description: str, user_answer: str) -> dict:
    import torch

    prompt = build_prompt(word, description, user_answer)
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
    )
    inputs = processor(text=[text], return_tensors="pt").to(model.device)

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=120,
            do_sample=False,
            temperature=None,
            top_p=None,
        )

    generated_ids = [o[len(i):] for o, i in zip(outputs, inputs.input_ids)]
    generated = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()

    first_line = generated.split("\n")[0].strip().upper()
    correct = first_line.startswith("CORRECT") and not first_line.startswith("INCORRECT")
    return {"correct": correct, "feedback": generated}


def main():
    os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

    try:
        model, processor = load_model()
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
                model, processor,
                req["word"],
                req.get("description", ""),
                req["user_answer"],
            )
            print(json.dumps(result), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
