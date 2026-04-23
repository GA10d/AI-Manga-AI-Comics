# AI-Manga-AI-Comics

[English README](./README.md) | [展示页中文](./SHOWCASE.zh-CN.md) | [Showcase EN](./SHOWCASE.md)

![Phase 6 comparison grid](./multi-model-comic-workflow/assets/showcase/phase6-model-comparison-grid.png)

本仓库是 [AI_TRPG](https://github.com/GA10d/AI_TRPG) 的伴生项目，承接 AI_TRPG 里的漫画生成链路，并将这部分能力整理成可以单独运行、单独调试、单独扩展的子项目。

同时，它也是基于开源 [AI Comic Factory](https://github.com/jbilcke-hf/ai-comic-factory) 持续演化出来的二次开发版本；和只演示“输入一句话生成一页图”的方案不同，这个仓库更强调多页漫画工作流、长程稳定性，以及画风的易扩展性。

English summary: this repo is the comic-generation companion project for AI_TRPG, evolved from AI Comic Factory into a reusable, long-context, multi-page workflow.

## 项目定位

- 它是 `AI_TRPG` 的伴生项目，不是孤立的 demo。
- 它把原本嵌在更大业务流程里的漫画模块拆了出来，方便独立复用。
- 它基于 `AI Comic Factory` 的开源思路继续做工程化二次开发。
- 它服务的重点不是“单次出一张图”，而是“连续多页漫画稳定生成”。

## 这个项目重点解决什么

### 1. 长程稳定性

这个仓库把漫画生成当成一条完整 workflow，而不是一次性的 prompt 技巧。连续性主要通过下面这些机制来维持：

- 固定的 5 格漫画页结构
- 最近几页的直接上下文
- 当上下文变长时，把更早页面压缩成 long-range memory summary
- 角色参考图
- 场景参考图
- 把上一页图像当作视觉锚点
- 将漫画项目、页面和参考图落盘到 `multi-model-comic-workflow/local_data/comics/`

这套设计的意义是：角色更容易保持同一身份，场景更容易维持一致，剧情也更容易沿着同一方向继续推进。

### 2. 画风易扩展

这个项目把“风格”和“规则”从代码里抽出来了。你可以直接改这些文件来扩风格、调工作流，而不需要先去拆业务逻辑：

- [style_presets.json](./multi-model-comic-workflow/prompts/comic_generation_workflow/style_presets.json)
- [page_generation_system_prompt.txt](./multi-model-comic-workflow/prompts/comic_generation_workflow/page_generation_system_prompt.txt)
- [continuation_context_template.txt](./multi-model-comic-workflow/prompts/comic_generation_workflow/continuation_context_template.txt)
- [character_reference_rules.txt](./multi-model-comic-workflow/prompts/comic_generation_workflow/character_reference_rules.txt)
- [scene_reference_rules.txt](./multi-model-comic-workflow/prompts/comic_generation_workflow/scene_reference_rules.txt)
- [prompt_templates.json](./multi-model-comic-workflow/prompts/image_generation/prompt_templates.json)

当前内置的风格包括 `american-modern`、`manga`、`noir`、`vintage`、`color_manga`、`chibi_color_manga` 和 `pop_art`。

#### 画风跨度示例

同一套整页漫画 workflow，不只可以换模型，也可以拉开明显的风格跨度。下面这组例子就分别展示了黑白漫画风格和全彩漫画风格：

| 黑白风格 | 全彩风格 |
| --- | --- |
| ![黑白风格示例](./showcase/black.jpg) | ![全彩风格示例](./showcase/full%20color.jpg) |

### 3. 同一 workflow 复用多模型

这个仓库的重点是“工作流优先，模型其次”。也就是说，页面生成逻辑不需要重写，就可以切不同模型跑同一套流程。

图片模型：

- `mock-image`
- `gemini-image`
- `chatgpt-image`
- `doubao-image`

文本模型：

- `mock-text`
- `openai-text`
- `deepseek-text`
- `gemini-text`
- `doubao-text`
- `custom-openai-compatible`

## 工作流程

1. 从 AI_TRPG 的剧情节点、章节文本或一次事件结果中得到 `storyPrompt`。
2. 选择风格 preset 和图片模型 profile。
3. 如果需要人物一致性，就上传角色参考图；如果需要场景稳定，就上传场景参考图。
4. 系统把固定 5 格页面模板、continuation context 和 reference rules 组合成整页 prompt。
5. 最近几页会直接进入上下文，更早页面会压缩成 long-range memory summary。
6. 用选定的模型生成整页漫画。
7. 把页面、参考图、元数据和 manifest 保存到本地，这样下一页就能继续沿用。

核心实现位于 `multi-model-comic-workflow/`。

## 生图结果展示

下面这几张图使用的是同类剧情设定和同一类整页漫画 workflow。重点不是追求某一张“偶然最好看”的图，而是展示这条流程在不同模型下都能保持连续的页面叙事能力。

| Gemini Standard | OpenAI Standard | Doubao Standard |
| --- | --- | --- |
| ![Gemini Standard](./multi-model-comic-workflow/assets/showcase/phase6-gemini-standard.jpg) | ![OpenAI Standard](./multi-model-comic-workflow/assets/showcase/phase6-openai-standard.jpg) | ![Doubao Standard](./multi-model-comic-workflow/assets/showcase/phase6-doubao-standard.jpg) |

### 六模型对比图

![Phase 6 model comparison](./multi-model-comic-workflow/assets/showcase/phase6-model-comparison-grid.png)

这张图里变化的只有模型本身；workflow、故事设定、页面结构和 continuity 策略都保持一致。这也是本项目最想强调的一点：先把可复用的漫画工作流做稳定，再去替换底层模型。

## 快速开始

环境要求：

- Node.js `>=22.6.0`
- 如果要跑示例脚本，建议 Python `>=3.10`

启动服务：

```powershell
cd multi-model-comic-workflow
Copy-Item .env.example .env
npm.cmd run dev
```

默认地址：

```text
http://127.0.0.1:4316
```

可选示例：

```powershell
cd multi-model-comic-workflow
python -m pip install -r requirements.txt
python examples/create_local_project.py
python examples/benchmark_six_models.py
```

主要接口：

- `GET /api/health`
- `GET /api/comics/presets`
- `POST /api/comics/generate-page`
- `POST /api/comics/generate-metadata`
- `POST /api/comics/projects`
- `POST /api/comics/projects/:comicId/pages`
- `GET /api/comics/projects/:comicId`

## 项目结构

```text
AI-Manga-AI-Comics/
  multi-model-comic-workflow/
    src/
    prompts/
    assets/showcase/
    examples/
    local_data/
    artifacts/
  showcase/
  test/
  README.md
  README.zh-CN.md
```

- `multi-model-comic-workflow/` 是真正可运行的漫画生成工作流。
- `showcase/` 用来放 benchmark 和展示素材。
- `test/` 里有剧情文本、角色参考图和场景参考图等实验素材。

如果你想看更偏 GitHub 展示页风格的版本，可以直接看 [SHOWCASE.zh-CN.md](./SHOWCASE.zh-CN.md)。
