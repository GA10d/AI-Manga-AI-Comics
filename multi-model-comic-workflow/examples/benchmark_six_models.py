from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
from base64 import b64decode
from datetime import datetime
from pathlib import Path
from time import perf_counter

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
API_BASE_URL = os.getenv("COMIC_WORKFLOW_API_BASE_URL", "http://127.0.0.1:4316")
OUTPUT_DIR = REPO_ROOT / "artifacts" / "benchmark_outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OPENAI_IMAGE_COSTS = {
    ("gpt-image-1.5", "medium", "1024x1024"): 0.034,
    ("gpt-image-1-mini", "low", "1024x1024"): 0.005,
}

GEMINI_IMAGE_COSTS = {
    ("gemini-3-pro-image-preview", "1K"): 0.134,
    ("gemini-3.1-flash-image-preview", "1K"): 0.067,
}

STYLE_ID = "american-modern"
NEGATIVE_PROMPT = "blurry unreadable text duplicated faces broken anatomy watermark bad hands extra fingers"
STORY_PROMPT = (
    "Continue the story as page 2 of a supernatural subway mystery. Lin Yue, a rookie exorcist "
    "with a yellow raincoat over her school uniform, steps onto the flooded platform while Mori "
    "Akira, a tired rail engineer in a dark navy coat and white gloves, shines a maintenance lantern "
    "toward a ghost train arriving out of black water. Across five panels, show the train doors "
    "opening, rows of pale passengers turning to stare at them in unison, Lin gripping her prayer "
    "beads, Akira realizing the train number matches the line that vanished ten years ago, and the "
    "final panel ending on a close-up of one passenger holding Lin's childhood umbrella."
)
PREVIOUS_PAGES = [
    {
        "pageNumber": 1,
        "prompt": "Lin Yue and Mori Akira descend into an abandoned midnight subway station where black water covers the tracks and old talismans float against the pillars.",
        "summary": "They hear an incoming train on a line that was erased from the city map ten years ago.",
    }
]
STORY_MEMORY_SUMMARY = (
    "Lin Yue is investigating a supernatural omen tied to missing commuters, while Mori Akira is the "
    "only surviving engineer who remembers the vanished line. The atmosphere should feel eerie, "
    "melancholic, and cinematic, with strong character continuity across panels."
)

IMAGE_RUNS = [
    {
        "runName": "openai-standard",
        "label": "OpenAI Standard",
        "imageProfileId": "chatgpt-image",
        "runtimeImageModelConfig": {
            "model": "gpt-image-1.5",
            "imageSize": "1024x1024",
            "quality": "medium",
            "outputFormat": "jpeg",
        },
    },
    {
        "runName": "openai-fast",
        "label": "OpenAI Fast",
        "imageProfileId": "chatgpt-image",
        "runtimeImageModelConfig": {
            "model": "gpt-image-1-mini",
            "imageSize": "1024x1024",
            "quality": "low",
            "outputFormat": "jpeg",
        },
    },
    {
        "runName": "gemini-standard",
        "label": "Gemini Standard",
        "imageProfileId": "gemini-image",
        "runtimeImageModelConfig": {
            "model": "gemini-3-pro-image-preview",
            "imageSize": "1K",
            "aspectRatio": "3:4",
        },
    },
    {
        "runName": "gemini-fast",
        "label": "Gemini Fast",
        "imageProfileId": "gemini-image",
        "runtimeImageModelConfig": {
            "model": "gemini-3.1-flash-image-preview",
            "imageSize": "1K",
            "aspectRatio": "3:4",
        },
    },
    {
        "runName": "doubao-standard",
        "label": "Doubao Standard",
        "imageProfileId": "doubao-image",
        "runtimeImageModelConfig": {
            "model": "doubao-seedream-5-0-260128",
            "imageSize": "2K",
            "watermark": False,
        },
    },
    {
        "runName": "doubao-fast",
        "label": "Doubao Fast",
        "imageProfileId": "doubao-image",
        "runtimeImageModelConfig": {
            "model": "doubao-seedream-5-0-lite-260128",
            "imageSize": "2K",
            "watermark": False,
        },
    },
]


def post_json(path: str, payload: dict) -> dict:
    response = requests.post(f"{API_BASE_URL}{path}", json=payload, timeout=600)
    response.raise_for_status()
    return response.json()


def decode_image_payload(image_url: str) -> tuple[bytes, str]:
    if image_url.startswith("data:"):
        header, encoded = image_url.split(",", 1)
        mime_type = header.split(";", 1)[0].replace("data:", "", 1)
        return b64decode(encoded), mime_type

    response = requests.get(image_url, timeout=300)
    response.raise_for_status()
    mime_type = response.headers.get("content-type", "image/png").split(";", 1)[0]
    return response.content, mime_type


def save_generated_image(image_url: str, output_stem: str) -> Path:
    payload, mime_type = decode_image_payload(image_url)
    extension = mimetypes.guess_extension(mime_type) or ".png"
    if mime_type == "image/svg+xml":
        extension = ".svg"
    if mime_type == "image/jpeg":
        extension = ".jpg"

    target_path = OUTPUT_DIR / f"{output_stem}{extension}"
    target_path.write_bytes(payload)
    return target_path


def estimate_cost(run: dict) -> str:
    profile_id = run["imageProfileId"]
    config = run["runtimeImageModelConfig"]
    model = config.get("model")

    if profile_id == "chatgpt-image":
        amount = OPENAI_IMAGE_COSTS.get((model, config.get("quality"), config.get("imageSize")))
        return "unknown" if amount is None else f"{amount:.4f} USD"

    if profile_id == "gemini-image":
        amount = GEMINI_IMAGE_COSTS.get((model, config.get("imageSize")))
        return "unknown" if amount is None else f"{amount:.4f} USD"

    return "unknown"


def make_output_stem(run_name: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_run_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", run_name).strip("-").lower()
    return f"benchmark-{safe_run_name}-{timestamp}"


def main() -> None:
    results: list[dict] = []
    for run in IMAGE_RUNS:
        payload = {
            "storyPrompt": STORY_PROMPT,
            "styleId": STYLE_ID,
            "storyMemorySummary": STORY_MEMORY_SUMMARY,
            "previousPages": PREVIOUS_PAGES,
            "referenceImages": [],
            "negativePrompt": NEGATIVE_PROMPT,
            "allowFallback": False,
            "imageProfileId": run["imageProfileId"],
            "runtimeImageModelConfig": run["runtimeImageModelConfig"],
        }

        started = perf_counter()
        try:
            response = post_json("/api/comics/generate-page", payload)
            elapsed = perf_counter() - started
            output_path = save_generated_image(response["imageUrl"], make_output_stem(run["runName"]))
            results.append(
                {
                    "runName": run["runName"],
                    "model": run["runtimeImageModelConfig"]["model"],
                    "provider": response["provider"],
                    "runtimeSeconds": round(elapsed, 3),
                    "estimatedCost": estimate_cost(run),
                    "savedImagePath": str(output_path),
                }
            )
        except Exception as exc:
            elapsed = perf_counter() - started
            results.append(
                {
                    "runName": run["runName"],
                    "model": run["runtimeImageModelConfig"]["model"],
                    "runtimeSeconds": round(elapsed, 3),
                    "status": "failed",
                    "error": str(exc),
                }
            )

    summary_path = OUTPUT_DIR / "benchmark-summary.json"
    summary_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("Saved summary:", summary_path)


if __name__ == "__main__":
    main()
