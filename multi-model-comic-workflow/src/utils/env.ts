import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let envLoaded = false;

export function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function parseEnvFileContent(rawContent: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const rawLine of rawContent.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push([key, value]);
  }

  return entries;
}

export function loadLocalEnvFiles(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  for (const fileName of [".env.local", ".env"]) {
    const fullPath = resolve(projectRoot(), fileName);
    if (!existsSync(fullPath)) {
      continue;
    }

    const content = readFileSync(fullPath, "utf8");
    for (const [key, value] of parseEnvFileContent(content)) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export function envFirst(...keys: string[]): string | undefined {
  loadLocalEnvFiles();

  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
