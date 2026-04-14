import type {
  RuntimeTextModelConfigInput,
  TextGenerationMeta
} from "../types.ts";
import { getTextProviderConfig } from "./config.ts";

export type GeneratedTextResult = {
  text: string;
  provider: string;
  meta: TextGenerationMeta;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function pickRuntimeNumber(
  runtimeTextModelConfig: RuntimeTextModelConfigInput | undefined,
  key: "temperature" | "maxTokens"
): number | undefined {
  const raw = (runtimeTextModelConfig as Record<string, unknown> | undefined)?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
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

function normalizeOpenAiTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function generateOpenAiCompatibleText(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  runtimeTextModelConfig?: RuntimeTextModelConfigInput;
}): Promise<GeneratedTextResult> {
  const started = Date.now();
  const requestBody: Record<string, unknown> = {
    model: args.model,
    messages: [
      ...(args.systemPrompt ? [{ role: "system", content: args.systemPrompt }] : []),
      { role: "user", content: args.userPrompt }
    ]
  };

  const temperature = pickRuntimeNumber(args.runtimeTextModelConfig, "temperature");
  const maxTokens = pickRuntimeNumber(args.runtimeTextModelConfig, "maxTokens");
  if (typeof temperature === "number") {
    requestBody.temperature = temperature;
  }
  if (typeof maxTokens === "number") {
    requestBody.max_tokens = maxTokens;
  }

  const response = await fetch(`${args.baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const data = await readResponseData(response);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(data, `OpenAI-compatible text request failed with HTTP ${response.status}.`)
    );
  }

  const payload = data as OpenAiChatResponse;
  const text = normalizeOpenAiTextContent(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error("OpenAI-compatible text request returned no text.");
  }

  return {
    text,
    provider: `${args.baseUrl}:${args.model}`,
    meta: {
      provider: `${args.baseUrl}:${args.model}`,
      model: args.model,
      durationMs: Date.now() - started,
      estimatedCost: null,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? null,
        completionTokens: payload.usage?.completion_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null
      }
    }
  };
}

function extractGeminiText(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    return "";
  }

  const payload = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const texts: string[] = [];
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        texts.push(part.text.trim());
      }
    }
  }

  return texts.join("\n").trim();
}

async function generateGeminiText(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
}): Promise<GeneratedTextResult> {
  const started = Date.now();
  const response = await fetch(
    `${args.baseUrl.replace(/\/+$/u, "")}/models/${args.model}:generateContent?key=${encodeURIComponent(args.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(args.systemPrompt
          ? {
              systemInstruction: {
                parts: [{ text: args.systemPrompt }]
              }
            }
          : {}),
        contents: [
          {
            parts: [{ text: args.userPrompt }]
          }
        ]
      })
    }
  );

  const data = await readResponseData(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `Gemini text request failed with HTTP ${response.status}.`));
  }

  const text = extractGeminiText(data);
  if (!text) {
    throw new Error("Gemini text request returned no text.");
  }

  const usage = typeof data === "object" && data !== null ? (data as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }).usageMetadata : undefined;

  return {
    text,
    provider: `${args.baseUrl}:${args.model}`,
    meta: {
      provider: `${args.baseUrl}:${args.model}`,
      model: args.model,
      durationMs: Date.now() - started,
      estimatedCost: null,
      usage: {
        promptTokens: usage?.promptTokenCount ?? null,
        completionTokens: usage?.candidatesTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null
      }
    }
  };
}

export async function generateText(args: {
  systemPrompt?: string;
  userPrompt: string;
  textProfileId?: string;
  runtimeTextModelConfig?: RuntimeTextModelConfigInput;
}): Promise<GeneratedTextResult> {
  const config = getTextProviderConfig({
    textProfileId: args.textProfileId,
    runtimeTextModelConfig: args.runtimeTextModelConfig
  });

  if (config.dependence === "Mock") {
    return {
      text: args.userPrompt,
      provider: "text:mock",
      meta: {
        provider: "text:mock",
        model: "mock-text",
        durationMs: 0,
        estimatedCost: {
          amount: 0,
          currency: "USD",
          pricingModel: "mock-local",
          note: "Mock mode returns deterministic local text."
        },
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null
        }
      }
    };
  }

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error(`${config.profileName} is not fully configured.`);
  }

  if (config.dependence === "Google") {
    return generateGeminiText({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt
    });
  }

  return generateOpenAiCompatibleText({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    runtimeTextModelConfig: args.runtimeTextModelConfig
  });
}
