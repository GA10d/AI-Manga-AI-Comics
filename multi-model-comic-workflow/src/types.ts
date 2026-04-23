export type RuntimeTextModelConfigInput = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type RuntimeImageModelConfigInput = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
  watermark?: boolean;
};

export type CostEstimate = {
  amount: number;
  currency: string;
  pricingModel: string;
  note: string;
};

export type TextGenerationMeta = {
  provider: string;
  model: string | null;
  durationMs: number;
  estimatedCost?: CostEstimate | null;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  } | null;
};

export type ImageReferenceRole =
  | "character"
  | "previous_page"
  | "scene"
  | "style_reference";

export type ImagePromptTrigger =
  | "manual"
  | "character_portrait"
  | "npc_intro"
  | "scene_shift";

export type ImagePromptTemplateConfig = {
  version: number;
  defaultTheme: string;
  defaultTrigger: ImagePromptTrigger;
  fallbackTriggerTemplate: string;
  themes: Record<string, string>;
  triggerTemplates: Record<ImagePromptTrigger, string>;
  characterClauseTemplate: string;
  characterJoinSeparator: string;
  characterEntryTemplate: string;
};

export type ImageReferenceInput = {
  imageUrl: string;
  role?: ImageReferenceRole;
  label?: string;
};

export type ImageCharacterReference = {
  name: string;
  appearance: string;
  portraitUrl?: string;
};

export type ImageGenerationRequest = {
  prompt: string;
  trigger: ImagePromptTrigger;
  theme?: string;
  sceneId: string;
  characters?: ImageCharacterReference[];
  referenceImages?: ImageReferenceInput[];
  negativePrompt?: string;
  allowFallback?: boolean;
  imageProfileId?: string;
  runtimeImageModelConfig?: RuntimeImageModelConfigInput;
  promptTemplateConfig?: ImagePromptTemplateConfig;
};

export type ImageGenerationResponse = {
  imageUrl: string;
  revisedPrompt: string;
  provider: string;
  cached: boolean;
  mimeType?: string | null;
  outputPath?: string | null;
};

export type ComicStylePreset = {
  id: string;
  name: string;
  prompt: string;
};

export type ComicReferenceImageInput = {
  imageUrl: string;
  role?: "character" | "scene" | "previous_page";
  name?: string;
  appearance?: string;
  description?: string;
};

export type ComicPreviousPageInput = {
  pageNumber: number;
  prompt: string;
  summary?: string;
  imageUrl?: string | null;
};

export type ComicPageGenerationRequest = {
  storyPrompt: string;
  styleId?: string;
  sceneId?: string;
  pageNumber?: number;
  storyMemorySummary?: string;
  previousPages?: ComicPreviousPageInput[];
  referenceImages?: ComicReferenceImageInput[];
  negativePrompt?: string;
  allowFallback?: boolean;
  imageProfileId?: string;
  runtimeImageModelConfig?: RuntimeImageModelConfigInput;
};

export type ComicPageGenerationResponse = ImageGenerationResponse & {
  style: ComicStylePreset;
  pageNumber: number;
  continuationContext: string | null;
  characterReferenceCount: number;
  sceneReferenceCount: number;
  previousPageReferenceCount: number;
};

export type ComicMetadataGenerationRequest = {
  storyPrompt: string;
  styleId?: string;
  locale?: string;
  textProfileId?: string;
  runtimeTextModelConfig?: RuntimeTextModelConfigInput;
};

export type ComicMetadataGenerationResponse = {
  title: string;
  description: string;
  rawText: string;
  provider: string;
  meta?: TextGenerationMeta | null;
  style: ComicStylePreset;
};

export type ComicPromptPresetResponse = {
  styles: ComicStylePreset[];
  pageLayout: string;
};

export type PersistedComicAsset = {
  relativePath: string;
  storagePath: string;
  apiPath: string;
  mimeType: string | null;
};

export type PersistedComicReference = {
  referenceId: string;
  role: "character" | "scene";
  name?: string | null;
  appearance?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
  createdAt: string;
  image: PersistedComicAsset;
};

export type PersistedComicPage = {
  pageId: string;
  pageNumber: number;
  storyPrompt: string;
  revisedPrompt: string;
  continuationContext: string | null;
  negativePrompt: string | null;
  provider: string;
  createdAt: string;
  style: ComicStylePreset;
  image: PersistedComicAsset;
  characterReferenceIds: string[];
  sceneReferenceIds: string[];
  previousPageNumber: number | null;
};

export type PersistedComicProject = {
  comicId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
  storyPrompt: string;
  style: ComicStylePreset;
  pageCount: number;
  storageRoot: string;
  coverImage?: PersistedComicAsset | null;
  references: PersistedComicReference[];
  pages: PersistedComicPage[];
};

export type ComicProjectSummary = {
  comicId: string;
  title: string;
  description: string;
  style: ComicStylePreset;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  storagePath: string;
  coverImage?: PersistedComicAsset | null;
};

export type CreatePersistedComicRequest = ComicPageGenerationRequest & {
  title?: string;
  description?: string;
  generateMetadata?: boolean;
  metadataLocale?: string;
  metadataTextProfileId?: string;
  metadataRuntimeTextModelConfig?: RuntimeTextModelConfigInput;
};

export type AppendPersistedComicPageRequest = {
  storyPrompt: string;
  referenceImages?: ComicReferenceImageInput[];
  negativePrompt?: string;
  storyMemorySummary?: string;
  allowFallback?: boolean;
  imageProfileId?: string;
  runtimeImageModelConfig?: RuntimeImageModelConfigInput;
};

export type PersistedComicMutationResponse = {
  project: PersistedComicProject;
  page: PersistedComicPage;
};

export type FeatureSummary = {
  key: string;
  label: string;
  supported: boolean;
  model: string | null;
  url: string | null;
};

export type ImageProfileSummary = {
  id: string;
  name: string;
  code: string;
  providerFamily: string;
  dependence: "Mock" | "OpenAI" | "Google";
  description: string;
  urlRequirements: boolean;
  baseUrl: string | null;
  baseModel: string | null;
  chargeUrl: string;
  docsUrl: string;
  envKeyCandidates: string[];
  allowsCustomApiKey: boolean;
  allowsCustomBaseUrl: boolean;
  allowsCustomModel: boolean;
  configured: boolean;
  available: boolean;
  missingEnvKeys: string[];
  message: string;
  featureDetails: FeatureSummary[];
};

export type TextProfileSummary = {
  id: string;
  name: string;
  code: string;
  providerFamily: string;
  dependence: "Mock" | "OpenAI" | "Google";
  description: string;
  urlRequirements: boolean;
  baseUrl: string | null;
  baseModel: string | null;
  chargeUrl: string;
  docsUrl: string;
  envKeyCandidates: string[];
  allowsCustomApiKey: boolean;
  allowsCustomBaseUrl: boolean;
  allowsCustomModel: boolean;
  configured: boolean;
  available: boolean;
  missingEnvKeys: string[];
  message: string;
};
