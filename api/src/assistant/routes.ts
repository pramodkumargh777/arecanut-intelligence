/**
 * Assistant HTTP routes. The assistant is optional: every ANI page works without it, and without a configured
 * language model it still answers from verified tool data with a rule-based interpretation.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { classifyQuestion, type Classification } from "./classify";
import { composeAnswer, planToolsWithModel } from "./compose";
import { detectInjection } from "./grounding";
import { detectLanguage, STRINGS } from "./language";
import { CANONICAL_EMBEDDING_MODEL, chatProvider, embeddingProvider, providerStatus, type AssistantConfig } from "./providers";
import { corpusStats, DEFAULT_SEMANTIC_THRESHOLD, pageLabel, quantizeEmbedding, rebuildFtsIndex, searchDocuments } from "./retrieval";
import { runTool, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type ToolContext } from "./tools";
import { TOOL_NAMES, type ToolName, type ToolResult } from "./types";
import { bearerMatches } from "../auth";

export type ApiCaller = (path: string, init: RequestInit | undefined, env: Env["Bindings"]) => Promise<Response>;

const DEFAULT_RATE_LIMIT = 30;
const MAX_CHUNKS_PER_DOCUMENT = 400;
const STATEMENTS_PER_BATCH = 50;

function isAuthorized(header: string | undefined, token: string | undefined): boolean {
  return bearerMatches(header, token);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rateLimit(env: Env["Bindings"]): number {
  const parsed = Number(env.ASSISTANT_RATE_LIMIT_PER_HOUR ?? DEFAULT_RATE_LIMIT);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : DEFAULT_RATE_LIMIT;
}

function semanticThreshold(env: Env["Bindings"]): number {
  const parsed = Number(env.ASSISTANT_SEMANTIC_THRESHOLD ?? DEFAULT_SEMANTIC_THRESHOLD);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_SEMANTIC_THRESHOLD;
}

function config(env: Env["Bindings"]): AssistantConfig {
  return env;
}

/** Fixed hourly window per salted client hash, shared through D1. Returns the count after this request. */
async function consumeRateLimit(db: D1Database, clientHash: string, now: Date): Promise<number> {
  const window = now.toISOString().slice(0, 13);
  const row = await db.prepare(`INSERT INTO assistant_rate_limits (client_hash, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT (client_hash, window_start) DO UPDATE SET request_count = request_count + 1 RETURNING request_count`)
    .bind(clientHash, window).first<{ request_count: number }>();
  const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString().slice(0, 13);
  await db.prepare("DELETE FROM assistant_rate_limits WHERE window_start < ?").bind(cutoff).run();
  return row?.request_count ?? 1;
}

const calculationInput = z.object({
  variety: z.string().trim().min(1).max(80).optional(),
  price: z.number().finite().optional(),
  quantity_quintals: z.number().finite().optional(),
  commission_percent: z.number().finite().optional(),
  transport_cost: z.number().finite().optional(),
  other_selling_cost: z.number().finite().optional(),
  hold_days: z.number().finite().optional(),
  storage_cost: z.number().finite().optional(),
  annual_finance_percent: z.number().finite().optional(),
  weight_loss_percent: z.number().finite().optional(),
  scenario_price: z.number().finite().optional(),
}).strict();

const querySchema = z.object({
  question: z.string().trim().min(2).max(1000),
  language: z.enum(["auto", "en", "kn"]).optional(),
  calculation: calculationInput.optional(),
  use_llm: z.boolean().optional(),
  /** The reader's previous question in this conversation, so "and Chali?" is understood. */
  context: z.object({ previous_question: z.string().trim().min(2).max(1000) }).strict().optional(),
}).strict();

const feedbackSchema = z.object({ interaction_id: z.string().uuid(), rating: z.enum(["up", "down"]) }).strict();

/** Entities a follow-up inherits when it does not name its own. Sources and dates are not carried over. */
const CARRIED_ENTITIES = ["variety", "district"] as const;

/**
 * A follow-up such as "and Chali?" or "what about Sirsi?" names too little to choose tools. When the question alone
 * matches no tool, the previous question's tools are used with the new question's entities on top; when it does, only
 * a missing variety or district is carried over. Returns the text to search and explain with.
 */
export function withConversation(question: string, previous?: string): { classification: Classification; question: string; followUp: boolean } {
  const current = classifyQuestion(question);
  if (!previous) return { classification: current, question, followUp: false };
  const prior = classifyQuestion(previous);
  const defined = Object.fromEntries(Object.entries(current.entities).filter(([, value]) => value !== undefined && value !== ""));
  if (!current.tools.length && prior.tools.length) {
    return {
      classification: { tools: prior.tools, entities: { ...prior.entities, ...defined }, calculation: { ...prior.calculation, ...current.calculation } },
      question: `${previous}\n${question}`, followUp: true,
    };
  }
  const carried = Object.fromEntries(CARRIED_ENTITIES.filter((key) => !defined[key] && prior.entities[key]).map((key) => [key, prior.entities[key]]));
  return { classification: { ...current, entities: { ...current.entities, ...carried } }, question, followUp: Object.keys(carried).length > 0 };
}

function tradeDirection(question: string): "import" | "export" | undefined {
  const imports = /\bimport(s|ed)?\b|ಆಮದು/i.test(question);
  const exports = /\bexport(s|ed)?\b|ರಫ್ತು/i.test(question);
  return imports && !exports ? "import" : exports && !imports ? "export" : undefined;
}

/** Build each selected tool's arguments from the entities the rules extracted, keeping only keys the tool accepts. */
export function argumentsFor(tool: ToolName, question: string, classification: Classification, calculation: Record<string, unknown> = {}): Record<string, unknown> {
  const { entities } = classification;
  const candidates: Record<string, unknown> = {
    ...entities,
    direction: tradeDirection(question),
    query: question,
    ...classification.calculation,
    ...calculation,
  };
  const allowed = Object.keys(TOOL_SCHEMAS[tool].shape);
  return Object.fromEntries(Object.entries(candidates).filter(([key, value]) => allowed.includes(key) && value !== undefined && value !== null && value !== ""));
}

export function createAssistantRoutes(caller: ApiCaller) {
  const routes = new Hono<Env>();

  routes.post("/assistant/query", async (c) => {
    const started = Date.now();
    const parsed = querySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Provide a question of 2 to 1000 characters. Optional: language (auto, en, kn), calculation inputs as numbers, use_llm." }, 400);
    const { question, calculation } = parsed.data;
    const language = detectLanguage(question, parsed.data.language);
    const db = c.env.DB;
    const now = new Date();
    const clientHash = await sha256Hex(`${c.env.ASSISTANT_CLIENT_SALT || "ani-assistant"}|${c.req.header("CF-Connecting-IP") ?? "local"}`);
    const count = await consumeRateLimit(db, clientHash, now);
    const limit = rateLimit(c.env);
    if (count > limit) {
      c.header("Retry-After", String(3600 - (Math.floor(now.getTime() / 1000) % 3600)));
      return c.json({ error: STRINGS[language].rate_limited, limit_per_hour: limit }, 429);
    }

    const injectionFlags = detectInjection(question);
    const chat = parsed.data.use_llm === false ? null : chatProvider(config(c.env));
    const embedder = embeddingProvider(config(c.env));
    const conversation = withConversation(question, parsed.data.context?.previous_question);
    const { classification } = conversation;
    // The text tools search with and the model explains: the follow-up together with the question it follows.
    const asked = conversation.question;
    let plan = classification.tools.map((tool) => ({ tool, args: argumentsFor(tool, asked, classification, calculation) }));
    let planning: "rules" | "llm" | "none" = plan.length ? "rules" : "none";
    let planningError: string | null = null;
    if (!plan.length && chat && !injectionFlags.length) {
      try {
        plan = await planToolsWithModel(chat, question);
        if (plan.length) planning = "llm";
      } catch (error) {
        planningError = error instanceof Error ? error.message : "Tool planning failed.";
      }
    }

    const ctx: ToolContext = {
      call: (path, init) => caller(path, init, c.env), db, question: asked, language, embedder,
      semanticThreshold: semanticThreshold(c.env), now,
    };
    const results: ToolResult[] = await Promise.all(plan.map((step) => runTool(step.tool, step.args, ctx)));
    const answer = await composeAnswer({ question: asked, language, results, chat, injectionFlags, llmDisabled: parsed.data.use_llm === false, now });

    const durationMs = Date.now() - started;
    const interactionId = crypto.randomUUID();
    await db.prepare(`INSERT INTO assistant_interactions (id, created_at, client_hash, language, question, intents, tools, tool_statuses, provider, model,
      llm_status, grounding_status, injection_flags, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(interactionId, now.toISOString(), clientHash, language, c.env.ASSISTANT_LOG_QUESTIONS === "true" ? question : "[not retained]",
        JSON.stringify({ planning, tools: classification.tools, entities: classification.entities }), JSON.stringify(results.map((result) => result.tool)),
        JSON.stringify(results.map((result) => result.status)), chat?.name ?? "none", chat?.model ?? null, answer.llm.status,
        answer.interpretation.grounding?.status ?? "not_applicable", JSON.stringify(injectionFlags), durationMs, answer.llm.reason ?? planningError)
      .run()
      .catch((error) => console.error("assistant audit insert failed", error));

    return c.json({ ...answer, planning, planning_error: planningError, entities: classification.entities, follow_up: conversation.followUp,
      interaction_id: interactionId, duration_ms: durationMs });
  });

  routes.post("/assistant/feedback", async (c) => {
    const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Provide interaction_id and rating (up or down)." }, 400);
    const clientHash = await sha256Hex(`${c.env.ASSISTANT_CLIENT_SALT || "ani-assistant"}|${c.req.header("CF-Connecting-IP") ?? "local"}`);
    // Only the reader who asked can rate an answer, which also keeps the counts from being stuffed.
    const asked = await c.env.DB.prepare("SELECT client_hash FROM assistant_interactions WHERE id = ?").bind(parsed.data.interaction_id).first<{ client_hash: string }>();
    if (!asked || asked.client_hash !== clientHash) return c.json({ error: "Answer not found." }, 404);
    await c.env.DB.prepare(`INSERT INTO assistant_feedback (interaction_id, rating, client_hash, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (interaction_id) DO UPDATE SET rating = excluded.rating, created_at = excluded.created_at`)
      .bind(parsed.data.interaction_id, parsed.data.rating === "up" ? 1 : -1, clientHash, new Date().toISOString()).run();
    return c.json({ saved: true });
  });

  routes.get("/assistant/status", async (c) => {
    const corpus = await corpusStats(c.env.DB).catch(() => ({ documents: 0, chunks: 0, embedded_chunks: 0 }));
    const recent = await c.env.DB.prepare(`SELECT llm_status, COUNT(*) AS requests FROM assistant_interactions WHERE created_at >= ? GROUP BY llm_status`)
      .bind(new Date(Date.now() - 86_400_000).toISOString()).all<{ llm_status: string; requests: number }>();
    return c.json({
      available: true,
      chat: providerStatus("chat", config(c.env)),
      embedding: providerStatus("embedding", config(c.env)),
      embedding_canonical_model: CANONICAL_EMBEDDING_MODEL,
      semantic_threshold: semanticThreshold(c.env),
      corpus,
      rate_limit_per_hour: rateLimit(c.env),
      questions_retained: c.env.ASSISTANT_LOG_QUESTIONS === "true",
      last_24_hours: recent.results,
      feedback_last_7_days: await c.env.DB.prepare(`SELECT SUM(rating = 1) AS up, SUM(rating = -1) AS down FROM assistant_feedback WHERE created_at >= ?`)
        .bind(new Date(Date.now() - 7 * 86_400_000).toISOString()).first<{ up: number | null; down: number | null }>()
        .then((row) => ({ up: row?.up ?? 0, down: row?.down ?? 0 })).catch(() => ({ up: 0, down: 0 })),
      tools: TOOL_NAMES.length,
      guarantees: [
        "Numbers, prices and forecasts come only from Areca Pulse tools and calculators; model text containing any other number is rejected.",
        "Without a language model the assistant still answers from verified data with a rule-based interpretation.",
        "Questions that look like prompt injection are answered without calling the language model.",
      ],
    });
  });

  routes.get("/assistant/tools", (c) => c.json({
    data: TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], arguments: Object.keys(TOOL_SCHEMAS[name].shape) })),
  }));

  routes.get("/documents", async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT d.id, d.title, d.publisher, d.document_type, d.language, d.source_url, d.publication_date,
        d.publication_date_basis, d.page_count, d.reuse_note, d.fetched_at, d.ingested_at, d.content_sha256,
        COUNT(c.id) AS chunks, SUM(c.embedding_q8 IS NOT NULL) AS embedded_chunks
      FROM documents d LEFT JOIN document_chunks c ON c.document_id = d.id WHERE d.status = 'active'
      GROUP BY d.id ORDER BY d.document_type, d.publication_date DESC, d.title LIMIT 200`).all();
    return c.json({ data: results, corpus: await corpusStats(c.env.DB) });
  });

  routes.get("/documents/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2 || q.length > 500) return c.json({ error: "q must be 2 to 500 characters." }, 400);
    const type = c.req.query("type");
    const types = ["cpcri_publication", "dasd_report", "government_notification", "agricultural_research"];
    if (type && !types.includes(type)) return c.json({ error: `type must be one of ${types.join(", ")}.` }, 400);
    const limit = Number(c.req.query("limit") ?? 5);
    const result = await searchDocuments(c.env.DB, q, {
      limit: Number.isInteger(limit) ? limit : 5, documentTypes: type ? [type] : undefined,
      embedder: embeddingProvider(config(c.env)), semanticThreshold: semanticThreshold(c.env),
    });
    return c.json({ ...result, hits: result.hits.map((hit) => ({ ...hit, page: pageLabel(hit), text: hit.text.slice(0, 1200) })) });
  });

  const embeddingSchema = z.object({ model: z.literal(CANONICAL_EMBEDDING_MODEL), dim: z.number().int().min(8).max(4096), q8: z.string().min(8).max(12_000) }).strict();
  const documentSchema = z.object({
    ingestion_job_id: z.string().trim().min(8).max(80),
    document: z.object({
      id: z.string().trim().min(8).max(80),
      title: z.string().trim().min(3).max(300),
      publisher: z.string().trim().min(2).max(200),
      document_type: z.enum(["cpcri_publication", "dasd_report", "government_notification", "agricultural_research"]),
      language: z.enum(["en", "kn", "hi", "ml", "mixed"]).default("en"),
      source_url: z.string().url().max(500).refine((url) => url.startsWith("https://") || url.startsWith("http://"), "http(s) URL required"),
      publication_date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable(),
      publication_date_basis: z.enum(["stated", "page_metadata"]).nullable(),
      mime_type: z.string().min(3).max(100),
      content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      page_count: z.number().int().min(1).max(5000).nullable(),
      reuse_note: z.string().max(500).nullable(),
      archive_object_id: z.string().max(80).nullable().optional(),
      fetched_at: z.string().datetime({ offset: true }),
    }).strict(),
    chunks: z.array(z.object({
      chunk_index: z.number().int().min(0).max(10_000),
      page_from: z.number().int().min(1).nullable(),
      page_to: z.number().int().min(1).nullable(),
      heading: z.string().max(300).nullable(),
      text: z.string().min(1).max(6000),
      language: z.enum(["en", "kn", "hi", "ml", "mixed"]).optional(),
      embedding: embeddingSchema.nullable().optional(),
    }).strict()).min(1).max(MAX_CHUNKS_PER_DOCUMENT),
  }).strict();

  function validEmbedding(embedding: z.infer<typeof embeddingSchema>) {
    try {
      return atob(embedding.q8).length === embedding.dim;
    } catch {
      return false;
    }
  }

  async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
    for (let index = 0; index < statements.length; index += STATEMENTS_PER_BATCH) await db.batch(statements.slice(index, index + STATEMENTS_PER_BATCH));
  }

  routes.post("/admin/documents", async (c) => {
    if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
    const parsed = documentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid document payload.", issues: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`) }, 400);
    const { document, chunks, ingestion_job_id } = parsed.data;
    const indexes = new Set(chunks.map((chunk) => chunk.chunk_index));
    if (indexes.size !== chunks.length) return c.json({ error: "chunk_index values must be unique." }, 400);
    if (chunks.some((chunk) => chunk.embedding && !validEmbedding(chunk.embedding))) return c.json({ error: "Embedding q8 length must equal dim (base64 int8)." }, 400);
    if (chunks.some((chunk) => chunk.page_from && chunk.page_to && chunk.page_to < chunk.page_from)) return c.json({ error: "page_to must be ≥ page_from." }, 400);
    const db = c.env.DB;
    const hashes = await Promise.all(chunks.map((chunk) => sha256Hex(chunk.text)));

    const existing = await db.prepare("SELECT id, status FROM documents WHERE source_url = ? AND content_sha256 = ?")
      .bind(document.source_url, document.content_sha256).first<{ id: string; status: string }>();
    const stored = existing
      ? (await db.prepare("SELECT chunk_index, text_sha256 FROM document_chunks WHERE document_id = ?").bind(existing.id).all<{ chunk_index: number; text_sha256: string }>()).results
      : [];
    const storedHash = new Map(stored.map((row) => [row.chunk_index, row.text_sha256]));
    const missing = chunks.flatMap((chunk, index) => storedHash.has(chunk.chunk_index) ? [] : [{ chunk, hash: hashes[index] }]);
    // Same file already ingested: only attach embeddings that are missing for identical chunk text.
    const embeddingUpdates = existing ? chunks.flatMap((chunk, index) => chunk.embedding && storedHash.has(chunk.chunk_index) ? [db.prepare(`UPDATE document_chunks SET embedding_model = ?, embedding_dim = ?, embedding_q8 = ?
      WHERE document_id = ? AND chunk_index = ? AND text_sha256 = ? AND embedding_q8 IS NULL`)
      .bind(chunk.embedding.model, chunk.embedding.dim, chunk.embedding.q8, existing.id, chunk.chunk_index, hashes[index])] : []) : [];
    if (existing?.status === "active" && !missing.length) {
      await runBatches(db, embeddingUpdates);
      return c.json({ status: "unchanged", document_id: existing.id, embeddings_offered: embeddingUpdates.length, document_status: existing.status });
    }
    if (chunks.some((chunk, index) => storedHash.has(chunk.chunk_index) && storedHash.get(chunk.chunk_index) !== hashes[index])) {
      return c.json({ error: "Stored chunks for this file differ from this upload (chunking changed?). Nothing was changed." }, 409);
    }

    // Chunks are written while the document is 'withdrawn', which keeps it out of every reader. A single atomic batch
    // then publishes it, so a failure leaves the previous version live and retrying the same upload resumes the work.
    const documentId = existing?.id ?? document.id;
    try {
      if (!existing) {
        await db.prepare(`INSERT INTO documents (id, title, publisher, document_type, language, source_url, publication_date, publication_date_basis,
          mime_type, content_sha256, page_count, reuse_note, archive_object_id, fetched_at, ingested_at, ingestion_job_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'withdrawn')`)
          .bind(document.id, document.title, document.publisher, document.document_type, document.language, document.source_url, document.publication_date,
            document.publication_date_basis, document.mime_type, document.content_sha256, document.page_count, document.reuse_note, document.archive_object_id ?? null,
            document.fetched_at, new Date().toISOString(), ingestion_job_id).run();
      }
      await runBatches(db, missing.map(({ chunk, hash }) => db.prepare(`INSERT INTO document_chunks (id, document_id, chunk_index, page_from, page_to, heading, text, text_sha256, language,
        embedding_model, embedding_dim, embedding_q8) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${documentId}:${chunk.chunk_index}`, documentId, chunk.chunk_index, chunk.page_from, chunk.page_to, chunk.heading, chunk.text, hash, chunk.language ?? document.language,
          chunk.embedding?.model ?? null, chunk.embedding?.dim ?? null, chunk.embedding?.q8 ?? null)));
      await runBatches(db, embeddingUpdates);
      const previous = (await db.prepare("SELECT id FROM documents WHERE source_url = ? AND status = 'active' AND id != ?")
        .bind(document.source_url, documentId).all<{ id: string }>()).results.map((row) => row.id);
      const removeFromIndex = (id: string) => db.prepare("DELETE FROM document_chunks_fts WHERE chunk_id IN (SELECT id FROM document_chunks WHERE document_id = ?)").bind(id);
      await db.batch([
        ...previous.flatMap((id) => [db.prepare("UPDATE documents SET status = 'withdrawn' WHERE id = ?").bind(id), removeFromIndex(id)]),
        removeFromIndex(documentId),
        db.prepare(`INSERT INTO document_chunks_fts (chunk_id, title, heading, text)
          SELECT c.id, d.title, COALESCE(c.heading, ''), c.text FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?`).bind(documentId),
        db.prepare("UPDATE documents SET status = 'active' WHERE id = ?").bind(documentId),
      ]);
      return c.json({ status: "ingested", document_id: documentId, chunks: chunks.length, embedded_chunks: chunks.filter((chunk) => chunk.embedding).length,
        withdrawn_versions: previous }, 201);
    } catch (error) {
      console.error("document ingestion failed", error);
      return c.json({ error: "Document was not published (duplicate id, constraint or database failure). Any previous version is still active; retry the same upload to resume." }, 409);
    }
  });

  routes.post("/admin/documents/reindex", async (c) => {
    if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
    return c.json(await rebuildFtsIndex(c.env.DB));
  });

  routes.post("/admin/documents/embed", async (c) => {
    if (!isAuthorized(c.req.header("Authorization"), c.env.ADMIN_TOKEN)) return c.json({ error: "A valid reviewer token is required." }, 401);
    const embedder = embeddingProvider(config(c.env));
    if (!embedder) return c.json({ error: "No embedding provider is configured (ASSISTANT_EMBEDDING_PROVIDER)." }, 503);
    const body = z.object({ limit: z.number().int().min(1).max(64).default(16) }).strict().safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "limit must be an integer from 1 to 64." }, 400);
    const { results } = await c.env.DB.prepare(`SELECT c.id, c.text FROM document_chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'active' AND c.embedding_q8 IS NULL ORDER BY c.document_id, c.chunk_index LIMIT ?`).bind(body.data.limit).all<{ id: string; text: string }>();
    if (!results.length) return c.json({ embedded: 0, remaining: 0, model: embedder.canonicalModel });
    let vectors: number[][];
    try {
      vectors = await embedder.embed(results.map((row) => row.text));
    } catch (error) {
      return c.json({ error: `Embedding provider failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
    }
    if (vectors.length !== results.length) return c.json({ error: "Embedding provider returned an unexpected number of vectors." }, 502);
    await runBatches(c.env.DB, results.map((row, index) => c.env.DB.prepare(`UPDATE document_chunks SET embedding_model = ?, embedding_dim = ?, embedding_q8 = ? WHERE id = ?`)
      .bind(embedder.canonicalModel, vectors[index].length, quantizeEmbedding(vectors[index]), row.id)));
    const remaining = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.status = 'active' AND c.embedding_q8 IS NULL`)
      .first<{ n: number }>();
    return c.json({ embedded: results.length, remaining: remaining?.n ?? 0, model: embedder.canonicalModel, provider: embedder.name });
  });

  return routes;
}
