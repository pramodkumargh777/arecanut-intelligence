/**
 * Language-model provider abstraction. ANI works with provider "none" (default): every answer is then assembled
 * deterministically from verified tool data. Providers only ever write prose; they never supply numbers.
 */
export type AssistantConfig = {
  ASSISTANT_LLM_PROVIDER?: string;
  ASSISTANT_LLM_MODEL?: string;
  ASSISTANT_EMBEDDING_PROVIDER?: string;
  ASSISTANT_EMBEDDING_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  ASSISTANT_LLM_TIMEOUT_MS?: string;
  AI?: { run: (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> };
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = { maxTokens?: number; json?: boolean; temperature?: number };

export interface ChatProvider {
  readonly name: "ollama" | "workers_ai" | "mock";
  readonly model: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export interface EmbeddingProvider {
  readonly name: "ollama" | "workers_ai" | "mock";
  /** Provider-specific model identifier used for the call. */
  readonly model: string;
  /** Canonical model name stored with vectors so different runtimes of the same checkpoint stay comparable. */
  readonly canonicalModel: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly reason: "timeout" | "unreachable" | "http" | "invalid_response" | "not_configured") {
    super(message);
  }
}

export const DEFAULT_MODELS = {
  ollama: { chat: "qwen3.5:4b", embedding: "bge-m3:567m" },
  workers_ai: { chat: "@cf/qwen/qwen3-30b-a3b-fp8", embedding: "@cf/baai/bge-m3" },
} as const;

/** BGE-M3 is the only embedding checkpoint ANI indexes with; both runtimes serve BAAI/bge-m3. */
export const CANONICAL_EMBEDDING_MODEL = "BAAI/bge-m3";

function timeoutMs(config: AssistantConfig) {
  const parsed = Number(config.ASSISTANT_LLM_TIMEOUT_MS ?? 25_000);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.min(parsed, 120_000) : 25_000;
}

function baseUrl(config: AssistantConfig) {
  return (config.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError(`Provider did not respond within ${ms} ms.`, "timeout");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(`Provider unreachable: ${error instanceof Error ? error.message : String(error)}`, "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** Remove reasoning traces some Qwen checkpoints emit even when thinking is disabled. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

class OllamaChat implements ChatProvider {
  readonly name = "ollama" as const;
  constructor(readonly model: string, private readonly url: string, private readonly timeout: number) {}
  async chat(messages: ChatMessage[], options: ChatOptions = {}) {
    return withTimeout(this.timeout, async (signal) => {
      const response = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          think: false,
          ...(options.json ? { format: "json" } : {}),
          options: { temperature: options.temperature ?? 0.1, num_predict: options.maxTokens ?? 400 },
        }),
      });
      if (!response.ok) throw new ProviderError(`Ollama returned HTTP ${response.status}.`, "http");
      const body = (await response.json()) as { message?: { content?: unknown } };
      if (typeof body.message?.content !== "string") throw new ProviderError("Ollama returned no message content.", "invalid_response");
      return stripThinking(body.message.content);
    });
  }
}

class OllamaEmbedding implements EmbeddingProvider {
  readonly name = "ollama" as const;
  readonly canonicalModel = CANONICAL_EMBEDDING_MODEL;
  constructor(readonly model: string, private readonly url: string, private readonly timeout: number) {}
  async embed(texts: string[]) {
    return withTimeout(this.timeout, async (signal) => {
      const response = await fetch(`${this.url}/api/embed`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (!response.ok) throw new ProviderError(`Ollama embedding returned HTTP ${response.status}.`, "http");
      const body = (await response.json()) as { embeddings?: unknown };
      return validateVectors(body.embeddings, texts.length);
    });
  }
}

/** Qwen3 reasons before answering by default, which would spend the token budget and the billed output on hidden text. */
export function withoutReasoning(messages: ChatMessage[], model: string): ChatMessage[] {
  if (!/qwen3/i.test(model)) return messages;
  return messages.map((message, index) => index === messages.length - 1 && message.role === "user" ? { ...message, content: `${message.content}\n/no_think` } : message);
}

class WorkersAiChat implements ChatProvider {
  readonly name = "workers_ai" as const;
  constructor(readonly model: string, private readonly ai: NonNullable<AssistantConfig["AI"]>, private readonly timeout: number) {}
  async chat(messages: ChatMessage[], options: ChatOptions = {}) {
    return withTimeout(this.timeout, async () => {
      const result = (await this.ai.run(this.model, {
        messages: withoutReasoning(messages, this.model),
        max_tokens: options.maxTokens ?? 400,
        temperature: options.temperature ?? 0.1,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      })) as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
      const text = typeof result?.response === "string" ? result.response : result?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new ProviderError("Workers AI returned no text.", "invalid_response");
      return stripThinking(text);
    });
  }
}

class WorkersAiEmbedding implements EmbeddingProvider {
  readonly name = "workers_ai" as const;
  readonly canonicalModel = CANONICAL_EMBEDDING_MODEL;
  constructor(readonly model: string, private readonly ai: NonNullable<AssistantConfig["AI"]>, private readonly timeout: number) {}
  async embed(texts: string[]) {
    return withTimeout(this.timeout, async () => {
      const result = (await this.ai.run(this.model, { text: texts })) as { data?: unknown };
      return validateVectors(result?.data, texts.length);
    });
  }
}

function validateVectors(value: unknown, expected: number): number[][] {
  if (!Array.isArray(value) || value.length !== expected) throw new ProviderError("Embedding response had an unexpected shape.", "invalid_response");
  for (const vector of value) {
    if (!Array.isArray(vector) || vector.length < 8 || !vector.every((item) => typeof item === "number" && Number.isFinite(item))) {
      throw new ProviderError("Embedding response contained a non-numeric vector.", "invalid_response");
    }
  }
  return value as number[][];
}

export type ProviderStatus = { provider: string; model: string | null; configured: boolean; reason: string | null };

export function chatProvider(config: AssistantConfig): ChatProvider | null {
  const provider = (config.ASSISTANT_LLM_PROVIDER ?? "none").trim().toLowerCase();
  if (provider === "ollama") return new OllamaChat(config.ASSISTANT_LLM_MODEL || DEFAULT_MODELS.ollama.chat, baseUrl(config), timeoutMs(config));
  if (provider === "workers_ai" && config.AI) return new WorkersAiChat(config.ASSISTANT_LLM_MODEL || DEFAULT_MODELS.workers_ai.chat, config.AI, timeoutMs(config));
  return null;
}

export function embeddingProvider(config: AssistantConfig): EmbeddingProvider | null {
  const provider = (config.ASSISTANT_EMBEDDING_PROVIDER ?? "none").trim().toLowerCase();
  if (provider === "ollama") return new OllamaEmbedding(config.ASSISTANT_EMBEDDING_MODEL || DEFAULT_MODELS.ollama.embedding, baseUrl(config), timeoutMs(config));
  if (provider === "workers_ai" && config.AI) return new WorkersAiEmbedding(config.ASSISTANT_EMBEDDING_MODEL || DEFAULT_MODELS.workers_ai.embedding, config.AI, timeoutMs(config));
  return null;
}

export function providerStatus(kind: "chat" | "embedding", config: AssistantConfig): ProviderStatus {
  const requested = ((kind === "chat" ? config.ASSISTANT_LLM_PROVIDER : config.ASSISTANT_EMBEDDING_PROVIDER) ?? "none").trim().toLowerCase();
  const provider = kind === "chat" ? chatProvider(config) : embeddingProvider(config);
  if (provider) return { provider: provider.name, model: provider.model, configured: true, reason: null };
  if (requested === "workers_ai") return { provider: requested, model: null, configured: false, reason: "The Workers AI binding `AI` is not configured." };
  if (requested !== "none" && requested !== "") return { provider: requested, model: null, configured: false, reason: `Unknown provider "${requested}".` };
  return { provider: "none", model: null, configured: false, reason: "No language-model provider configured; answers are rule-based." };
}
