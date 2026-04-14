import type {
  RuntimeTextModelConfigInput,
  TextProfileSummary
} from "../types.ts";
import {
  getDefaultTextProfileId,
  getTextProfile,
  listTextProfiles,
  type TextProfileDefinition
} from "../config/textProfiles.ts";
import { envFirst } from "../utils/env.ts";

export type TextProviderConfig = {
  profileId: string;
  profileName: string;
  profileCode: string;
  dependence: "Mock" | "OpenAI" | "Google";
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  providerLabel: string;
};

function resolveProfile(profileId: string | undefined): TextProfileDefinition {
  const targetProfile =
    (profileId ? getTextProfile(profileId) : null) ??
    getTextProfile(getDefaultTextProfileId());

  if (!targetProfile) {
    throw new Error("No text profile could be resolved.");
  }

  return targetProfile;
}

function pickRuntimeValue(
  runtimeTextModelConfig: RuntimeTextModelConfigInput | undefined,
  key: keyof RuntimeTextModelConfigInput
): string | undefined {
  const rawValue = runtimeTextModelConfig?.[key];
  return typeof rawValue === "string" && rawValue.trim().length > 0
    ? rawValue.trim()
    : undefined;
}

function resolveApiKey(
  profile: TextProfileDefinition,
  runtimeTextModelConfig?: RuntimeTextModelConfigInput
): string | null {
  if (profile.dependence === "Mock") {
    return null;
  }

  return pickRuntimeValue(runtimeTextModelConfig, "apiKey") ?? envFirst(...profile.envKeyCandidates) ?? null;
}

function resolveModel(
  profile: TextProfileDefinition,
  runtimeTextModelConfig?: RuntimeTextModelConfigInput
): string | null {
  return (
    pickRuntimeValue(runtimeTextModelConfig, "model") ??
    envFirst(...profile.modelEnvKeyCandidates) ??
    profile.baseModel
  );
}

function resolveBaseUrl(
  profile: TextProfileDefinition,
  runtimeTextModelConfig?: RuntimeTextModelConfigInput
): string | null {
  if (profile.dependence === "Mock") {
    return null;
  }

  const rawBaseUrl =
    pickRuntimeValue(runtimeTextModelConfig, "baseUrl") ??
    envFirst(...profile.baseUrlEnvKeyCandidates) ??
    profile.baseUrl ??
    undefined;

  if (!rawBaseUrl && profile.urlRequirements) {
    return null;
  }

  return rawBaseUrl ? rawBaseUrl.replace(/\/+$/u, "") : null;
}

function buildMissingKeys(
  profile: TextProfileDefinition,
  runtimeTextModelConfig?: RuntimeTextModelConfigInput
): string[] {
  if (profile.dependence === "Mock") {
    return [];
  }

  const missingKeys: string[] = [];
  if (!resolveApiKey(profile, runtimeTextModelConfig)) {
    missingKeys.push(profile.envKeyCandidates.join(" | "));
  }

  if (!resolveModel(profile, runtimeTextModelConfig)) {
    missingKeys.push(profile.modelEnvKeyCandidates.join(" | "));
  }

  if (!resolveBaseUrl(profile, runtimeTextModelConfig)) {
    missingKeys.push(profile.baseUrlEnvKeyCandidates.join(" | "));
  }

  return missingKeys;
}

function buildProfileMessage(
  profile: TextProfileDefinition,
  runtimeTextModelConfig?: RuntimeTextModelConfigInput
): string {
  if (profile.dependence === "Mock") {
    return `${profile.name} is available for deterministic local metadata generation.`;
  }

  const missingKeys = buildMissingKeys(profile, runtimeTextModelConfig);
  if (missingKeys.length === 0) {
    const model = resolveModel(profile, runtimeTextModelConfig);
    return `${profile.name} is ready and will use ${model}.`;
  }

  return `${profile.name} is not fully configured. Missing: ${missingKeys.join(", ")}`;
}

export function listTextProfileSummaries(): TextProfileSummary[] {
  return listTextProfiles().map((profile) => {
    const missingKeys = buildMissingKeys(profile);
    return {
      id: profile.id,
      name: profile.name,
      code: profile.code,
      providerFamily: profile.providerFamily,
      dependence: profile.dependence,
      description: profile.description,
      urlRequirements: profile.urlRequirements,
      baseUrl: profile.baseUrl,
      baseModel: profile.baseModel,
      chargeUrl: profile.chargeUrl,
      docsUrl: profile.docsUrl,
      envKeyCandidates: profile.envKeyCandidates,
      allowsCustomApiKey: profile.allowsCustomApiKey,
      allowsCustomBaseUrl: profile.allowsCustomBaseUrl,
      allowsCustomModel: profile.allowsCustomModel,
      configured: missingKeys.length === 0,
      available: true,
      missingEnvKeys: missingKeys,
      message: buildProfileMessage(profile)
    };
  });
}

export function getTextProviderConfig(args?: {
  textProfileId?: string;
  runtimeTextModelConfig?: RuntimeTextModelConfigInput;
}): TextProviderConfig {
  const profile = resolveProfile(args?.textProfileId);
  const apiKey = resolveApiKey(profile, args?.runtimeTextModelConfig);
  const model = resolveModel(profile, args?.runtimeTextModelConfig);
  const baseUrl = resolveBaseUrl(profile, args?.runtimeTextModelConfig);

  if (profile.dependence !== "Mock") {
    const missingKeys = buildMissingKeys(profile, args?.runtimeTextModelConfig);
    if (missingKeys.length > 0) {
      throw new Error(`${profile.name} is not configured. Missing: ${missingKeys.join(", ")}`);
    }
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    profileCode: profile.code,
    dependence: profile.dependence,
    baseUrl,
    apiKey,
    model,
    providerLabel: `text:${profile.code}`
  };
}
