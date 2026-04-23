import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  AppendPersistedComicPageRequest,
  ComicMetadataGenerationRequest,
  ComicMetadataGenerationResponse,
  ComicPageGenerationRequest,
  ComicPageGenerationResponse,
  ComicProjectSummary,
  ComicPromptPresetResponse,
  ComicReferenceImageInput,
  CreatePersistedComicRequest,
  ImageGenerationRequest,
  ImageReferenceInput
} from "../types.ts";
import { generateImage } from "../image_generation/service.ts";
import { generateText } from "../text_generation/service.ts";
import {
  buildComicMetadataPrompt,
  buildComicPagePrompt,
  loadComicPromptPresets
} from "./prompt.ts";
import {
  createComicId,
  deleteComicProjectFromDisk,
  listComicProjectsFromDisk,
  loadComicProjectFromDisk,
  saveComicAssetToDisk,
  writeComicProjectToDisk
} from "./storage.ts";

const PASS_THROUGH_IMAGE_PROMPT_TEMPLATE_CONFIG: ImageGenerationRequest["promptTemplateConfig"] = {
  version: 1,
  defaultTheme: "comic",
  defaultTrigger: "manual",
  fallbackTriggerTemplate: "{basePrompt}",
  themes: {
    comic: ""
  },
  triggerTemplates: {
    manual: "{basePrompt}",
    character_portrait: "{basePrompt}",
    npc_intro: "{basePrompt}",
    scene_shift: "{basePrompt}"
  },
  characterClauseTemplate: "{joinedCharacters}",
  characterJoinSeparator: ", ",
  characterEntryTemplate: "{name}({appearance})"
};
const MAX_CHARACTER_REFERENCE_IMAGES = 3;
const MAX_SCENE_REFERENCE_IMAGES = 1;

function compactWhitespace(input: string): string {
  return input.replace(/\s+/gu, " ").trim();
}

function buildSceneId(request: ComicPageGenerationRequest, pageNumber: number): string {
  const requestedSceneId = compactWhitespace(request.sceneId ?? "");
  if (requestedSceneId.length > 0) {
    return requestedSceneId;
  }

  const basis = JSON.stringify({
    storyPrompt: request.storyPrompt,
    styleId: request.styleId,
    pageNumber,
    previousPages: request.previousPages?.map((item) => ({
      pageNumber: item.pageNumber,
      prompt: item.prompt,
      summary: item.summary
    })) ?? []
  });

  const digest = createHash("sha1").update(basis).digest("hex").slice(0, 12);
  return `comic-page-${pageNumber}-${digest}`;
}

function appendUniqueReferenceImage(
  bucket: ImageReferenceInput[],
  seenUrls: Set<string>,
  imageUrl: string,
  role: ImageReferenceInput["role"],
  label?: string
): void {
  const cleanUrl = compactWhitespace(imageUrl);
  if (!cleanUrl || seenUrls.has(cleanUrl)) {
    return;
  }

  seenUrls.add(cleanUrl);
  bucket.push({
    imageUrl: cleanUrl,
    role,
    label: compactWhitespace(label ?? "")
  });
}

function splitReferenceImages(referenceImages: ComicReferenceImageInput[] | undefined): {
  characterReferences: ComicReferenceImageInput[];
  sceneReferences: ComicReferenceImageInput[];
} {
  const normalized = (referenceImages ?? []).filter((item) => compactWhitespace(item.imageUrl).length > 0);

  return {
    characterReferences: normalized
      .filter((item) => (item.role ?? "character") === "character")
      .slice(0, MAX_CHARACTER_REFERENCE_IMAGES),
    sceneReferences: normalized
      .filter((item) => item.role === "scene")
      .slice(0, MAX_SCENE_REFERENCE_IMAGES)
  };
}

function collectReferenceImages(request: ComicPageGenerationRequest): ImageReferenceInput[] {
  const output: ImageReferenceInput[] = [];
  const seenUrls = new Set<string>();
  const previousPages = [...(request.previousPages ?? [])].sort((left, right) => left.pageNumber - right.pageNumber);
  const latestPreviousPage = previousPages.at(-1);
  const { characterReferences, sceneReferences } = splitReferenceImages(request.referenceImages);

  for (const item of characterReferences) {
    appendUniqueReferenceImage(output, seenUrls, item.imageUrl, "character", item.name);
  }

  for (const item of sceneReferences) {
    appendUniqueReferenceImage(output, seenUrls, item.imageUrl, "scene", item.name);
  }

  if (latestPreviousPage?.imageUrl) {
    appendUniqueReferenceImage(
      output,
      seenUrls,
      latestPreviousPage.imageUrl,
      "previous_page",
      `Page ${latestPreviousPage.pageNumber}`
    );
  }

  return output;
}

function buildFallbackTitle(storyPrompt: string): string {
  const compact = compactWhitespace(storyPrompt);
  if (!compact) {
    return "Untitled Comic";
  }
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
}

function buildFallbackDescription(storyPrompt: string, styleName: string): string {
  const compact = compactWhitespace(storyPrompt);
  const description = compact ? `${styleName} comic adaptation of: ${compact}` : `${styleName} comic concept.`;
  return description.length > 200 ? `${description.slice(0, 197)}...` : description;
}

function parseMetadataJson(rawText: string): { title: string; description: string } | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/u);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { title?: unknown; description?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (!title && !description) {
      return null;
    }
    return { title, description };
  } catch {
    return null;
  }
}

function buildFallbackMetadata(storyPrompt: string, styleName: string): { title: string; description: string } {
  const title = buildFallbackTitle(storyPrompt);
  return {
    title,
    description: buildFallbackDescription(storyPrompt, styleName)
  };
}

async function fileToDataUrl(storagePath: string, mimeType: string | null): Promise<string> {
  const bytes = await readFile(storagePath);
  return `data:${mimeType ?? "image/png"};base64,${bytes.toString("base64")}`;
}

function selectDefaultProjectReferences(
  project: Awaited<ReturnType<typeof loadComicProjectFromDisk>>
) {
  const latestPage = [...project.pages].sort((left, right) => left.pageNumber - right.pageNumber).at(-1);
  const latestReferenceIds = new Set([
    ...(latestPage?.characterReferenceIds ?? []),
    ...(latestPage?.sceneReferenceIds ?? [])
  ]);

  if (latestReferenceIds.size > 0) {
    const selected = project.references.filter((item) => latestReferenceIds.has(item.referenceId));
    if (selected.length > 0) {
      return selected;
    }
  }

  return [
    ...project.references.filter((item) => item.role === "character").slice(0, MAX_CHARACTER_REFERENCE_IMAGES),
    ...project.references.filter((item) => item.role === "scene").slice(0, MAX_SCENE_REFERENCE_IMAGES)
  ];
}

async function buildPersistedReferenceInputs(
  project: Awaited<ReturnType<typeof loadComicProjectFromDisk>>
): Promise<ComicReferenceImageInput[]> {
  const references = selectDefaultProjectReferences(project);
  const output: ComicReferenceImageInput[] = [];

  for (const item of references) {
    output.push({
      role: item.role,
      name: item.name ?? undefined,
      appearance: item.appearance ?? undefined,
      description: item.description ?? undefined,
      imageUrl: await fileToDataUrl(item.image.storagePath, item.image.mimeType)
    });
  }

  return output;
}

function buildDefaultProjectReferenceIds(
  project: Awaited<ReturnType<typeof loadComicProjectFromDisk>>
): {
  characterReferenceIds: string[];
  sceneReferenceIds: string[];
} {
  const references = selectDefaultProjectReferences(project);
  return {
    characterReferenceIds: references.filter((item) => item.role === "character").map((item) => item.referenceId),
    sceneReferenceIds: references.filter((item) => item.role === "scene").map((item) => item.referenceId)
  };
}

function findMatchingPersistedReference(
  project: Awaited<ReturnType<typeof loadComicProjectFromDisk>>,
  reference: ComicReferenceImageInput
) {
  const role = reference.role === "scene" ? "scene" : "character";
  const normalizedName = compactWhitespace(reference.name ?? "");
  const normalizedSourceUrl = reference.imageUrl.startsWith("data:")
    ? ""
    : compactWhitespace(reference.imageUrl);

  return project.references.find((item) => {
    if (item.role !== role) {
      return false;
    }

    const existingName = compactWhitespace(item.name ?? "");
    if (normalizedName && existingName) {
      return existingName === normalizedName;
    }

    const existingSourceUrl = compactWhitespace(item.sourceUrl ?? "");
    return normalizedSourceUrl.length > 0 && existingSourceUrl === normalizedSourceUrl;
  });
}

async function ensurePersistedReferenceSelection(args: {
  comicRoot: string;
  comicId: string;
  project: Awaited<ReturnType<typeof loadComicProjectFromDisk>> | { references: Awaited<ReturnType<typeof loadComicProjectFromDisk>>["references"] };
  referenceImages: ComicReferenceImageInput[];
  now: string;
}): Promise<{
  nextReferences: Awaited<ReturnType<typeof loadComicProjectFromDisk>>["references"];
  characterReferenceIds: string[];
  sceneReferenceIds: string[];
}> {
  const nextReferences = [...args.project.references];
  const characterReferenceIds: string[] = [];
  const sceneReferenceIds: string[] = [];
  const { characterReferences, sceneReferences } = splitReferenceImages(args.referenceImages);

  for (const reference of [...characterReferences, ...sceneReferences]) {
    const existing = findMatchingPersistedReference(
      { references: nextReferences } as Awaited<ReturnType<typeof loadComicProjectFromDisk>>,
      reference
    );
    const role = reference.role === "scene" ? "scene" : "character";

    if (existing) {
      if (role === "scene") {
        sceneReferenceIds.push(existing.referenceId);
      } else {
        characterReferenceIds.push(existing.referenceId);
      }
      continue;
    }

    const image = await saveComicAssetToDisk({
      comicRoot: args.comicRoot,
      comicId: args.comicId,
      folderName: "references",
      fileNameStem: `ref-${role}-${nextReferences.filter((item) => item.role === role).length + 1}-${reference.name || role}`,
      sourceUrl: reference.imageUrl
    });

    const persistedReference = {
      referenceId: `ref_${randomUUID().slice(0, 8)}`,
      role,
      name: compactWhitespace(reference.name ?? "") || null,
      appearance: compactWhitespace(reference.appearance ?? "") || null,
      description: compactWhitespace(reference.description ?? "") || null,
      sourceUrl: reference.imageUrl.startsWith("data:") ? null : reference.imageUrl,
      createdAt: args.now,
      image
    };

    nextReferences.push(persistedReference);
    if (role === "scene") {
      sceneReferenceIds.push(persistedReference.referenceId);
    } else {
      characterReferenceIds.push(persistedReference.referenceId);
    }
  }

  return {
    nextReferences,
    characterReferenceIds,
    sceneReferenceIds
  };
}

async function buildPersistedPreviousPages(project: Awaited<ReturnType<typeof loadComicProjectFromDisk>>): Promise<ComicPageGenerationRequest["previousPages"]> {
  const sortedPages = [...project.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const latestPageNumber = sortedPages.at(-1)?.pageNumber ?? null;
  const output: NonNullable<ComicPageGenerationRequest["previousPages"]> = [];

  for (const item of sortedPages) {
    output.push({
      pageNumber: item.pageNumber,
      prompt: item.storyPrompt,
      imageUrl:
        item.pageNumber === latestPageNumber
          ? await fileToDataUrl(item.image.storagePath, item.image.mimeType)
          : undefined
    });
  }

  return output;
}

async function resolveComicTitleAndDescription(
  request: CreatePersistedComicRequest
): Promise<{ title: string; description: string }> {
  const cleanTitle = compactWhitespace(request.title ?? "");
  const cleanDescription = compactWhitespace(request.description ?? "");

  if (cleanTitle && cleanDescription) {
    return { title: cleanTitle, description: cleanDescription };
  }

  if (request.generateMetadata === false) {
    const style = (await buildComicPagePrompt(request)).style;
    return {
      title: cleanTitle || buildFallbackTitle(request.storyPrompt),
      description: cleanDescription || buildFallbackDescription(request.storyPrompt, style.name)
    };
  }

  try {
    const metadata = await generateComicMetadata({
      storyPrompt: request.storyPrompt,
      styleId: request.styleId,
      locale: request.metadataLocale ?? "zh-CN",
      textProfileId: request.metadataTextProfileId ?? "mock-text",
      runtimeTextModelConfig: request.metadataRuntimeTextModelConfig
    });

    return {
      title: cleanTitle || metadata.title,
      description: cleanDescription || metadata.description
    };
  } catch {
    const style = (await buildComicPagePrompt(request)).style;
    const fallback = buildFallbackMetadata(request.storyPrompt, style.name);
    return {
      title: cleanTitle || fallback.title,
      description: cleanDescription || fallback.description
    };
  }
}

export async function listComicPromptPresets(): Promise<ComicPromptPresetResponse> {
  return loadComicPromptPresets();
}

export async function generateComicPage(request: ComicPageGenerationRequest): Promise<ComicPageGenerationResponse> {
  const promptBundle = await buildComicPagePrompt(request);
  const referenceImages = collectReferenceImages(request);
  const characterReferenceCount = referenceImages.filter((item) => (item.role ?? "character") === "character").length;
  const sceneReferenceCount = referenceImages.filter((item) => item.role === "scene").length;
  const previousPageReferenceCount = referenceImages.filter((item) => item.role === "previous_page").length;
  const sceneId = buildSceneId(request, promptBundle.pageNumber);

  const imageResult = await generateImage({
    prompt: promptBundle.prompt,
    trigger: "manual",
    theme: "comic",
    sceneId,
    referenceImages,
    negativePrompt: request.negativePrompt,
    allowFallback: request.allowFallback,
    imageProfileId: request.imageProfileId,
    runtimeImageModelConfig: request.runtimeImageModelConfig,
    promptTemplateConfig: PASS_THROUGH_IMAGE_PROMPT_TEMPLATE_CONFIG
  });

  return {
    ...imageResult,
    style: promptBundle.style,
    pageNumber: promptBundle.pageNumber,
    continuationContext: promptBundle.continuationContext,
    characterReferenceCount,
    sceneReferenceCount,
    previousPageReferenceCount
  };
}

export async function generateComicMetadata(
  request: ComicMetadataGenerationRequest
): Promise<ComicMetadataGenerationResponse> {
  const { prompt, style } = await buildComicMetadataPrompt(request);

  if (!request.textProfileId || request.textProfileId === "mock-text") {
    const title = buildFallbackTitle(request.storyPrompt);
    const description = buildFallbackDescription(request.storyPrompt, style.name);
    return {
      title,
      description,
      rawText: JSON.stringify({ title, description }, null, 2),
      provider: "mock-text",
      meta: {
        provider: "mock-text",
        model: "mock-text",
        durationMs: 0,
        estimatedCost: {
          amount: 0,
          currency: "USD",
          pricingModel: "mock-local",
          note: "Mock mode returns deterministic comic metadata."
        },
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null
        }
      },
      style
    };
  }

  const textResult = await generateText({
    textProfileId: request.textProfileId,
    runtimeTextModelConfig: request.runtimeTextModelConfig,
    systemPrompt: [
      "You generate concise comic metadata.",
      `Return the title and description in ${request.locale ?? "zh-CN"}.`,
      "Return valid JSON only."
    ].join("\n"),
    userPrompt: prompt
  });

  const parsed = parseMetadataJson(textResult.text);
  const title = parsed?.title || buildFallbackTitle(request.storyPrompt);
  const description = parsed?.description || buildFallbackDescription(request.storyPrompt, style.name);

  return {
    title: title.length > 60 ? `${title.slice(0, 57)}...` : title,
    description: description.length > 200 ? `${description.slice(0, 197)}...` : description,
    rawText: textResult.text,
    provider: textResult.provider,
    meta: textResult.meta,
    style
  };
}

export async function listPersistedComicProjects(comicRoot: string): Promise<ComicProjectSummary[]> {
  return listComicProjectsFromDisk(comicRoot);
}

export async function loadPersistedComicProject(comicRoot: string, comicId: string) {
  return loadComicProjectFromDisk(comicRoot, comicId);
}

export async function deletePersistedComicProject(comicRoot: string, comicId: string): Promise<boolean> {
  return deleteComicProjectFromDisk(comicRoot, comicId);
}

export async function createPersistedComicProject(comicRoot: string, request: CreatePersistedComicRequest) {
  const now = new Date().toISOString();
  const promptBundle = await buildComicPagePrompt(request);
  const comicId = await createComicId(request.title || request.storyPrompt, now);
  const titleAndDescription = await resolveComicTitleAndDescription(request);
  const generatedPage = await generateComicPage(request);
  const persistedReferenceSelection = await ensurePersistedReferenceSelection({
    comicRoot,
    comicId,
    project: { references: [] },
    referenceImages: request.referenceImages ?? [],
    now
  });

  const pageId = `page_${randomUUID().slice(0, 8)}`;
  const persistedImage = await saveComicAssetToDisk({
    comicRoot,
    comicId,
    folderName: "pages",
    fileNameStem: `page-${String(generatedPage.pageNumber).padStart(3, "0")}-${pageId}`,
    sourceUrl: generatedPage.imageUrl
  });

  const project = await writeComicProjectToDisk(comicRoot, {
    comicId,
    createdAt: now,
    updatedAt: now,
    title: titleAndDescription.title,
    description: titleAndDescription.description,
    storyPrompt: request.storyPrompt.trim(),
    style: promptBundle.style,
    pageCount: 1,
    storageRoot: "",
    coverImage: persistedImage,
    references: persistedReferenceSelection.nextReferences,
    pages: [
      {
        pageId,
        pageNumber: generatedPage.pageNumber,
        storyPrompt: request.storyPrompt.trim(),
        revisedPrompt: generatedPage.revisedPrompt,
        continuationContext: generatedPage.continuationContext,
        negativePrompt: compactWhitespace(request.negativePrompt ?? "") || null,
        provider: generatedPage.provider,
        createdAt: now,
        style: generatedPage.style,
        image: persistedImage,
        characterReferenceIds: persistedReferenceSelection.characterReferenceIds,
        sceneReferenceIds: persistedReferenceSelection.sceneReferenceIds,
        previousPageNumber: null
      }
    ]
  });

  return {
    project,
    page: project.pages[0]
  };
}

export async function appendPersistedComicPage(
  comicRoot: string,
  comicId: string,
  request: AppendPersistedComicPageRequest
) {
  const project = await loadComicProjectFromDisk(comicRoot, comicId);
  const now = new Date().toISOString();
  const requestReferenceImages =
    (request.referenceImages?.length ?? 0) > 0
      ? request.referenceImages!
      : await buildPersistedReferenceInputs(project);
  const persistedReferenceSelection =
    (request.referenceImages?.length ?? 0) > 0
      ? await ensurePersistedReferenceSelection({
          comicRoot,
          comicId,
          project,
          referenceImages: requestReferenceImages,
          now
        })
      : {
          nextReferences: [...project.references],
          ...buildDefaultProjectReferenceIds(project)
        };
  const previousPages = await buildPersistedPreviousPages(project);

  const generatedPage = await generateComicPage({
    storyPrompt: request.storyPrompt,
    styleId: project.style.id,
    pageNumber: project.pageCount + 1,
    storyMemorySummary: request.storyMemorySummary,
    previousPages,
    referenceImages: requestReferenceImages,
    negativePrompt: request.negativePrompt,
    allowFallback: request.allowFallback,
    imageProfileId: request.imageProfileId,
    runtimeImageModelConfig: request.runtimeImageModelConfig
  });

  const pageId = `page_${randomUUID().slice(0, 8)}`;
  const persistedImage = await saveComicAssetToDisk({
    comicRoot,
    comicId,
    folderName: "pages",
    fileNameStem: `page-${String(generatedPage.pageNumber).padStart(3, "0")}-${pageId}`,
    sourceUrl: generatedPage.imageUrl
  });

  const nextProject = await writeComicProjectToDisk(comicRoot, {
    ...project,
    updatedAt: now,
    pageCount: project.pageCount + 1,
    references: persistedReferenceSelection.nextReferences,
    pages: [
      ...project.pages,
      {
        pageId,
        pageNumber: generatedPage.pageNumber,
        storyPrompt: request.storyPrompt.trim(),
        revisedPrompt: generatedPage.revisedPrompt,
        continuationContext: generatedPage.continuationContext,
        negativePrompt: compactWhitespace(request.negativePrompt ?? "") || null,
        provider: generatedPage.provider,
        createdAt: now,
        style: generatedPage.style,
        image: persistedImage,
        characterReferenceIds: persistedReferenceSelection.characterReferenceIds,
        sceneReferenceIds: persistedReferenceSelection.sceneReferenceIds,
        previousPageNumber: project.pages.at(-1)?.pageNumber ?? null
      }
    ]
  });

  return {
    project: nextProject,
    page: nextProject.pages.at(-1)!
  };
}
