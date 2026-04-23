import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  ComicProjectSummary,
  PersistedComicAsset,
  PersistedComicProject
} from "../types.ts";

const MANIFEST_FILE_NAME = "manifest.json";
const COMIC_FILE_NAME = "comic.json";

type ComicManifest = {
  version: 1;
  comics: ComicProjectSummary[];
};

function sanitizeFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "comic";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function sanitizeAssetStem(value: string): string {
  return sanitizeFragment(value).slice(0, 64) || "asset";
}

function buildAssetApiPath(comicId: string, relativePath: string): string {
  const encodedSegments = normalizeRelativePath(relativePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `/api/comic-assets/${encodeURIComponent(comicId)}/${encodedSegments.join("/")}`;
}

function withNormalizedAssetPaths(
  comicRoot: string,
  comicId: string,
  asset: PersistedComicAsset | null | undefined
): PersistedComicAsset | null {
  if (!asset) {
    return null;
  }

  const relativePath = normalizeRelativePath(asset.relativePath);
  return {
    relativePath,
    storagePath: join(comicRoot, comicId, ...relativePath.split("/")),
    apiPath: buildAssetApiPath(comicId, relativePath),
    mimeType: asset.mimeType ?? null
  };
}

function normalizeProject(comicRoot: string, project: PersistedComicProject): PersistedComicProject {
  const comicId = project.comicId;
  const normalizedReferences = project.references.map((reference) => ({
    ...reference,
    image: withNormalizedAssetPaths(comicRoot, comicId, reference.image)!
  }));
  const normalizedPages = project.pages
    .map((page) => ({
      ...page,
      characterReferenceIds: Array.isArray(page.characterReferenceIds) ? page.characterReferenceIds : [],
      sceneReferenceIds: Array.isArray(page.sceneReferenceIds) ? page.sceneReferenceIds : [],
      image: withNormalizedAssetPaths(comicRoot, comicId, page.image)!
    }))
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const coverImage = normalizedPages[0]?.image ?? withNormalizedAssetPaths(comicRoot, comicId, project.coverImage);

  return {
    ...project,
    storageRoot: join(comicRoot, comicId),
    pageCount: normalizedPages.length,
    coverImage: coverImage ?? null,
    references: normalizedReferences,
    pages: normalizedPages
  };
}

function buildSummary(comicRoot: string, project: PersistedComicProject): ComicProjectSummary {
  const normalizedProject = normalizeProject(comicRoot, project);
  return {
    comicId: normalizedProject.comicId,
    title: normalizedProject.title,
    description: normalizedProject.description,
    style: normalizedProject.style,
    pageCount: normalizedProject.pageCount,
    createdAt: normalizedProject.createdAt,
    updatedAt: normalizedProject.updatedAt,
    storagePath: normalizedProject.storageRoot,
    coverImage: normalizedProject.coverImage ?? null
  };
}

function buildComicId(title: string, createdAt: string): string {
  const createdPart = createdAt.replace(/[-:.TZ]/g, "");
  const titlePart = sanitizeFragment(title);
  return `comic_${createdPart}_${titlePart}_${randomUUID().slice(0, 8)}`;
}

function isSafeComicId(comicId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(comicId);
}

function getManifestPath(comicRoot: string): string {
  return join(comicRoot, MANIFEST_FILE_NAME);
}

function getComicDir(comicRoot: string, comicId: string): string {
  if (!isSafeComicId(comicId)) {
    throw new Error(`Invalid comic id: ${comicId}`);
  }

  return join(comicRoot, comicId);
}

function getComicFilePath(comicRoot: string, comicId: string): string {
  return join(getComicDir(comicRoot, comicId), COMIC_FILE_NAME);
}

async function ensureComicRoot(comicRoot: string): Promise<void> {
  await mkdir(comicRoot, { recursive: true });
}

async function readManifest(comicRoot: string): Promise<ComicManifest> {
  await ensureComicRoot(comicRoot);

  try {
    const raw = await readFile(getManifestPath(comicRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<ComicManifest>;
    if (!Array.isArray(parsed.comics)) {
      throw new Error("Invalid comic manifest.");
    }

    return {
      version: 1,
      comics: parsed.comics.map((item) => ({
        ...item,
        storagePath: getComicDir(comicRoot, item.comicId),
        coverImage: withNormalizedAssetPaths(comicRoot, item.comicId, item.coverImage) ?? null
      }))
    };
  } catch {
    return {
      version: 1,
      comics: []
    };
  }
}

async function writeManifest(comicRoot: string, comics: ComicProjectSummary[]): Promise<void> {
  await ensureComicRoot(comicRoot);
  const manifest: ComicManifest = {
    version: 1,
    comics: [...comics].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  };
  await writeFile(getManifestPath(comicRoot), JSON.stringify(manifest, null, 2), "utf8");
}

async function rebuildManifestFromFiles(comicRoot: string): Promise<ComicProjectSummary[]> {
  await ensureComicRoot(comicRoot);
  const entries = await readdir(comicRoot, { withFileTypes: true });
  const summaries: ComicProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const project = await loadComicProjectFromDisk(comicRoot, entry.name);
      summaries.push(buildSummary(comicRoot, project));
    } catch {
      // Skip malformed projects.
    }
  }

  await writeManifest(comicRoot, summaries);
  return summaries;
}

type ResolvedBinaryAsset = {
  bytes: Buffer;
  mimeType: string;
};

function parseDataUrl(sourceUrl: string): ResolvedBinaryAsset | null {
  const match = sourceUrl.match(/^data:([^;,]+);base64,(.+)$/u);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
}

function guessExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

async function resolveBinaryAsset(sourceUrl: string): Promise<ResolvedBinaryAsset> {
  const inline = parseDataUrl(sourceUrl);
  if (inline) {
    return inline;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to load asset: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  return {
    mimeType,
    bytes: Buffer.from(await response.arrayBuffer())
  };
}

export async function createComicId(titleOrPrompt: string, createdAt: string): Promise<string> {
  return buildComicId(titleOrPrompt, createdAt);
}

export async function saveComicAssetToDisk(args: {
  comicRoot: string;
  comicId: string;
  folderName: "pages" | "references";
  fileNameStem: string;
  sourceUrl: string;
}): Promise<PersistedComicAsset> {
  await ensureComicRoot(args.comicRoot);

  const comicDir = getComicDir(args.comicRoot, args.comicId);
  const folderDir = join(comicDir, args.folderName);
  await mkdir(folderDir, { recursive: true });

  const resolved = await resolveBinaryAsset(args.sourceUrl);
  const extension = guessExtension(resolved.mimeType);
  const fileName = `${sanitizeAssetStem(args.fileNameStem)}${extension}`;
  const storagePath = join(folderDir, fileName);
  await writeFile(storagePath, resolved.bytes);

  const relativePath = normalizeRelativePath(`${args.folderName}/${fileName}`);
  return {
    relativePath,
    storagePath,
    apiPath: buildAssetApiPath(args.comicId, relativePath),
    mimeType: resolved.mimeType
  };
}

export async function writeComicProjectToDisk(
  comicRoot: string,
  project: PersistedComicProject
): Promise<PersistedComicProject> {
  await ensureComicRoot(comicRoot);
  const comicDir = getComicDir(comicRoot, project.comicId);
  await mkdir(comicDir, { recursive: true });

  const normalizedProject = normalizeProject(comicRoot, project);
  await writeFile(
    getComicFilePath(comicRoot, normalizedProject.comicId),
    JSON.stringify(normalizedProject, null, 2),
    "utf8"
  );

  const manifest = await readManifest(comicRoot);
  const nextSummary = buildSummary(comicRoot, normalizedProject);
  const nextSummaries = [
    nextSummary,
    ...manifest.comics.filter((item) => item.comicId !== nextSummary.comicId)
  ];
  await writeManifest(comicRoot, nextSummaries);
  return normalizedProject;
}

export async function loadComicProjectFromDisk(
  comicRoot: string,
  comicId: string
): Promise<PersistedComicProject> {
  const filePath = getComicFilePath(comicRoot, comicId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedComicProject;
    return normalizeProject(comicRoot, parsed);
  } catch {
    throw new Error(`Local comic not found: ${comicId}`);
  }
}

export async function listComicProjectsFromDisk(comicRoot: string): Promise<ComicProjectSummary[]> {
  const manifest = await readManifest(comicRoot);
  if (manifest.comics.length > 0) {
    return manifest.comics;
  }

  return rebuildManifestFromFiles(comicRoot);
}

export async function deleteComicProjectFromDisk(comicRoot: string, comicId: string): Promise<boolean> {
  const comicDir = getComicDir(comicRoot, comicId);
  let removed = false;

  try {
    await rm(comicDir, { recursive: true, force: true });
    removed = true;
  } catch {
    removed = false;
  }

  const manifest = await readManifest(comicRoot);
  await writeManifest(
    comicRoot,
    manifest.comics.filter((item) => item.comicId !== comicId)
  );
  return removed;
}

export function resolveComicAssetAbsolutePath(args: {
  comicRoot: string;
  comicId: string;
  relativePath: string;
}): string {
  const comicDir = getComicDir(args.comicRoot, args.comicId);
  const normalizedRelativePath = normalizeRelativePath(args.relativePath);
  const absolutePath = resolve(comicDir, normalizedRelativePath);

  if (!absolutePath.startsWith(resolve(comicDir))) {
    throw new Error("Forbidden comic asset path.");
  }

  return absolutePath;
}
