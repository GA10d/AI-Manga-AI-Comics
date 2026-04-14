# Multi-Model Comic Workflow

[README EN](./README.md) | [SHOWCASE ZH](./SHOWCASE.zh-CN.md) | [SHOWCASE EN](./SHOWCASE.md)

这是一个从 `AI_TRPG_616 / version 3.0` 现有业务实现中拆出来的独立漫画生成工作流项目。

它保留了最关键的能力：

- 稳定的 5 格整页漫画工作流
- 可切换的画风 preset
- 角色参考图支持
- 通过上一页和长程摘要维持续页 continuity
- 多模型文生图支持：`Gemini / OpenAI GPT Image / Doubao Seedream / mock`
- 本地漫画项目持久化
- Prompt 全量外置，方便后续继续调参

如果你更想看适合 GitHub 首页展示的版本，可以直接看 [SHOWCASE.zh-CN.md](./SHOWCASE.zh-CN.md)。

## 目录结构

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

## 快速开始

1. 准备环境变量

```powershell
Copy-Item .env.example .env
```

2. 按需填写 `.env`

- 至少配置一组图片模型：
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
  - `DOUBAO_API_KEY` 或 `ARK_API_KEY`
- 如果你只想先验证流程，可以直接使用 `mock-image`

3. 启动服务

```powershell
npm.cmd run dev
```

默认地址：

```text
http://127.0.0.1:4316
```

## 主要 API

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

## 最小请求示例

### 生成单页漫画

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

### 创建本地漫画项目

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

## 示例脚本

### 创建并续一部本地漫画项目

```powershell
python examples/create_local_project.py
```

### 跑六模型漫画 workflow benchmark

```powershell
python examples/benchmark_six_models.py
```

它会复用同一套漫画 workflow prompt，对比：

- `gpt-image-1.5`
- `gpt-image-1-mini`
- `gemini-3-pro-image-preview`
- `gemini-3.1-flash-image-preview`
- `doubao-seedream-5-0-260128`
- `doubao-seedream-5-0-lite-260128`

## 当前内置画风

- `american-modern`
- `manga`
- `noir`
- `vintage`

定义文件：

- [style_presets.json](./prompts/comic_generation_workflow/style_presets.json)

## Prompt 文件

- [page_generation_system_prompt.txt](./prompts/comic_generation_workflow/page_generation_system_prompt.txt)
- [continuation_context_template.txt](./prompts/comic_generation_workflow/continuation_context_template.txt)
- [character_reference_rules.txt](./prompts/comic_generation_workflow/character_reference_rules.txt)
- [title_description_prompt.txt](./prompts/comic_generation_workflow/title_description_prompt.txt)
- [prompt_templates.json](./prompts/image_generation/prompt_templates.json)

## 本地持久化

生成项目后会落盘到：

```text
local_data/comics/
```

每本漫画一个目录，包含：

- `comic.json`
- `pages/`
- `references/`
- `manifest.json`

## 发布建议

这个目录已经尽量整理成可独立发布的小项目。

如果你准备直接发 GitHub，建议再补两件事：

- 增加明确的开源许可证
- 根据你准备公开的内容，再检查一遍 `.env.example` 和 README 文案
