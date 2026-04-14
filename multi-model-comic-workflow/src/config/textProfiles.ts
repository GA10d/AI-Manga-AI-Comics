export type TextProviderDependence = "Mock" | "OpenAI" | "Google";

export type TextProfileDefinition = {
  id: string;
  order: number;
  name: string;
  code: string;
  providerFamily: string;
  dependence: TextProviderDependence;
  description: string;
  urlRequirements: boolean;
  baseUrl: string | null;
  baseModel: string | null;
  chargeUrl: string;
  docsUrl: string;
  envKeyCandidates: string[];
  modelEnvKeyCandidates: string[];
  baseUrlEnvKeyCandidates: string[];
  allowsCustomApiKey: boolean;
  allowsCustomBaseUrl: boolean;
  allowsCustomModel: boolean;
};

export const TEXT_PROFILES: TextProfileDefinition[] = [
  {
    id: "mock-text",
    order: 1,
    name: "Mock Text",
    code: "mock_text",
    providerFamily: "mock",
    dependence: "Mock",
    description: "Deterministic local fallback for title and description generation.",
    urlRequirements: false,
    baseUrl: null,
    baseModel: null,
    chargeUrl: "",
    docsUrl: "",
    envKeyCandidates: [],
    modelEnvKeyCandidates: [],
    baseUrlEnvKeyCandidates: [],
    allowsCustomApiKey: false,
    allowsCustomBaseUrl: false,
    allowsCustomModel: false
  },
  {
    id: "openai-text",
    order: 10,
    name: "OpenAI Text",
    code: "openai_text",
    providerFamily: "openai-compatible",
    dependence: "OpenAI",
    description: "OpenAI chat completions for metadata generation.",
    urlRequirements: false,
    baseUrl: "https://api.openai.com/v1",
    baseModel: "gpt-4o-mini",
    chargeUrl: "https://openai.com/api/pricing/",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    envKeyCandidates: [
      "OPENAI_API_KEY"
    ],
    modelEnvKeyCandidates: [
      "COMIC_OPENAI_TEXT_MODEL"
    ],
    baseUrlEnvKeyCandidates: [
      "COMIC_OPENAI_TEXT_BASE_URL"
    ],
    allowsCustomApiKey: true,
    allowsCustomBaseUrl: true,
    allowsCustomModel: true
  },
  {
    id: "deepseek-text",
    order: 20,
    name: "DeepSeek Text",
    code: "deepseek_text",
    providerFamily: "openai-compatible",
    dependence: "OpenAI",
    description: "DeepSeek chat completions for metadata generation.",
    urlRequirements: false,
    baseUrl: "https://api.deepseek.com/v1",
    baseModel: "deepseek-chat",
    chargeUrl: "https://platform.deepseek.com",
    docsUrl: "https://api-docs.deepseek.com/",
    envKeyCandidates: [
      "DEEPSEEK_API_KEY"
    ],
    modelEnvKeyCandidates: [
      "COMIC_DEEPSEEK_TEXT_MODEL"
    ],
    baseUrlEnvKeyCandidates: [
      "COMIC_DEEPSEEK_TEXT_BASE_URL"
    ],
    allowsCustomApiKey: true,
    allowsCustomBaseUrl: true,
    allowsCustomModel: true
  },
  {
    id: "gemini-text",
    order: 30,
    name: "Gemini Text",
    code: "gemini_text",
    providerFamily: "google-native",
    dependence: "Google",
    description: "Gemini native text generation for metadata generation.",
    urlRequirements: false,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseModel: "gemini-2.5-flash",
    chargeUrl: "https://ai.google.dev/pricing",
    docsUrl: "https://ai.google.dev/gemini-api/docs/text-generation",
    envKeyCandidates: [
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY"
    ],
    modelEnvKeyCandidates: [
      "COMIC_GEMINI_TEXT_MODEL"
    ],
    baseUrlEnvKeyCandidates: [
      "COMIC_GEMINI_TEXT_BASE_URL"
    ],
    allowsCustomApiKey: true,
    allowsCustomBaseUrl: true,
    allowsCustomModel: true
  },
  {
    id: "doubao-text",
    order: 40,
    name: "Doubao Text",
    code: "doubao_text",
    providerFamily: "openai-compatible",
    dependence: "OpenAI",
    description: "Doubao / Volcengine Ark text generation for metadata generation.",
    urlRequirements: false,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    baseModel: "doubao-seed-2-0-pro-260215",
    chargeUrl: "https://console.volcengine.com/ark",
    docsUrl: "https://www.volcengine.com/docs/82379/1541523",
    envKeyCandidates: [
      "DOUBAO_API_KEY",
      "ARK_API_KEY"
    ],
    modelEnvKeyCandidates: [
      "COMIC_DOUBAO_TEXT_MODEL"
    ],
    baseUrlEnvKeyCandidates: [
      "COMIC_DOUBAO_TEXT_BASE_URL"
    ],
    allowsCustomApiKey: true,
    allowsCustomBaseUrl: true,
    allowsCustomModel: true
  },
  {
    id: "custom-openai-compatible",
    order: 50,
    name: "Custom OpenAI-compatible Text",
    code: "custom_openai_compatible",
    providerFamily: "openai-compatible",
    dependence: "OpenAI",
    description: "Any OpenAI-compatible chat completions endpoint for metadata generation.",
    urlRequirements: true,
    baseUrl: null,
    baseModel: null,
    chargeUrl: "",
    docsUrl: "",
    envKeyCandidates: [
      "COMIC_CUSTOM_TEXT_API_KEY"
    ],
    modelEnvKeyCandidates: [
      "COMIC_CUSTOM_TEXT_MODEL"
    ],
    baseUrlEnvKeyCandidates: [
      "COMIC_CUSTOM_TEXT_BASE_URL"
    ],
    allowsCustomApiKey: true,
    allowsCustomBaseUrl: true,
    allowsCustomModel: true
  }
];

export function listTextProfiles(): TextProfileDefinition[] {
  return [...TEXT_PROFILES].sort((left, right) => left.order - right.order);
}

export function getTextProfile(profileId: string): TextProfileDefinition | null {
  return TEXT_PROFILES.find((item) => item.id === profileId) ?? null;
}

export function getDefaultTextProfileId(): string {
  return "mock-text";
}
