# Multi-Model Comic Workflow Showcase

[SHOWCASE EN](./SHOWCASE.md) | [README ZH](./README.zh-CN.md) | [README EN](./README.md)

这个目录是我们从现有业务实现里拆出来的独立漫画生成子项目。

目标很明确：

- 保留 `make-comics` 工作流里最有效的部分
- 把 prompt 资源显式外置，而不是埋在代码里
- 让同一条 workflow 可以切换多个图片模型
- 稳定产出可续页、可持久化的整页漫画

## 这个项目重点强调什么

### 1. 兼容性

同一条漫画工作流现在可以切这些图片 provider：

- `mock-image`
- `gemini-image`
- `chatgpt-image`
- `doubao-image`

元数据文本生成也可以切这些 provider：

- `mock-text`
- `openai-text`
- `deepseek-text`
- `gemini-text`
- `doubao-text`
- `custom-openai-compatible`

### 2. 稳定 workflow，而不是一次性的 prompt 技巧

这个项目不是只写一句“画一张漫画”。

它固定了：

- 5 格漫画页布局
- 画风 preset
- 角色参考图规则
- 上一页和长程摘要 continuity
- 标题与简介生成
- 本地漫画项目持久化

也就是说，切模型时变的是模型，不变的是业务工作流。

### 3. Prompt 已经抽离

关键 prompt 都在：

- `prompts/comic_generation_workflow/`
- `prompts/image_generation/`

后续维护者如果要改风格、改版式、改 continuity 规则，不需要先去拆业务代码。

## 如何使用

### 启动服务

```powershell
Copy-Item .env.example .env
npm.cmd run dev
```

### 创建漫画项目

```powershell
python examples/create_local_project.py
```

### 跑六模型对比

```powershell
python examples/benchmark_six_models.py
```

## 核心 Prompt

### 整页漫画系统 prompt

```text
Professional comic book page illustration.

{continuation_context}
{character_reference_rules}

CHARACTER CONSISTENCY RULES (HIGHEST PRIORITY):
- If reference images are provided, the characters' faces must stay visually consistent with the reference images.
- Never casually change hair color, eye color, facial structure, or distinctive features.
- Apply comic style to body pose, costume rendering, and action staging while preserving identity.
- The same recurring character should look like the same person across all panels.

TEXT AND LETTERING (CRITICAL):
- All text in speech bubbles must be clear, legible, and correctly spelled.
- Use bold, clean comic-book lettering that is large enough to read.
- Speech bubbles should use a crisp white fill, solid dark outline, and a clear tail pointing to the speaker.
- Keep dialogue short. Prefer one short sentence per bubble and no more than two short sentences.
- Avoid blurry, warped, distorted, mirrored, or unreadable text.

PAGE LAYOUT:
Create one full comic page with 5 panels arranged as:
[Panel 1] [Panel 2]  top row, 2 equal panels
[    Panel 3      ]  middle row, 1 large cinematic hero panel
[Panel 4] [Panel 5]  bottom row, 2 equal panels
- Use solid panel borders with clean gutters between panels.
- Make each panel clearly separated and readable as a comic page.

ART STYLE:
{style_prompt}

COMPOSITION:
- Vary camera distance across panels: close-up, medium shot, and wide shot.
- Preserve left-to-right, top-to-bottom visual reading flow.
- Use expressive character acting and clear action silhouettes.
- Backgrounds should support the setting and mood without overwhelming readability.

STORY:
{user_story_prompt}
```

### 续页模板

```text
STORY CONTINUATION CONTEXT:
This is page {page_number} of an existing comic story.

Recent page prompts:
{recent_page_prompts}

Story memory summary:
{story_memory_summary}

Continuation requirements:
- Continue the same characters, setting, and narrative direction.
- Reuse important visual motifs from earlier pages when appropriate.
- Build naturally on the previous events instead of restarting the scene.
- If a previous page image is available, preserve visual continuity with it.
```

### 角色参考图规则

```text
SINGLE CHARACTER REFERENCE RULES:
- Use the uploaded reference image as the exact identity reference for the protagonist.
- Match core facial traits as closely as the model allows: eyes, nose, mouth, hairline, face shape, skin tone.
- Keep the same character recognizable in every panel.
- Apply the selected comic style to rendering, pose, action, and costume details without losing identity.

DUAL CHARACTER REFERENCE RULES:
- Treat the first uploaded image as Character 1's identity reference.
- Treat the second uploaded image as Character 2's identity reference.
- Keep both characters visually distinct and individually stable.
- When the scene allows, show both characters together in most panels.
- Do not merge, swap, or drift their facial identities.
```

### 标题与简介 prompt

```text
Based on the comic story prompt below, generate:
1. A compelling comic title within 60 characters.
2. A short comic description in 2 to 3 sentences within 200 characters.

Story prompt:
"{user_story_prompt}"

Selected style:
{style_name}

Return JSON only:
{
  "title": "Title here",
  "description": "Description here"
}
```

### 当前 style presets

```json
{
  "styles": [
    { "id": "american-modern", "name": "American Modern" },
    { "id": "manga", "name": "Manga" },
    { "id": "noir", "name": "Noir" },
    { "id": "vintage", "name": "Vintage" }
  ]
}
```

## 示例成图

### Google fast 验证页

![Google fast comic](./assets/showcase/google-fast-comic.jpg)

### Google pro 验证页

![Google pro comic](./assets/showcase/google-pro-comic.jpg)

### Phase 6 OpenAI standard

![Phase6 OpenAI standard](./assets/showcase/phase6-openai-standard.jpg)

### Phase 6 Gemini fast

![Phase6 Gemini fast](./assets/showcase/phase6-gemini-fast.jpg)

### Phase 6 Doubao standard

![Phase6 Doubao standard](./assets/showcase/phase6-doubao-standard.jpg)

## Phase 6 六模型对比图

这张图在同一套漫画 workflow 下完成：

- 相同 `storyPrompt`
- 相同 `styleId`
- 相同 continuity 约束
- 相同整页漫画流程

只切换模型：

- OpenAI standard
- OpenAI fast
- Gemini standard
- Gemini fast
- Doubao standard
- Doubao fast

![Phase6 model comparison](./assets/showcase/phase6-model-comparison-grid.png)

## 为什么这份展示有价值

- 它不是单模型 demo，而是同一条 workflow 跨模型复用
- Prompt 不是藏在代码里，而是已经对维护者透明
- 它不是只做单张插图，而是支持整页漫画、续页和本地持久化
- 它既能继续服务内部业务，也适合单独抽出来开源
