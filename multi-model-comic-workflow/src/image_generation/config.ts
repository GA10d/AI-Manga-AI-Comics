import type {
  ImageProfileSummary,
  RuntimeImageModelConfigInput
} from "../types.ts";
import {
  getDefaultImageProfileId,
  getImageProfile,
  IMAGE_MODEL_FEATURE_LABELS,
  listImageProfiles,
  type ImageModelFeatureKey,
  type ImageProfileDefinition
} from "../config/imageProfiles.ts";
import { envFirst } from "../utils/env.ts";

export type ImageProviderConfig = {
  profileId: string;
  profileName: string;
  profileCode: string;
  dependence: "Mock" | "OpenAI" | "Google";
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  providerLabel: string;
  features: ImageProfileDefinition["features"];
};

function resolveProfile(profileId: string | undefined): ImageProfileDefinition {
  const targetProfile =
    (profileId ? getImageProfile(profileId) : null) ??
    getImageProfile(getDefaultImageProfileId());

  if (!targetProfile) {
    throw new Error("No image profile could be resolved.");
  }

  return targetProfile;
}

function pickRuntimeValue(
  runtimeImageModelConfig: RuntimeImageModelConfigInput | undefined,
  key: keyof RuntimeImageModelConfigInput
): string | undefined {
  const rawValue = runtimeImageModelConfig?.[key];
  return typeof rawValue === "string" && rawValue.trim().length > 0
    ? rawValue.trim()
    : undefined;
}

function resolveApiKey(
  profile: ImageProfileDefinition,
  runtimeImageModelConfig?: RuntimeImageModelConfigInput
): string | null {
  if (profile.dependence === "Mock") {
    return null;
  }

  return pickRuntimeValue(runtimeImageModelConfig, "apiKey") ?? envFirst(...profile.envKeyCandidates) ?? null;
}

function resolveModel(
  profile: ImageProfileDefinition,
  runtimeImageModelConfig?: RuntimeImageModelConfigInput
): string | null {
  return (
    pickRuntimeValue(runtimeImageModelConfig, "model") ??
    envFirst(...profile.modelEnvKeyCandidates) ??
    profile.baseModel
  );
}

function resolveBaseUrl(
  profile: ImageProfileDefinition,
  runtimeImageModelConfig?: RuntimeImageModelConfigInput
): string | null {
  if (profile.dependence === "Mock") {
    return null;
  }

  const rawBaseUrl =
    pickRuntimeValue(runtimeImageModelConfig, "baseUrl") ??
    envFirst(...profile.baseUrlEnvKeyCandidates) ??
    profile.baseUrl ??
    undefined;

  if (!rawBaseUrl && profile.urlRequirements) {
    return null;
  }

  return rawBaseUrl ? rawBaseUrl.replace(/\/+$/u, "") : null;
}

function buildMissingKeys(
  profile: ImageProfileDefinition,
  runtimeImageModelConfig?: RuntimeImageModelConfigInput
): string[] {
  if (profile.dependence === "Mock") {
    return [];
  }

  const missingKeys: string[] = [];
  if (!resolveApiKey(profile, runtimeImageModelConfig)) {
    missingKeys.push(profile.envKeyCandidates.join(" | "));
  }

  if (!resolveModel(profile, runtimeImageModelConfig)) {
    missingKeys.push(profile.modelEnvKeyCandidates.join(" | "));
  }

  if (!resolveBaseUrl(profile, runtimeImageModelConfig)) {
    missingKeys.push(profile.baseUrlEnvKeyCandidates.join(" | "));
  }

  return missingKeys;
}

function buildFeatureDetails(
  profile: ImageProfileDefinition
): ImageProfileSummary["featureDetails"] {
  return (Object.entries(profile.features) as Array<
    [ImageModelFeatureKey, ImageProfileDefinition["features"][ImageModelFeatureKey]]
  >).map(([featureKey, featureConfig]) => ({
    key: featureKey,
    label: IMAGE_MODEL_FEATURE_LABELS[featureKey],
    supported: featureConfig.supported,
    model: featureConfig.model,
    url: featureConfig.url
  }));
}

function buildProfileMessage(
  profile: ImageProfileDefinition,
  runtimeImageModelConfig?: RuntimeImageModelConfigInput
): string {
  if (profile.dependence === "Mock") {
    return `${profile.name} is available for placeholder image generation.`;
  }

  const missingKeys = buildMissingKeys(profile, runtimeImageModelConfig);
  if (missingKeys.length === 0) {
    const model = resolveModel(profile, runtimeImageModelConfig);
    return `${profile.name} is ready and will use ${model}.`;
  }

  return `${profile.name} is not fully configured. Missing: ${missingKeys.join(", ")}`;
}

export function listImageProfileSummaries(): ImageProfileSummary[] {
  return listImageProfiles().map((profile) => {
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
      message: buildProfileMessage(profile),
      featureDetails: buildFeatureDetails(profile)
    };
  });
}

export function getImageProviderConfig(args?: {
  imageProfileId?: string;
  runtimeImageModelConfig?: RuntimeImageModelConfigInput;
}): ImageProviderConfig {
  const profile = resolveProfile(args?.imageProfileId);
  const apiKey = resolveApiKey(profile, args?.runtimeImageModelConfig);
  const model = resolveModel(profile, args?.runtimeImageModelConfig);
  const baseUrl = resolveBaseUrl(profile, args?.runtimeImageModelConfig);

  if (profile.dependence !== "Mock") {
    const missingKeys = buildMissingKeys(profile, args?.runtimeImageModelConfig);
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
    providerLabel: `image:${profile.code}`,
    features: profile.features
  };
}
