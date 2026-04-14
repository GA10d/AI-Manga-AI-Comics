import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AppendPersistedComicPageRequest,
  ComicMetadataGenerationRequest,
  ComicPageGenerationRequest,
  CreatePersistedComicRequest,
  ImageGenerationRequest
} from "./types.ts";
import {
  appendPersistedComicPage,
  createPersistedComicProject,
  deletePersistedComicProject,
  generateComicMetadata,
  generateComicPage,
  listComicPromptPresets,
  listPersistedComicProjects,
  loadPersistedComicProject
} from "./comic_generation/service.ts";
import { resolveComicAssetAbsolutePath } from "./comic_generation/storage.ts";
import { listImageProfileSummaries } from "./image_generation/config.ts";
import { generateImage, loadImagePromptTemplateConfig } from "./image_generation/service.ts";
import { listTextProfileSummaries } from "./text_generation/config.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "..");
const defaultComicRoot = join(projectRoot, "local_data", "comics");
const port = Number(process.env.PORT ?? 4316);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body) as T;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function applyCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  applyCors(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response: ServerResponse, statusCode: number, content: string): void {
  applyCors(response);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(content);
}

async function serveAbsoluteFile(
  response: ServerResponse,
  absolutePath: string,
  rootDir: string
): Promise<void> {
  if (!absolutePath.startsWith(rootDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  let fileContent: Buffer;
  try {
    fileContent = await readFile(absolutePath);
  } catch {
    sendText(response, 404, "Not Found");
    return;
  }

  const mimeType = mimeTypes[extname(absolutePath)] ?? "application/octet-stream";
  applyCors(response);
  response.writeHead(200, {
    "Content-Type": mimeType
  });
  response.end(fileContent);
}

async function handleApiRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    applyCors(response);
    response.writeHead(204);
    response.end();
    return true;
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, service: "multi-model-comic-workflow" });
    return true;
  }

  if (url.pathname === "/api/providers/images" && request.method === "GET") {
    sendJson(response, 200, listImageProfileSummaries());
    return true;
  }

  if (url.pathname === "/api/providers/text" && request.method === "GET") {
    sendJson(response, 200, listTextProfileSummaries());
    return true;
  }

  if (url.pathname === "/api/prompts/image-template" && request.method === "GET") {
    sendJson(response, 200, await loadImagePromptTemplateConfig());
    return true;
  }

  if (url.pathname === "/api/images/generate" && request.method === "POST") {
    const payload = await readJsonBody<ImageGenerationRequest>(request);
    sendJson(response, 200, await generateImage(payload));
    return true;
  }

  if (url.pathname.startsWith("/api/comic-assets/") && request.method === "GET") {
    const relativeSegments = url.pathname
      .replace("/api/comic-assets/", "")
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (relativeSegments.length < 2) {
      sendJson(response, 400, {
        error: "INVALID_COMIC_ASSET_REQUEST",
        message: "comicId and asset path are required."
      });
      return true;
    }

    const [comicId, ...assetSegments] = relativeSegments;
    const absolutePath = resolveComicAssetAbsolutePath({
      comicRoot: defaultComicRoot,
      comicId,
      relativePath: assetSegments.join("/")
    });
    await serveAbsoluteFile(response, absolutePath, join(defaultComicRoot, comicId));
    return true;
  }

  if (url.pathname === "/api/comics/presets" && request.method === "GET") {
    sendJson(response, 200, await listComicPromptPresets());
    return true;
  }

  if (url.pathname === "/api/comics/projects" && request.method === "GET") {
    sendJson(response, 200, await listPersistedComicProjects(defaultComicRoot));
    return true;
  }

  if (url.pathname === "/api/comics/projects" && request.method === "POST") {
    const payload = await readJsonBody<CreatePersistedComicRequest>(request);
    sendJson(response, 201, await createPersistedComicProject(defaultComicRoot, payload));
    return true;
  }

  const comicProjectPagesMatch = url.pathname.match(/^\/api\/comics\/projects\/([^/]+)\/pages$/u);
  if (comicProjectPagesMatch && request.method === "POST") {
    const comicId = decodeURIComponent(comicProjectPagesMatch[1]);
    const payload = await readJsonBody<AppendPersistedComicPageRequest>(request);
    sendJson(response, 200, await appendPersistedComicPage(defaultComicRoot, comicId, payload));
    return true;
  }

  const comicProjectMatch = url.pathname.match(/^\/api\/comics\/projects\/([^/]+)$/u);
  if (comicProjectMatch && request.method === "GET") {
    const comicId = decodeURIComponent(comicProjectMatch[1]);
    sendJson(response, 200, await loadPersistedComicProject(defaultComicRoot, comicId));
    return true;
  }

  if (comicProjectMatch && request.method === "DELETE") {
    const comicId = decodeURIComponent(comicProjectMatch[1]);
    const deleted = await deletePersistedComicProject(defaultComicRoot, comicId);
    sendJson(
      response,
      deleted ? 200 : 404,
      deleted
        ? { ok: true }
        : {
            error: "COMIC_NOT_FOUND",
            message: `Local comic not found: ${comicId}`
          }
    );
    return true;
  }

  if (url.pathname === "/api/comics/generate-page" && request.method === "POST") {
    const payload = await readJsonBody<ComicPageGenerationRequest>(request);
    sendJson(response, 200, await generateComicPage(payload));
    return true;
  }

  if (url.pathname === "/api/comics/generate-metadata" && request.method === "POST") {
    const payload = await readJsonBody<ComicMetadataGenerationRequest>(request);
    sendJson(response, 200, await generateComicMetadata(payload));
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const handled = await handleApiRequest(request, response);
      if (handled) {
        return;
      }

      sendText(
        response,
        200,
        [
          "Multi-Model Comic Workflow server is running.",
          "Main API routes:",
          "- GET  /api/health",
          "- GET  /api/providers/images",
          "- GET  /api/providers/text",
          "- GET  /api/comics/presets",
          "- POST /api/comics/generate-page",
          "- POST /api/comics/generate-metadata",
          "- GET  /api/comics/projects",
          "- POST /api/comics/projects",
          "- POST /api/comics/projects/:comicId/pages"
        ].join("\n")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error.";
      sendJson(response, 500, {
        error: "INTERNAL_SERVER_ERROR",
        message
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const localUrl = `http://127.0.0.1:${port}`;
    console.log(`Multi-Model Comic Workflow server is running at ${localUrl}`);
  });

  if (!(await pathExists(defaultComicRoot))) {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(defaultComicRoot, { recursive: true }));
  }
}

void main();
