import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ComicMetadataGenerationRequest,
  ComicPageGenerationRequest,
  ComicPreviousPageInput,
  ComicReferenceImageInput,
  ComicPromptPresetResponse,
  ComicStylePreset
} from "../types.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../..");
const promptRoot = join(projectRoot, "prompts", "comic_generation_workflow");

const promptFileCache = new Map<string, string>();
let stylePresetCache: ComicStylePreset[] | null = null;

const DEFAULT_STYLE_ID = "noir";
const MAX_RECENT_PAGE_CONTEXT_CHARS = 6000;
const MAX_MEMORY_SUMMARY_CHARS = 1800;

function compactWhitespace(input: string): string {
  return input.replace(/\s+/gu, " ").trim();
}

function fillTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (output, [key, value]) => output.replaceAll(`{${key}}`, value),
    template
  );
}

async function loadPromptFile(fileName: string): Promise<string> {
  const cached = promptFileCache.get(fileName);
  if (cached) {
    return cached;
  }

  const value = (await readFile(join(promptRoot, fileName), "utf8")).trim();
  promptFileCache.set(fileName, value);
  return value;
}

type RawStylePresetFile = {
  styles?: Array<{
    id?: string;
    name?: string;
    prompt?: string;
  }>;
};

async function loadStylePresets(): Promise<ComicStylePreset[]> {
  if (stylePresetCache) {
    return stylePresetCache;
  }

  const rawText = await readFile(join(promptRoot, "style_presets.json"), "utf8");
  const raw = JSON.parse(rawText) as RawStylePresetFile;
  const normalized = (raw.styles ?? [])
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      prompt: typeof item.prompt === "string" ? item.prompt.trim() : ""
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0 && item.prompt.length > 0);

  if (normalized.length === 0) {
    throw new Error("No comic style presets were found.");
  }

  stylePresetCache = normalized;
  return normalized;
}

export async function resolveComicStylePreset(styleId?: string): Promise<ComicStylePreset> {
  const presets = await loadStylePresets();
  const requestedId = styleId?.trim();
  if (requestedId) {
    const matched = presets.find((item) => item.id === requestedId);
    if (matched) {
      return matched;
    }
  }

  return presets.find((item) => item.id === DEFAULT_STYLE_ID) ?? presets[0];
}

function getNextPageNumber(request: ComicPageGenerationRequest): number {
  if (typeof request.pageNumber === "number" && Number.isFinite(request.pageNumber)) {
    return Math.max(1, Math.floor(request.pageNumber));
  }

  const previousPages = request.previousPages ?? [];
  if (previousPages.length === 0) {
    return 1;
  }

  return (
    Math.max(
      ...previousPages.map((item) =>
        Number.isFinite(item.pageNumber) ? Math.floor(item.pageNumber) : 0
      )
    ) + 1
  );
}

function selectRecentPages(previousPages: ComicPreviousPageInput[]): {
  selectedPages: ComicPreviousPageInput[];
  omittedPages: ComicPreviousPageInput[];
} {
  const sortedPages = [...previousPages]
    .filter((item) => compactWhitespace(item.prompt).length > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);

  const selectedPages: ComicPreviousPageInput[] = [];
  let currentLength = 0;

  for (let index = sortedPages.length - 1; index >= 0; index -= 1) {
    const page = sortedPages[index];
    const line = `Page ${page.pageNumber}: ${compactWhitespace(page.prompt)}`;
    const additionalLength = line.length + 1;

    if (selectedPages.length > 0 && currentLength + additionalLength > MAX_RECENT_PAGE_CONTEXT_CHARS) {
      break;
    }

    selectedPages.unshift(page);
    currentLength += additionalLength;
  }

  const omittedCount = Math.max(0, sortedPages.length - selectedPages.length);
  return {
    selectedPages,
    omittedPages: sortedPages.slice(0, omittedCount)
  };
}

function buildDerivedStoryMemorySummary(
  previousPages: ComicPreviousPageInput[],
  providedSummary: string | undefined
): string {
  const cleanProvidedSummary = compactWhitespace(providedSummary ?? "");
  if (cleanProvidedSummary.length > 0) {
    return cleanProvidedSummary;
  }

  if (previousPages.length === 0) {
    return "No separate long-range summary was provided. Continue directly from the recent page prompts.";
  }

  const summaryLines: string[] = [];
  let usedChars = 0;

  for (const page of previousPages) {
    const basis = compactWhitespace(page.summary?.trim() || page.prompt);
    if (!basis) {
      continue;
    }

    const shortened = basis.length > 220 ? `${basis.slice(0, 217)}...` : basis;
    const line = `Page ${page.pageNumber}: ${shortened}`;
    const additionalLength = line.length + 1;

    if (summaryLines.length > 0 && usedChars + additionalLength > MAX_MEMORY_SUMMARY_CHARS) {
      break;
    }

    summaryLines.push(line);
    usedChars += additionalLength;
  }

  return summaryLines.length > 0
    ? summaryLines.join(" ")
    : "No separate long-range summary was provided. Continue directly from the recent page prompts.";
}

async function buildContinuationContext(
  request: ComicPageGenerationRequest,
  pageNumber: number
): Promise<string | null> {
  const previousPages = request.previousPages ?? [];
  const hasStoryMemorySummary = compactWhitespace(request.storyMemorySummary ?? "").length > 0;

  if (previousPages.length === 0 && !hasStoryMemorySummary) {
    return null;
  }

  const template = await loadPromptFile("continuation_context_template.txt");
  const { selectedPages, omittedPages } = selectRecentPages(previousPages);
  const recentPagePrompts =
    selectedPages.length > 0
      ? selectedPages
          .map((item) => `Page ${item.pageNumber}: ${compactWhitespace(item.prompt)}`)
          .join("\n")
      : "No recent page prompts were supplied.";
  const storyMemorySummary = buildDerivedStoryMemorySummary(omittedPages, request.storyMemorySummary);

  return fillTemplate(template, {
    page_number: String(pageNumber),
    recent_page_prompts: recentPagePrompts,
    story_memory_summary: storyMemorySummary
  }).trim();
}

function buildCharacterReferenceDescriptor(reference: ComicReferenceImageInput, index: number): string {
  const name = compactWhitespace(reference.name ?? "");
  const appearance = compactWhitespace(reference.appearance ?? "");
  const label = name.length > 0 ? `${name}` : `Character ${index + 1}`;

  if (appearance.length > 0) {
    return `- ${label}: ${appearance}`;
  }

  return `- ${label}: no extra appearance text supplied, so use the image itself as the primary identity reference.`;
}

async function buildCharacterReferenceRules(
  referenceImages: ComicReferenceImageInput[] | undefined
): Promise<string> {
  const characterReferences = (referenceImages ?? [])
    .filter((item) => (item.role ?? "character") === "character")
    .filter((item) => compactWhitespace(item.imageUrl).length > 0)
    .slice(0, 2);

  if (characterReferences.length === 0) {
    return "";
  }

  const baseRules = await loadPromptFile("character_reference_rules.txt");
  const roleSpecificRules =
    characterReferences.length === 1
      ? [
          "PROJECT-SPECIFIC ENFORCEMENT:",
          "- Use the uploaded image as the protagonist identity reference.",
          "- Keep this same face and visual identity stable across all 5 panels."
        ]
      : [
          "PROJECT-SPECIFIC ENFORCEMENT:",
          "- Treat the first uploaded image as Character 1's identity reference.",
          "- Treat the second uploaded image as Character 2's identity reference.",
          "- Keep both characters visually distinct and individually stable."
        ];
  const descriptorLines = characterReferences.map(buildCharacterReferenceDescriptor);

  return [baseRules, "", "SELECTED REFERENCE CHARACTERS:", ...descriptorLines, "", ...roleSpecificRules].join("\n");
}

export async function buildComicPagePrompt(
  request: ComicPageGenerationRequest
): Promise<{
  prompt: string;
  style: ComicStylePreset;
  pageNumber: number;
  continuationContext: string | null;
}> {
  const storyPrompt = request.storyPrompt.trim();
  if (!storyPrompt) {
    throw new Error("Comic story prompt is required.");
  }

  const style = await resolveComicStylePreset(request.styleId);
  const pageNumber = getNextPageNumber(request);
  const [pageTemplate, continuationContext, characterReferenceRules] = await Promise.all([
    loadPromptFile("page_generation_system_prompt.txt"),
    buildContinuationContext(request, pageNumber),
    buildCharacterReferenceRules(request.referenceImages)
  ]);

  return {
    prompt: fillTemplate(pageTemplate, {
      continuation_context: continuationContext ?? "",
      character_reference_rules: characterReferenceRules,
      style_prompt: style.prompt,
      user_story_prompt: storyPrompt
    }).trim(),
    style,
    pageNumber,
    continuationContext
  };
}

export async function buildComicMetadataPrompt(
  request: ComicMetadataGenerationRequest
): Promise<{
  prompt: string;
  style: ComicStylePreset;
}> {
  const storyPrompt = request.storyPrompt.trim();
  if (!storyPrompt) {
    throw new Error("Comic story prompt is required.");
  }

  const [template, style] = await Promise.all([
    loadPromptFile("title_description_prompt.txt"),
    resolveComicStylePreset(request.styleId)
  ]);

  return {
    prompt: fillTemplate(template, {
      user_story_prompt: storyPrompt,
      style_name: style.name
    }).trim(),
    style
  };
}

export async function loadComicPromptPresets(): Promise<ComicPromptPresetResponse> {
  return {
    styles: await loadStylePresets(),
    pageLayout: "5-panel comic page: 2 top panels, 1 large center panel, 2 bottom panels."
  };
}
