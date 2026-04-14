# Multi-Model Comic Workflow

[README ZH](./README.zh-CN.md) | [SHOWCASE EN](./SHOWCASE.md) | [SHOWCASE ZH](./SHOWCASE.zh-CN.md)

A standalone open-source comic generation workflow extracted from our production implementation in `AI_TRPG_616 / version 3.0`.

This repo keeps the parts that matter most:

- Stable 5-panel comic-page workflow
- Switchable style presets
- Character reference image support
- Story continuation through previous-page context and long-range memory
- Multi-model image generation: `Gemini / OpenAI GPT Image / Doubao Seedream / mock`
- Local comic-project persistence
- Prompts fully externalized for future tuning

If you mainly want the GitHub-facing demo page, go to [SHOWCASE.md](./SHOWCASE.md).

## Project Structure

```text
multi-model-comic-workflow/
  src/
    comic_generation/
    image_generation/
    text_generation/
  prompts/
    comic_generation_workflow/
    image_generation/
  examples/
  assets/showcase/
  local_data/
  artifacts/
```

## Quick Start

1. Prepare environment variables

```powershell
Copy-Item .env.example .env
```

2. Fill in `.env` as needed

- Configure at least one image provider:
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `DOUBAO_API_KEY` or `ARK_API_KEY`
- If you only want to verify the workflow locally, start with `mock-image`

3. Start the server

```powershell
npm.cmd run dev
```

Default URL:

```text
http://127.0.0.1:4316
```

## Main API Routes

- `GET /api/health`
- `GET /api/providers/images`
- `GET /api/providers/text`
- `GET /api/comics/presets`
- `POST /api/comics/generate-page`
- `POST /api/comics/generate-metadata`
- `GET /api/comics/projects`
- `POST /api/comics/projects`
- `GET /api/comics/projects/:comicId`
- `POST /api/comics/projects/:comicId/pages`
- `DELETE /api/comics/projects/:comicId`
- `GET /api/comic-assets/:comicId/...`

## Minimal Request Examples

### Generate One Comic Page

```json
{
  "storyPrompt": "A rookie exorcist enters a flooded subway platform and sees a ghost train arrive.",
  "styleId": "american-modern",
  "storyMemorySummary": "She is tracking missing commuters tied to a vanished subway line.",
  "previousPages": [],
  "referenceImages": [],
  "negativePrompt": "blurry unreadable text duplicated faces bad hands watermark",
  "allowFallback": false,
  "imageProfileId": "gemini-image",
  "runtimeImageModelConfig": {
    "model": "gemini-3.1-flash-image-preview",
    "imageSize": "1K",
    "aspectRatio": "3:4"
  }
}
```

### Create a Local Comic Project

```json
{
  "title": "Ghost Line Incident",
  "storyPrompt": "A rookie exorcist and a retired subway engineer discover a ghost train entering an abandoned station flooded with black water.",
  "styleId": "manga",
  "generateMetadata": true,
  "metadataLocale": "zh-CN",
  "metadataTextProfileId": "mock-text",
  "imageProfileId": "mock-image",
  "allowFallback": true
}
```

## Example Scripts

### Create and append a local comic project

```powershell
python examples/create_local_project.py
```

### Run the six-model comic workflow benchmark

```powershell
python examples/benchmark_six_models.py
```

It reuses the same comic workflow prompt and compares:

- `gpt-image-1.5`
- `gpt-image-1-mini`
- `gemini-3-pro-image-preview`
- `gemini-3.1-flash-image-preview`
- `doubao-seedream-5-0-260128`
- `doubao-seedream-5-0-lite-260128`

## Built-in Style Presets

- `american-modern`
- `manga`
- `noir`
- `vintage`

Definition file:

- [style_presets.json](./prompts/comic_generation_workflow/style_presets.json)

## Prompt Files

- [page_generation_system_prompt.txt](./prompts/comic_generation_workflow/page_generation_system_prompt.txt)
- [continuation_context_template.txt](./prompts/comic_generation_workflow/continuation_context_template.txt)
- [character_reference_rules.txt](./prompts/comic_generation_workflow/character_reference_rules.txt)
- [title_description_prompt.txt](./prompts/comic_generation_workflow/title_description_prompt.txt)
- [prompt_templates.json](./prompts/image_generation/prompt_templates.json)

## Local Persistence

Generated projects are stored under:

```text
local_data/comics/
```

Each comic gets its own directory with:

- `comic.json`
- `pages/`
- `references/`
- `manifest.json`

## Release Notes

This folder is intentionally structured as a standalone repo candidate.

Before publishing to GitHub, I recommend adding:

- a clear open-source license
- a final pass over `.env.example` and README wording based on what you want to expose publicly
