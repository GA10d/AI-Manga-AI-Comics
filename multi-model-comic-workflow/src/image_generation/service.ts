import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ImageCharacterReference,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageReferenceInput,
  ImagePromptTemplateConfig,
  RuntimeImageModelConfigInput
} from "../types.ts";
import { getImageProviderConfig } from "./config.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../..");
const imagePromptConfigPath = join(
  projectRoot,
  "prompts",
  "image_generation",
  "prompt_templates.json"
);

let cachedPromptTemplateConfig: ImagePromptTemplateConfig | null = null;

function ensureRecordOfStrings(value: unknown, fieldName: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${fieldName}.${key} must be a string.`);
    }
    output[key] = item;
  }

  return output;
}

function normalizePromptTemplateConfig(rawValue: unknown): ImagePromptTemplateConfig {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
    throw new Error("Image prompt template config must be an object.");
  }

  const data = rawValue as Record<string, unknown>;
  const triggerTemplates = ensureRecordOfStrings(data.triggerTemplates, "triggerTemplates");
  const themes = ensureRecordOfStrings(data.themes, "themes");

  return {
    version: typeof data.version === "number" && Number.isFinite(data.version) ? data.version : 1,
    defaultTheme:
      typeof data.defaultTheme === "string" && data.defaultTheme.trim().length > 0
        ? data.defaultTheme.trim()
        : "comic",
    defaultTrigger:
      data.defaultTrigger === "character_portrait" ||
      data.defaultTrigger === "npc_intro" ||
      data.defaultTrigger === "scene_shift"
        ? data.defaultTrigger
        : "manual",
    fallbackTriggerTemplate:
      typeof data.fallbackTriggerTemplate === "string" && data.fallbackTriggerTemplate.trim().length > 0
        ? data.fallbackTriggerTemplate.trim()
        : "{basePrompt}",
    themes,
    triggerTemplates: {
      manual: triggerTemplates.manual ?? "{basePrompt}",
      character_portrait: triggerTemplates.character_portrait ?? "{basePrompt}",
      npc_intro: triggerTemplates.npc_intro ?? "{basePrompt}",
      scene_shift: triggerTemplates.scene_shift ?? "{basePrompt}"
    },
    characterClauseTemplate:
      typeof data.characterClauseTemplate === "string"
        ? data.characterClauseTemplate
        : "Keep recurring character consistency: {joinedCharacters}.",
    characterJoinSeparator:
      typeof data.characterJoinSeparator === "string" ? data.characterJoinSeparator : "; ",
    characterEntryTemplate:
      typeof data.characterEntryTemplate === "string"
        ? data.characterEntryTemplate
        : "{name}({appearance})"
  };
}

export async function loadImagePromptTemplateConfig(): Promise<ImagePromptTemplateConfig> {
  if (cachedPromptTemplateConfig) {
    return cachedPromptTemplateConfig;
  }

  const raw = await readFile(imagePromptConfigPath, "utf8");
  cachedPromptTemplateConfig = normalizePromptTemplateConfig(JSON.parse(raw));
  return cachedPromptTemplateConfig;
}

function buildCastClause(
  characters: ImageCharacterReference[] | undefined,
  promptTemplateConfig: ImagePromptTemplateConfig
): string {
  const normalizedCharacters = (characters ?? [])
    .map((item) => ({
      name: item.name.trim(),
      appearance: item.appearance.trim()
    }))
    .filter((item) => item.name.length > 0 && item.appearance.length > 0)
    .slice(0, 4);

  if (normalizedCharacters.length === 0) {
    return "";
  }

  const joinedCharacters = normalizedCharacters
    .map((item) =>
      promptTemplateConfig.characterEntryTemplate
        .replace("{name}", item.name)
        .replace("{appearance}", item.appearance)
    )
    .join(promptTemplateConfig.characterJoinSeparator);

  return promptTemplateConfig.characterClauseTemplate.replace("{joinedCharacters}", joinedCharacters);
}

function buildFinalPrompt(
  request: ImageGenerationRequest,
  promptTemplateConfig: ImagePromptTemplateConfig
): string {
  const resolvedTheme = request.theme?.trim() || promptTemplateConfig.defaultTheme;
  const themeStyle =
    promptTemplateConfig.themes[resolvedTheme] ??
    promptTemplateConfig.themes[promptTemplateConfig.defaultTheme] ??
    "";
  const triggerTemplate =
    promptTemplateConfig.triggerTemplates[request.trigger] ??
    promptTemplateConfig.fallbackTriggerTemplate;
  const castClause = buildCastClause(request.characters, promptTemplateConfig);
  const negativePrompt = request.negativePrompt?.trim() ?? "";

  const finalPrompt = triggerTemplate
    .replaceAll("{basePrompt}", request.prompt.trim())
    .replaceAll("{castClause}", castClause)
    .replaceAll("{themeStyle}", themeStyle)
    .replace(/\s+/gu, " ")
    .trim();

  return negativePrompt ? `${finalPrompt}\nAvoid the following: ${negativePrompt}` : finalPrompt;
}

function buildMockSvg(prompt: string, theme: string): string {
  const palettes: Record<string, { bg: string; fg: string; accent: string }> = {
    comic: { bg: "#efe4c8", fg: "#3f2d18", accent: "#8f6a37" },
    manga: { bg: "#f7f7f7", fg: "#111111", accent: "#666666" },
    noir: { bg: "#0f172a", fg: "#f8fafc", accent: "#334155" }
  };
  const palette = palettes[theme] ?? palettes.comic;
  const lines = prompt.slice(0, 180).match(/.{1,42}(?:\s|$)/gu) ?? [prompt.slice(0, 42)];

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0.65" />
    </linearGradient>
  </defs>
  <rect width="768" height="1024" fill="url(#bg)" />
  <circle cx="384" cy="304" r="156" fill="${palette.fg}" fill-opacity="0.12" />
  <rect x="172" y="462" width="424" height="354" rx="36" fill="${palette.fg}" fill-opacity="0.1" />
  <text x="72" y="108" fill="${palette.fg}" font-family="Georgia, serif" font-size="40">COMIC WORKFLOW</text>
  <text x="72" y="166" fill="${palette.fg}" font-family="Georgia, serif" font-size="20">Mock preview</text>
  ${lines
    .map(
      (line, index) =>
        `<text x="72" y="${904 + index * 30}" fill="${palette.fg}" font-family="Georgia, serif" font-size="22">${line
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</text>`
    )
    .join("")}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function buildCacheKey(request: ImageGenerationRequest, finalPrompt: string, model: string | null): string {
  const hash = createHash("sha1");
  hash.update(
    JSON.stringify({
      sceneId: request.sceneId,
      trigger: request.trigger,
      theme: request.theme,
      prompt: finalPrompt,
      model,
      characters: request.characters ?? []
    })
  );

  for (const reference of request.referenceImages ?? []) {
    hash.update(reference.imageUrl);
    hash.update(reference.role ?? "");
    hash.update(reference.label ?? "");
  }

  return hash.digest("hex");
}

type ResolvedReferenceImage = {
  mimeType: string;
  base64Data: string;
};

type GeneratedImagePayload = {
  imageUrl: string;
  mimeType: string;
  revisedPrompt?: string | null;
};

function parseDataUrl(url: string): ResolvedReferenceImage | null {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/u);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64Data: match[2]
  };
}

async function resolveReferenceImage(imageUrl: string): Promise<ResolvedReferenceImage> {
  const inlineData = parseDataUrl(imageUrl);
  if (inlineData) {
    return inlineData;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to load reference image: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType,
    base64Data: buffer.toString("base64")
  };
}

function toDataUrl(mimeType: string, base64Data: string): string {
  return `data:${mimeType};base64,${base64Data}`;
}

function inferMimeTypeFromOutputFormat(outputFormat: string | undefined): string {
  switch (outputFormat?.trim().toLowerCase()) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function pickRuntimeImageString(
  runtimeImageModelConfig: RuntimeImageModelConfigInput | undefined,
  key: keyof RuntimeImageModelConfigInput
): string | undefined {
  const rawValue = runtimeImageModelConfig?.[key];
  return typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : undefined;
}

function pickRuntimeImageNumber(
  runtimeImageModelConfig: RuntimeImageModelConfigInput | undefined,
  key: keyof RuntimeImageModelConfigInput
): number | undefined {
  const rawValue = runtimeImageModelConfig?.[key];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : undefined;
}

function pickRuntimeImageBoolean(
  runtimeImageModelConfig: RuntimeImageModelConfigInput | undefined,
  key: keyof RuntimeImageModelConfigInput
): boolean | undefined {
  const rawValue = runtimeImageModelConfig?.[key];
  return typeof rawValue === "boolean" ? rawValue : undefined;
}

async function readResponseData(response: Response): Promise<unknown> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return { rawText };
  }
}

function extractErrorMessage(data: unknown, fallbackMessage: string): string {
  if (typeof data === "object" && data !== null) {
    const payload = data as { error?: { message?: string } | string; message?: string };
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error.trim();
    }
    if (typeof payload.error?.message === "string" && payload.error.message.trim().length > 0) {
      return payload.error.message.trim();
    }
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
  }

  return fallbackMessage;
}

type OpenAiCompatibleImageResponse = {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
};

async function extractOpenAiCompatibleImage(
  data: unknown,
  fallbackOutputFormat: string | undefined
): Promise<GeneratedImagePayload | null> {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = data as OpenAiCompatibleImageResponse;
  const firstImage = payload.data?.[0];
  if (!firstImage) {
    return null;
  }

  if (typeof firstImage.b64_json === "string" && firstImage.b64_json.length > 0) {
    const mimeType = inferMimeTypeFromOutputFormat(fallbackOutputFormat);
    return {
      imageUrl: toDataUrl(mimeType, firstImage.b64_json),
      mimeType,
      revisedPrompt: firstImage.revised_prompt ?? null
    };
  }

  if (typeof firstImage.url === "string" && firstImage.url.length > 0) {
    const resolved = await resolveReferenceImage(firstImage.url);
    return {
      imageUrl: toDataUrl(resolved.mimeType, resolved.base64Data),
      mimeType: resolved.mimeType,
      revisedPrompt: firstImage.revised_prompt ?? null
    };
  }

  return null;
}

async function generateOpenAiImage(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageSize?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
}): Promise<GeneratedImagePayload> {
  const requestBody: Record<string, unknown> = {
    model: args.model,
    prompt: args.prompt
  };

  if (args.imageSize) {
    requestBody.size = args.imageSize;
  }
  if (args.quality) {
    requestBody.quality = args.quality;
  }
  if (args.background) {
    requestBody.background = args.background;
  }
  if (args.outputFormat) {
    requestBody.output_format = args.outputFormat;
  }
  if (typeof args.outputCompression === "number") {
    requestBody.output_compression = args.outputCompression;
  }

  const endpointBase = args.baseUrl.replace(/\/+$/u, "");
  const endpointCandidates = [`${endpointBase}/images/generations`, `${endpointBase}/images`];

  let lastResponse: Response | null = null;
  let lastData: unknown = null;

  for (const endpoint of endpointCandidates) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await readResponseData(response);
    if (response.ok) {
      const image = await extractOpenAiCompatibleImage(data, args.outputFormat);
      if (!image) {
        throw new Error("OpenAI image request returned no image data.");
      }

      return image;
    }

    lastResponse = response;
    lastData = data;
    if (response.status !== 404 && response.status !== 405) {
      break;
    }
  }

  throw new Error(
    extractErrorMessage(lastData, `OpenAI image request failed with HTTP ${lastResponse?.status ?? 500}.`)
  );
}

async function generateDoubaoImage(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageSize?: string;
  watermark?: boolean;
}): Promise<GeneratedImagePayload> {
  const requestBody: Record<string, unknown> = {
    model: args.model,
    prompt: args.prompt,
    response_format: "url"
  };

  if (args.imageSize) {
    requestBody.size = args.imageSize;
  }
  requestBody.watermark = args.watermark ?? false;

  const response = await fetch(`${args.baseUrl.replace(/\/+$/u, "")}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const data = await readResponseData(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Doubao image request failed with HTTP ${response.status}.`));
  }

  const image = await extractOpenAiCompatibleImage(data, "png");
  if (!image) {
    throw new Error("Doubao image request returned no image data.");
  }

  return image;
}

async function buildGeminiParts(
  prompt: string,
  referenceImages: ImageReferenceInput[] | undefined
): Promise<Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  const normalizedReferences = (referenceImages ?? [])
    .map((item) => ({
      imageUrl: item.imageUrl.trim(),
      role: item.role ?? "character"
    }))
    .filter((item) => item.imageUrl.length > 0)
    .slice(0, 4);

  for (const reference of normalizedReferences) {
    const resolved = await resolveReferenceImage(reference.imageUrl);
    parts.push({
      inlineData: {
        mimeType: resolved.mimeType,
        data: resolved.base64Data
      }
    });
  }

  return parts;
}

function extractGeminiImage(data: unknown): { bytes: Buffer; mimeType: string } | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = data as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };

  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData;
      if (inlineData?.data) {
        return {
          bytes: Buffer.from(inlineData.data, "base64"),
          mimeType: inlineData.mimeType ?? "image/png"
        };
      }
    }
  }

  return null;
}

async function generateGeminiImage(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  referenceImages?: ImageReferenceInput[];
  imageSize?: string;
  aspectRatio?: string;
}): Promise<{ imageUrl: string; mimeType: string }> {
  const parts = await buildGeminiParts(args.prompt, args.referenceImages);
  const generationConfig: {
    responseModalities: string[];
    imageConfig?: { imageSize?: string; aspectRatio?: string };
  } = { responseModalities: ["TEXT", "IMAGE"] };

  if (args.imageSize || args.aspectRatio) {
    generationConfig.imageConfig = {};
    if (args.imageSize) {
      generationConfig.imageConfig.imageSize = args.imageSize;
    }
    if (args.aspectRatio) {
      generationConfig.imageConfig.aspectRatio = args.aspectRatio;
    }
  }

  const response = await fetch(
    `${args.baseUrl.replace(/\/+$/u, "")}/models/${args.model}:generateContent?key=${encodeURIComponent(args.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig
      })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message =
      typeof data?.error?.message === "string"
        ? data.error.message
        : `Gemini image request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const image = extractGeminiImage(data);
  if (!image) {
    throw new Error("Gemini image request returned no image data.");
  }

  return {
    imageUrl: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
    mimeType: image.mimeType
  };
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const basePrompt = request.prompt.trim();
  if (!basePrompt) {
    throw new Error("Image prompt is required.");
  }

  const promptTemplateConfig = request.promptTemplateConfig
    ? normalizePromptTemplateConfig(request.promptTemplateConfig)
    : await loadImagePromptTemplateConfig();
  const finalPrompt = buildFinalPrompt(request, promptTemplateConfig);
  const providerConfig = getImageProviderConfig({
    imageProfileId: request.imageProfileId,
    runtimeImageModelConfig: request.runtimeImageModelConfig
  });
  const cacheKey = buildCacheKey(request, finalPrompt, providerConfig.model);

  try {
    if (providerConfig.dependence === "Google" && providerConfig.baseUrl && providerConfig.apiKey && providerConfig.model) {
      const generated = await generateGeminiImage({
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        model: providerConfig.model,
        prompt: finalPrompt,
        referenceImages: providerConfig.features.reference_image.supported ? request.referenceImages : undefined,
        imageSize: pickRuntimeImageString(request.runtimeImageModelConfig, "imageSize"),
        aspectRatio: pickRuntimeImageString(request.runtimeImageModelConfig, "aspectRatio")
      });

      return {
        imageUrl: generated.imageUrl,
        revisedPrompt: finalPrompt,
        provider: `${providerConfig.providerLabel}:${providerConfig.model}`,
        cached: false,
        mimeType: generated.mimeType,
        outputPath: null
      };
    }

    if (providerConfig.dependence === "OpenAI" && providerConfig.baseUrl && providerConfig.apiKey && providerConfig.model) {
      const generated =
        providerConfig.profileId === "doubao-image"
          ? await generateDoubaoImage({
              baseUrl: providerConfig.baseUrl,
              apiKey: providerConfig.apiKey,
              model: providerConfig.model,
              prompt: finalPrompt,
              imageSize: pickRuntimeImageString(request.runtimeImageModelConfig, "imageSize"),
              watermark: pickRuntimeImageBoolean(request.runtimeImageModelConfig, "watermark")
            })
          : await generateOpenAiImage({
              baseUrl: providerConfig.baseUrl,
              apiKey: providerConfig.apiKey,
              model: providerConfig.model,
              prompt: finalPrompt,
              imageSize: pickRuntimeImageString(request.runtimeImageModelConfig, "imageSize"),
              quality: pickRuntimeImageString(request.runtimeImageModelConfig, "quality"),
              background: pickRuntimeImageString(request.runtimeImageModelConfig, "background"),
              outputFormat: pickRuntimeImageString(request.runtimeImageModelConfig, "outputFormat"),
              outputCompression: pickRuntimeImageNumber(request.runtimeImageModelConfig, "outputCompression")
            });

      return {
        imageUrl: generated.imageUrl,
        revisedPrompt: generated.revisedPrompt?.trim() || finalPrompt,
        provider: `${providerConfig.providerLabel}:${providerConfig.model}`,
        cached: false,
        mimeType: generated.mimeType,
        outputPath: null
      };
    }
  } catch (error) {
    if (request.allowFallback === false) {
      throw error;
    }
  }

  const fallbackTheme = request.theme?.trim() || promptTemplateConfig.defaultTheme;
  return {
    imageUrl: buildMockSvg(finalPrompt, fallbackTheme),
    revisedPrompt: finalPrompt,
    provider: providerConfig.dependence === "Mock" ? "image:mock" : `${providerConfig.providerLabel}:fallback`,
    cached: cacheKey.length > 0 ? false : false,
    mimeType: "image/svg+xml",
    outputPath: null
  };
}
