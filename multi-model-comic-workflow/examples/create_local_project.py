from __future__ import annotations

import json
import os
from pathlib import Path

import requests

API_BASE_URL = os.getenv("COMIC_WORKFLOW_API_BASE_URL", "http://127.0.0.1:4316")
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "example_runs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CREATE_PAYLOAD = {
    "title": "Ghost Line Incident",
    "storyPrompt": (
        "A rookie exorcist and a retired subway engineer discover a ghost train entering "
        "an abandoned station flooded with black water. Across five panels, establish the "
        "station, the train arriving, the engineer recognizing the train number, the exorcist "
        "preparing a protective charm, and a final eerie close-up of pale passengers staring back."
    ),
    "styleId": "american-modern",
    "generateMetadata": True,
    "metadataLocale": "zh-CN",
    "metadataTextProfileId": "mock-text",
    "imageProfileId": "mock-image",
    "allowFallback": True,
}

APPEND_PAYLOAD = {
    "storyPrompt": (
        "Continue the same scene as page 2. The train doors slide open, rows of silent passengers "
        "turn toward the heroes in unison, the engineer realizes the vanished line returned after "
        "ten years, and the last panel reveals one passenger holding the exorcist's childhood umbrella."
    ),
    "storyMemorySummary": (
        "The heroes are investigating a supernatural train line erased from the city map ten years ago. "
        "The tone should stay eerie, cinematic, and melancholic."
    ),
    "imageProfileId": "mock-image",
    "allowFallback": True,
}


def get_json(path: str):
    response = requests.get(f"{API_BASE_URL}{path}", timeout=60)
    response.raise_for_status()
    return response.json()


def post_json(path: str, payload: dict):
    response = requests.post(f"{API_BASE_URL}{path}", json=payload, timeout=600)
    response.raise_for_status()
    return response.json()


def main() -> None:
    health = get_json("/api/health")
    print("Health:", health)

    created = post_json("/api/comics/projects", CREATE_PAYLOAD)
    comic_id = created["project"]["comicId"]
    print("Created comic:", comic_id)

    appended = post_json(f"/api/comics/projects/{comic_id}/pages", APPEND_PAYLOAD)
    loaded = get_json(f"/api/comics/projects/{comic_id}")

    summary = {
        "comicId": comic_id,
        "title": loaded["title"],
        "description": loaded["description"],
        "pageCount": loaded["pageCount"],
        "coverImage": loaded.get("coverImage", {}),
        "latestPageImage": appended["page"]["image"],
    }

    output_path = OUTPUT_DIR / f"{comic_id}.json"
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Saved summary:", output_path)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
