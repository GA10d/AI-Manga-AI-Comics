from __future__ import annotations

import base64
import html
import json
import mimetypes
import re
import unicodedata
from pathlib import Path
from typing import Any

import requests

DEFAULT_API_BASE_URL = "http://127.0.0.1:4316"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TEST_ROOT = REPO_ROOT / "test"
DEFAULT_CHARACTER_ALIASES = {
    "\u591c\u86fe\u6b63\u9053": "\u591c\u86fe\u6b63\u4e49",
}


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def normalize_lookup_key(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value))


def path_to_data_url(path: Path) -> str:
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{payload}"


def extract_labeled_value(line: str) -> tuple[str, str] | None:
    normalized = normalize_text(line)
    if "\uFF1A" in normalized:
        key, value = normalized.split("\uFF1A", 1)
        return key.strip(), value.strip()
    if ":" in normalized:
        key, value = normalized.split(":", 1)
        return key.strip(), value.strip()
    return None


def extract_character_names(raw_value: str) -> list[str]:
    candidates = re.split(r"[\u3001,\uFF0C/]+", normalize_text(raw_value))
    output: list[str] = []
    for candidate in candidates:
        cleaned = re.sub(r"[\uFF08(].*?[\uFF09)]", "", candidate).strip()
        if cleaned:
            output.append(cleaned)
    return output


def extract_description_body(raw_text: str) -> str:
    for raw_line in raw_text.splitlines():
        parsed = extract_labeled_value(raw_line)
        if not parsed:
            continue
        key, value = parsed
        if key == "\u63CF\u8FF0":
            return value
    return normalize_text(raw_text)


def parse_chapter_text(raw_text: str, chapter_number: int, source_path: Path) -> dict[str, Any]:
    lines = [normalize_text(line) for line in raw_text.splitlines() if normalize_text(line)]
    if not lines:
        raise ValueError(f"{source_path.name} is empty.")

    title = ""
    location = ""
    time = ""
    characters: list[str] = []
    location_shifts: list[str] = []
    script_lines: list[str] = []

    title_match = re.match(r"^\u5C0F\u8282\s*(\d+)\s*[\uFF1A:]\s*(.+)$", lines[0])
    if title_match:
        title = title_match.group(2).strip()
    else:
        title = lines[0]

    for line in lines[1:]:
        parsed = extract_labeled_value(line)
        if not parsed:
            script_lines.append(line)
            continue

        key, value = parsed
        if key == "\u5730\u70B9":
            location = value
            continue
        if key == "\u65F6\u95F4":
            time = value
            continue
        if key == "\u4EBA\u7269":
            characters = extract_character_names(value)
            continue
        if key == "\u5207\u6362\u5730\u70B9":
            location_shifts.append(value)
            script_lines.append(line)
            continue

        script_lines.append(line)

    return {
        "chapterNumber": chapter_number,
        "chapterTitle": title,
        "location": location,
        "time": time,
        "characters": characters,
        "locationShifts": location_shifts,
        "scriptLines": script_lines,
        "rawText": "\n".join(lines),
        "sourcePath": str(source_path),
    }


def load_character_assets(
    test_root: Path = DEFAULT_TEST_ROOT,
) -> dict[str, dict[str, Any]]:
    character_root = test_root / "character"
    output: dict[str, dict[str, Any]] = {}

    for directory in sorted(character_root.iterdir(), key=lambda item: item.name):
        if not directory.is_dir():
            continue

        image_path = next((path for path in sorted(directory.iterdir()) if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}), None)
        if image_path is None:
            raise FileNotFoundError(f"No reference image found in {directory}")

        text_path = next((path for path in sorted(directory.iterdir()) if path.suffix.lower() == ".txt"), None)
        description_text = normalize_text(text_path.read_text(encoding="utf-8")) if text_path else ""
        normalized_name = normalize_lookup_key(directory.name)

        output[normalized_name] = {
            "name": normalize_text(directory.name),
            "imagePath": str(image_path),
            "imageDataUrl": path_to_data_url(image_path),
            "descriptionText": description_text,
            "appearance": extract_description_body(description_text),
        }

    return output


def load_scene_assets(
    test_root: Path = DEFAULT_TEST_ROOT,
) -> dict[str, dict[str, Any]]:
    scene_root = test_root / "scene"
    output: dict[str, dict[str, Any]] = {}

    for directory in sorted(scene_root.iterdir(), key=lambda item: item.name):
        if not directory.is_dir():
            continue

        image_path = next((path for path in sorted(directory.iterdir()) if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}), None)
        if image_path is None:
            raise FileNotFoundError(f"No scene image found in {directory}")

        normalized_name = normalize_lookup_key(directory.name)
        output[normalized_name] = {
            "name": normalize_text(directory.name),
            "imagePath": str(image_path),
            "imageDataUrl": path_to_data_url(image_path),
            "description": f"{normalize_text(directory.name)} environment reference",
        }

    return output


def resolve_character_asset(
    character_name: str,
    character_assets: dict[str, dict[str, Any]],
    character_aliases: dict[str, str] | None = None,
) -> dict[str, Any]:
    aliases = character_aliases or DEFAULT_CHARACTER_ALIASES
    normalized_name = normalize_lookup_key(character_name)
    direct = character_assets.get(normalized_name)
    if direct:
        return direct

    alias_target = aliases.get(normalize_text(character_name))
    if alias_target:
        aliased = character_assets.get(normalize_lookup_key(alias_target))
        if aliased:
            return aliased

    known = ", ".join(sorted(asset["name"] for asset in character_assets.values()))
    raise KeyError(f"Missing character asset for {character_name}. Available assets: {known}")


def resolve_scene_asset(
    location_name: str,
    scene_assets: dict[str, dict[str, Any]],
    scene_aliases: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    aliases = scene_aliases or {}
    normalized_name = normalize_lookup_key(location_name)
    direct = scene_assets.get(normalized_name)
    if direct:
        return direct

    alias_target = aliases.get(normalize_text(location_name))
    if alias_target:
        return scene_assets.get(normalize_lookup_key(alias_target))

    return None


def build_reference_images_for_chapter(
    chapter: dict[str, Any],
    character_assets: dict[str, dict[str, Any]],
    scene_assets: dict[str, dict[str, Any]],
    character_aliases: dict[str, str] | None = None,
    scene_aliases: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []

    for character_name in chapter["characters"]:
        asset = resolve_character_asset(character_name, character_assets, character_aliases)
        references.append(
            {
                "role": "character",
                "name": asset["name"],
                "appearance": asset["appearance"],
                "description": asset["descriptionText"],
                "imageUrl": asset["imageDataUrl"],
            }
        )

    for location_name in [chapter["location"], *chapter["locationShifts"]]:
        if not location_name:
            continue
        scene_asset = resolve_scene_asset(location_name, scene_assets, scene_aliases)
        if scene_asset:
            references.append(
                {
                    "role": "scene",
                    "name": scene_asset["name"],
                    "description": scene_asset["description"],
                    "imageUrl": scene_asset["imageDataUrl"],
                }
            )
            break

    return references


def build_story_prompt_for_chapter(chapter: dict[str, Any]) -> str:
    lines = [
        "Adapt this source chapter into exactly one full comic page with 5 panels.",
        f"Chapter {chapter['chapterNumber']}: {chapter['chapterTitle']}",
    ]

    if chapter["location"]:
        lines.append(f"Primary location: {chapter['location']}")
    if chapter["locationShifts"]:
        lines.append(f"Location shifts inside this page: {', '.join(chapter['locationShifts'])}")
    if chapter["time"]:
        lines.append(f"Time: {chapter['time']}")
    if chapter["characters"]:
        lines.append(f"Characters appearing on this page: {', '.join(chapter['characters'])}")

    lines.extend(
        [
            "Keep the narrative readable within one page.",
            "Pick the strongest beats from the chapter so the page has a clear beginning, middle, and end.",
            "Preserve key dialogue and emotional turns, but shorten wording when needed for comic readability.",
            "Source chapter:",
            chapter["rawText"],
        ]
    )

    return "\n".join(lines)


def build_story_memory_summary(previous_chapters: list[dict[str, Any]]) -> str:
    if not previous_chapters:
        return ""

    summary_lines: list[str] = []
    for chapter in previous_chapters:
        key_beats = " ".join(chapter["scriptLines"][:2]).strip()
        if len(key_beats) > 140:
            key_beats = f"{key_beats[:137]}..."
        summary_lines.append(
            f"Chapter {chapter['chapterNumber']} {chapter['chapterTitle']} @ {chapter['location'] or 'unknown location'}: {key_beats}"
        )

    return " | ".join(summary_lines)


def build_project_description(chapters: list[dict[str, Any]]) -> str:
    chapter_titles = " / ".join(f"{chapter['chapterNumber']}.{chapter['chapterTitle']}" for chapter in chapters)
    description = f"Eight-page comic adaptation of {chapter_titles}."
    return description if len(description) <= 200 else f"{description[:197]}..."


def load_test_story_assets(
    test_root: Path = DEFAULT_TEST_ROOT,
    chapter_text_overrides: dict[int, str] | None = None,
) -> dict[str, Any]:
    overrides = chapter_text_overrides or {}
    chapters: list[dict[str, Any]] = []

    for chapter_path in sorted((test_root / "plot").glob("chapter*.txt"), key=lambda path: int(re.search(r"(\d+)", path.stem).group(1))):
        chapter_number = int(re.search(r"(\d+)", chapter_path.stem).group(1))
        raw_text = chapter_path.read_text(encoding="utf-8")
        normalized_text = normalize_text(raw_text) or normalize_text(overrides.get(chapter_number, ""))
        if not normalized_text:
            raise ValueError(f"{chapter_path.name} is empty. Fill the file or provide chapter_text_overrides[{chapter_number}].")
        chapters.append(parse_chapter_text(normalized_text, chapter_number, chapter_path))

    return {
        "chapters": chapters,
        "characterAssets": load_character_assets(test_root),
        "sceneAssets": load_scene_assets(test_root),
    }


def get_json(path: str, api_base_url: str = DEFAULT_API_BASE_URL, timeout: int = 60) -> Any:
    response = requests.get(f"{api_base_url}{path}", timeout=timeout)
    response.raise_for_status()
    return response.json()


def post_json(path: str, payload: dict[str, Any], api_base_url: str = DEFAULT_API_BASE_URL, timeout: int = 600) -> Any:
    response = requests.post(f"{api_base_url}{path}", json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()


def build_story_overview_html(story_assets: dict[str, Any]) -> str:
    rows = []
    for chapter in story_assets["chapters"]:
        rows.append(
            "<tr>"
            f"<td>{chapter['chapterNumber']}</td>"
            f"<td>{html.escape(chapter['chapterTitle'])}</td>"
            f"<td>{html.escape(chapter['location'])}</td>"
            f"<td>{html.escape(', '.join(chapter['characters']))}</td>"
            f"<td>{html.escape(', '.join(chapter['locationShifts']))}</td>"
            "</tr>"
        )

    return (
        "<table>"
        "<thead><tr><th>Chapter</th><th>Title</th><th>Location</th><th>Characters</th><th>Location Shift</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table>"
    )


def generate_test_story_project(
    *,
    story_assets: dict[str, Any],
    api_base_url: str = DEFAULT_API_BASE_URL,
    project_title: str,
    project_description: str | None = None,
    style_id: str = "manga",
    image_profile_id: str = "mock-image",
    runtime_image_model_config: dict[str, Any] | None = None,
    negative_prompt: str = "",
    allow_fallback: bool = True,
    metadata_text_profile_id: str = "mock-text",
    metadata_locale: str = "zh-CN",
    character_aliases: dict[str, str] | None = None,
    scene_aliases: dict[str, str] | None = None,
    create_timeout: int = 600,
    append_timeout: int = 600,
    verbose: bool = True,
) -> dict[str, Any]:
    chapters = story_assets["chapters"]
    character_assets = story_assets["characterAssets"]
    scene_assets = story_assets["sceneAssets"]
    description = project_description or build_project_description(chapters)
    total_pages = len(chapters)

    first_chapter = chapters[0]
    if verbose:
        print(
            f"[1/{total_pages}] Generating page 1 from chapter {first_chapter['chapterNumber']}: "
            f"{first_chapter['chapterTitle']}"
        )
    create_payload = {
        "title": project_title,
        "description": description,
        "generateMetadata": False,
        "metadataLocale": metadata_locale,
        "metadataTextProfileId": metadata_text_profile_id,
        "storyPrompt": build_story_prompt_for_chapter(first_chapter),
        "styleId": style_id,
        "referenceImages": build_reference_images_for_chapter(
            first_chapter,
            character_assets,
            scene_assets,
            character_aliases=character_aliases,
            scene_aliases=scene_aliases,
        ),
        "negativePrompt": negative_prompt,
        "allowFallback": allow_fallback,
        "imageProfileId": image_profile_id,
        "runtimeImageModelConfig": runtime_image_model_config or {},
    }

    created = post_json("/api/comics/projects", create_payload, api_base_url=api_base_url, timeout=create_timeout)
    comic_id = created["project"]["comicId"]
    page_results = [created["page"]]
    if verbose:
        print(
            f"[1/{total_pages}] Done. pageNumber={created['page']['pageNumber']} "
            f"provider={created['page']['provider']}"
        )

    for index, chapter in enumerate(chapters[1:], start=1):
        if verbose:
            print(
                f"[{index + 1}/{total_pages}] Generating page {index + 1} from chapter "
                f"{chapter['chapterNumber']}: {chapter['chapterTitle']}"
            )
        append_payload = {
            "storyPrompt": build_story_prompt_for_chapter(chapter),
            "storyMemorySummary": build_story_memory_summary(chapters[:index]),
            "referenceImages": build_reference_images_for_chapter(
                chapter,
                character_assets,
                scene_assets,
                character_aliases=character_aliases,
                scene_aliases=scene_aliases,
            ),
            "negativePrompt": negative_prompt,
            "allowFallback": allow_fallback,
            "imageProfileId": image_profile_id,
            "runtimeImageModelConfig": runtime_image_model_config or {},
        }
        appended = post_json(
            f"/api/comics/projects/{comic_id}/pages",
            append_payload,
            api_base_url=api_base_url,
            timeout=append_timeout,
        )
        page_results.append(appended["page"])
        if verbose:
            print(
                f"[{index + 1}/{total_pages}] Done. pageNumber={appended['page']['pageNumber']} "
                f"provider={appended['page']['provider']}"
            )

    project = get_json(f"/api/comics/projects/{comic_id}", api_base_url=api_base_url)
    if verbose:
        print(f"Finished comic generation: comicId={comic_id}, totalPages={project['pageCount']}")
    return {
        "comicId": comic_id,
        "project": project,
        "pageResults": page_results,
        "storyAssets": story_assets,
    }


def build_generated_comic_html(project: dict[str, Any], api_base_url: str = DEFAULT_API_BASE_URL, max_width: int = 420) -> str:
    cards = []
    for page in sorted(project["pages"], key=lambda item: item["pageNumber"]):
        image_src = f"{api_base_url}{page['image']['apiPath']}"
        cards.append(
            "<div style='margin-bottom: 24px;'>"
            f"<h3>Page {page['pageNumber']}</h3>"
            f"<div><img src='{html.escape(image_src, quote=True)}' style='max-width:{max_width}px; width:100%; border:1px solid #ddd;' /></div>"
            f"<p style='max-width:{max_width}px; white-space:pre-wrap;'>{html.escape(page['storyPrompt'])}</p>"
            "</div>"
        )

    return "".join(cards)


def dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)
