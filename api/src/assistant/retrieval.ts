/**
 * Hybrid document retrieval over D1: SQLite FTS5 keyword search plus optional BGE-M3 semantic search on int8
 * vectors stored in document_chunks, fused with reciprocal-rank fusion. No external vector database is required.
 */
import { diseasesNamed, focusOnDisease } from "./diseases";
import { expandTerms } from "./language";
import { restrictedPesticides } from "./pesticides";
import { CANONICAL_EMBEDDING_MODEL, type EmbeddingProvider } from "./providers";

export type RetrievalOptions = {
  limit?: number;
  documentTypes?: string[];
  /** Minimum cosine similarity for a semantic-only hit to be kept. Calibrated for BGE-M3 (docs/AI_ASSISTANT.md). */
  semanticThreshold?: number;
  /** Maximum embedded chunks scanned per query. Above this, move to Vectorize (see docs). */
  semanticScanLimit?: number;
  embedder?: EmbeddingProvider | null;
  /** Passages in the reader's language come first. An English reader gets Kannada passages only if nothing else matches. */
  language?: "en" | "kn";
};

export type RetrievalHit = {
  chunk_id: string;
  document_id: string;
  title: string;
  publisher: string;
  document_type: string;
  language: string;
  source_url: string;
  publication_date: string | null;
  publication_date_basis: string | null;
  fetched_at: string;
  reuse_note: string | null;
  page_from: number | null;
  page_to: number | null;
  heading: string | null;
  text: string;
  matched_by: ("keyword" | "semantic")[];
  keyword_rank: number | null;
  semantic_similarity: number | null;
  score: number;
};

export type RetrievalResult = {
  hits: RetrievalHit[];
  /** Relevant passages not shown because they name a pesticide India has banned or restricted. */
  withheld_pesticides: string[];
  /** Diseases the question names. When present, every hit is about one of them. */
  diseases: string[];
  mode: "hybrid" | "keyword" | "semantic" | "none";
  semantic_status: "used" | "not_configured" | "no_vectors" | "failed";
  semantic_error: string | null;
  query_terms: string[];
  corpus: { documents: number; chunks: number; embedded_chunks: number };
};

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how i in is it its me my of on or should tell the to was what when where which who why will with about any there their this that these those you your give show please explain get find".split(" "),
);
/** Present in nearly every chunk of an arecanut corpus; used only if nothing more specific is asked. */
const LOW_INFORMATION = new Set(["arecanut", "areca", "adike", "adika", "supari", "nut", "nuts", "palm", "palms", "crop", "crops"]);

/**
 * Calibrated on the ingested CPCRI/DASD corpus with bge-m3 int8 vectors (docs/AI_ASSISTANT.md, 2026-11-05):
 * relevant English queries scored 0.47–0.64, off-topic English ≤ 0.40. Kannada→English cross-lingual scores overlap
 * (relevant 0.44–0.50, off-topic 0.44), so Kannada-script queries need KANNADA_THRESHOLD_MARGIN more and mainly rely
 * on the glossary-expanded keyword search.
 */
export const DEFAULT_SEMANTIC_THRESHOLD = 0.45;
export const KANNADA_THRESHOLD_MARGIN = 0.05;
/** Keyword-only hits whose vector similarity is below this are treated as coincidental term matches (off-topic ≈ 0.24, relevant ≥ 0.38). */
export const KEYWORD_SEMANTIC_FLOOR = 0.3;
export const DEFAULT_SEMANTIC_SCAN_LIMIT = 3000;
const RRF_K = 60;
const MAX_CHUNKS_PER_DOCUMENT = 2;

export function queryTerms(question: string): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  const specific = words.filter((word) => !LOW_INFORMATION.has(word));
  const expanded = expandTerms(question).flatMap((term) => term.split(/\s+/)).filter((word) => !LOW_INFORMATION.has(word));
  const terms = [...new Set([...(specific.length ? specific : words), ...expanded])];
  // Kannada inflected words rarely match the English corpus; keep them (harmless) but cap total terms.
  return terms.slice(0, 24);
}

/** FTS5 MATCH expression: each term quoted (no operator injection), OR-combined. */
export function ftsExpression(terms: string[]): string | null {
  const safe = terms.map((term) => term.replace(/"/g, "")).filter(Boolean);
  return safe.length ? safe.map((term) => `"${term}"`).join(" OR ") : null;
}

// --- int8 vector encoding shared with data-platform/documents (L2-normalise, round(v*127), clamp, base64) ---

export function quantizeEmbedding(vector: number[]): string {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  const bytes = new Uint8Array(vector.length);
  vector.forEach((value, index) => {
    const q = Math.max(-127, Math.min(127, Math.round((value / norm) * 127)));
    bytes[index] = q & 0xff;
  });
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

export function decodeEmbedding(encoded: string): Int8Array {
  const binary = atob(encoded);
  const bytes = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = (binary.charCodeAt(index) << 24) >> 24;
  return bytes;
}

/** Cosine similarity between an L2-normalised float query and an int8 chunk vector (scale 1/127). */
export function cosineQ8(query: Float32Array, chunk: Int8Array): number {
  if (query.length !== chunk.length) return -1;
  let dot = 0;
  let norm = 0;
  for (let index = 0; index < chunk.length; index += 1) {
    dot += query[index] * chunk[index];
    norm += chunk[index] * chunk[index];
  }
  return norm ? dot / Math.sqrt(norm) : -1;
}

function normalise(vector: number[]): Float32Array {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return Float32Array.from(vector, (value) => value / norm);
}

type ChunkRow = Omit<RetrievalHit, "matched_by" | "keyword_rank" | "semantic_similarity" | "score">;

const CHUNK_COLUMNS = `c.id AS chunk_id, c.document_id, d.title, d.publisher, d.document_type, c.language, d.source_url,
  d.publication_date, d.publication_date_basis, d.fetched_at, d.reuse_note, c.page_from, c.page_to, c.heading, c.text`;

function typeFilter(types: string[] | undefined, binds: unknown[]) {
  if (!types?.length) return "";
  binds.push(...types);
  return ` AND d.document_type IN (${types.map(() => "?").join(", ")})`;
}

export async function corpusStats(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM documents WHERE status = 'active') AS documents,
              (SELECT COUNT(*) FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.status = 'active') AS chunks,
              (SELECT COUNT(*) FROM document_chunks c JOIN documents d ON d.id = c.document_id
                 WHERE d.status = 'active' AND c.embedding_q8 IS NOT NULL) AS embedded_chunks`,
    )
    .first<{ documents: number; chunks: number; embedded_chunks: number }>();
  return { documents: row?.documents ?? 0, chunks: row?.chunks ?? 0, embedded_chunks: row?.embedded_chunks ?? 0 };
}

async function keywordSearch(db: D1Database, terms: string[], options: RetrievalOptions, limit: number) {
  const expression = ftsExpression(terms);
  if (!expression) return [];
  const binds: unknown[] = [expression];
  const filter = typeFilter(options.documentTypes, binds);
  binds.push(limit);
  const { results } = await db
    .prepare(
      `SELECT ${CHUNK_COLUMNS}, bm25(document_chunks_fts, 0.0, 2.0, 3.0, 1.0) AS bm25
       FROM document_chunks_fts f
       JOIN document_chunks c ON c.id = f.chunk_id
       JOIN documents d ON d.id = c.document_id
       WHERE document_chunks_fts MATCH ? AND d.status = 'active'${filter}
       ORDER BY bm25 LIMIT ?`,
    )
    .bind(...binds)
    .all<ChunkRow & { bm25: number }>();
  if (!results.length) return [];
  // bm25() is lower-is-better (negative). Drop weak tail matches relative to the best hit.
  const best = Math.abs(results[0].bm25) || 1;
  return results.filter((row) => Math.abs(row.bm25) >= best * 0.2);
}

async function semanticSearch(db: D1Database, query: Float32Array, options: RetrievalOptions, threshold: number, limit: number) {
  const binds: unknown[] = [CANONICAL_EMBEDDING_MODEL, query.length];
  const filter = typeFilter(options.documentTypes, binds);
  binds.push(options.semanticScanLimit ?? DEFAULT_SEMANTIC_SCAN_LIMIT);
  const { results } = await db
    .prepare(
      `SELECT c.id AS chunk_id, c.embedding_q8 FROM document_chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.embedding_model = ? AND c.embedding_dim = ? AND c.embedding_q8 IS NOT NULL AND d.status = 'active'${filter}
       LIMIT ?`,
    )
    .bind(...binds)
    .all<{ chunk_id: string; embedding_q8: string }>();
  const all = results.map((row) => ({ chunk_id: row.chunk_id, similarity: cosineQ8(query, decodeEmbedding(row.embedding_q8)) }));
  const similarities = new Map(all.map((row) => [row.chunk_id, row.similarity]));
  const scored = all
    .filter((row) => row.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  if (!scored.length) return { rows: [], similarities };
  const { results: rows } = await db
    .prepare(`SELECT ${CHUNK_COLUMNS} FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN (${scored.map(() => "?").join(", ")})`)
    .bind(...scored.map((row) => row.chunk_id))
    .all<ChunkRow>();
  const byId = new Map(rows.map((row) => [row.chunk_id, row]));
  return { rows: scored.flatMap((row) => (byId.has(row.chunk_id) ? [{ ...byId.get(row.chunk_id)!, similarity: row.similarity }] : [])), similarities };
}

export async function searchDocuments(db: D1Database, question: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const threshold = (options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD) + (/[\u0C80-\u0CFF]/.test(question) ? KANNADA_THRESHOLD_MARGIN : 0);
  const terms = queryTerms(question);
  const corpus = await corpusStats(db);
  const targets = diseasesNamed(question);
  const diseases = targets.map((target) => target.name);
  const empty = (semantic_status: RetrievalResult["semantic_status"], semantic_error: string | null = null): RetrievalResult => ({
    hits: [], withheld_pesticides: [], diseases, mode: "none", semantic_status, semantic_error, query_terms: terms, corpus,
  });
  if (!corpus.chunks) return empty(options.embedder ? "no_vectors" : "not_configured");

  let keyword = await keywordSearch(db, terms, options, 30);
  let semantic: (ChunkRow & { similarity: number })[] = [];
  let semanticStatus: RetrievalResult["semantic_status"] = "not_configured";
  let semanticError: string | null = null;
  if (options.embedder) {
    if (!corpus.embedded_chunks) semanticStatus = "no_vectors";
    else {
      try {
        const [vector] = await options.embedder.embed([question.slice(0, 2000)]);
        const result = await semanticSearch(db, normalise(vector), options, threshold, 30);
        semantic = result.rows;
        semanticStatus = "used";
        // Relevance filter: drop keyword matches that share only incidental words with the question.
        keyword = keyword.filter((row) => {
          const similarity = result.similarities.get(row.chunk_id);
          return similarity === undefined || similarity >= KEYWORD_SEMANTIC_FLOOR;
        });
      } catch (error) {
        semanticStatus = "failed";
        semanticError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const fused = new Map<string, RetrievalHit>();
  keyword.forEach((row, index) => {
    const { bm25: _bm25, ...chunk } = row;
    fused.set(row.chunk_id, { ...chunk, matched_by: ["keyword"], keyword_rank: index + 1, semantic_similarity: null, score: 1 / (RRF_K + index + 1) });
  });
  semantic.forEach((row, index) => {
    const { similarity, ...chunk } = row;
    const existing = fused.get(row.chunk_id);
    const contribution = 1 / (RRF_K + index + 1);
    if (existing) {
      existing.matched_by.push("semantic");
      existing.semantic_similarity = Number(similarity.toFixed(4));
      existing.score += contribution;
    } else {
      fused.set(row.chunk_id, { ...chunk, matched_by: ["semantic"], keyword_rank: null, semantic_similarity: Number(similarity.toFixed(4)), score: contribution });
    }
  });

  const fusedRanked = [...fused.values()].sort((a, b) => b.score - a.score);
  const ranked = targets.length
    ? fusedRanked.flatMap((hit) => {
      const text = focusOnDisease(hit.text, hit.heading, targets);
      return text ? [{ ...hit, text }] : [];
    })
    : fusedRanked;
  const inLanguage = options.language ? ranked.filter((hit) => hit.language === options.language) : ranked;
  const otherLanguage = options.language ? ranked.filter((hit) => hit.language !== options.language) : [];
  const preferred = options.language === "en" && inLanguage.length ? inLanguage : [...inLanguage, ...otherLanguage];
  const withheld = new Set<string>();
  const ordered = preferred.filter((hit) => {
    const named = restrictedPesticides(`${hit.heading ?? ""} ${hit.text}`);
    named.forEach((name) => withheld.add(name));
    return !named.length;
  });

  const perDocument = new Map<string, number>();
  const hits = ordered
    .filter((hit) => {
      const count = perDocument.get(hit.document_id) ?? 0;
      if (count >= MAX_CHUNKS_PER_DOCUMENT) return false;
      perDocument.set(hit.document_id, count + 1);
      return true;
    })
    .slice(0, limit)
    .map((hit) => ({ ...hit, score: Number(hit.score.toFixed(5)) }));

  const mode = keyword.length && semantic.length ? "hybrid" : keyword.length ? "keyword" : semantic.length ? "semantic" : "none";
  return { hits, withheld_pesticides: [...withheld], diseases, mode, semantic_status: semanticStatus, semantic_error: semanticError, query_terms: terms, corpus };
}

export function pageLabel(hit: Pick<RetrievalHit, "page_from" | "page_to">): string | null {
  if (hit.page_from == null) return null;
  return hit.page_to != null && hit.page_to !== hit.page_from ? `pp. ${hit.page_from}–${hit.page_to}` : `p. ${hit.page_from}`;
}

/** Rebuild the derived FTS index from document_chunks (after restore, or after D1 export dropped it). */
export async function rebuildFtsIndex(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(chunk_id UNINDEXED, title, heading, text, tokenize = 'unicode61 remove_diacritics 2')`),
    db.prepare(`DELETE FROM document_chunks_fts`),
    db.prepare(
      `INSERT INTO document_chunks_fts (chunk_id, title, heading, text)
       SELECT c.id, d.title, COALESCE(c.heading, ''), c.text FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.status = 'active'`,
    ),
  ]);
  const row = await db.prepare(`SELECT COUNT(*) AS rows FROM document_chunks_fts`).first<{ rows: number }>();
  return { indexed_chunks: row?.rows ?? 0 };
}
