/**
 * rag-engine.cjs — per-space Retrieval-Augmented Generation.
 *
 * Provides three HTTP handlers, wired up by clone-server.cjs:
 *   POST /api/rag/index   — SSE: (re)build the vector index for a space
 *   POST /api/rag/query   — SSE: retrieve context + stream an AI answer
 *   GET  /api/rag/status  — index metadata for a space
 *   POST /api/rag/clear   — delete a space's index
 *
 * Two indexing modes (a space is identified by an opaque `key`):
 *   - Server-backed space: body carries { path } (absolute repo path);
 *     the engine walks the disk itself.
 *   - Browser (FSA) space:  body carries { documents:[{path,name,content}] };
 *     the browser reads files and ships their text here.
 *
 * Embeddings + chat go through an OpenAI-compatible API. The client sends
 * its own { apiBase, apiKey, embedModel, chatModel } with every request —
 * the API key is NEVER persisted on the server. Only vectors + text are
 * cached, under notesview2/.notesview-rag/<sha1(key)>.json.
 *
 * No external dependencies — pure Node.js built-ins.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_DIR = path.join(__dirname, '..', '.notesview-rag');

const MAX_INDEX_FILE_SIZE = 512 * 1024;   // skip files larger than this
const MAX_CHUNKS = 6000;                   // hard cap to bound cost/memory
const CHUNK_MAX_CHARS = 1200;              // ~300 tokens per chunk
const EMBED_BATCH = 10;                     // texts per embeddings request (通义/DashScope caps batches)
const TOP_K = 6;                           // chunks fed to the model
const CONTEXT_SNIPPET = 320;               // citation snippet length
const API_TIMEOUT = 60_000;

// Directories always skipped while walking a server-backed space.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.turbo', '.parcel-cache', '.notesview-rag',
  '.svelte-kit', '.vercel', '.deno', '.gradle', '.idea', '.vscode',
  'out', '.output', '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'bower_components', 'jspm_packages',
]);

// File extensions worth indexing (text / notes / code).
const INDEXABLE_EXTS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'org', 'text', 'log', 'csv',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'yml', 'yaml',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'vue', 'svelte',
  'py', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'swift', 'c', 'h',
  'cpp', 'cc', 'hpp', 'cs', 'sh', 'bash', 'sql', 'toml', 'ini',
]);

// ── Small HTTP helpers ────────────────────────────────────

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...CORS_HEADERS,
  });
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); }
      catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Index cache ───────────────────────────────────────────

function hashKey(key) {
  return crypto.createHash('sha1').update(String(key)).digest('hex');
}

function indexPathFor(key) {
  return path.join(CACHE_DIR, `${hashKey(key)}.json`);
}

function loadIndex(key) {
  try {
    const raw = fs.readFileSync(indexPathFor(key), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveIndex(key, index) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(indexPathFor(key), JSON.stringify(index));
}

// ── Config validation ─────────────────────────────────────

function validateConfig(config, need = 'embed') {
  if (!config || typeof config !== 'object') return '缺少模型配置';
  const e = pickEmbed(config);
  if (!e.base) return '缺少向量模型接口地址';
  if (!e.key) return '缺少向量模型 API Key';
  if (!e.model) return '缺少向量模型名称';
  if (need === 'both') {
    const c = pickChat(config);
    if (!c.base) return '缺少对话模型接口地址';
    if (!c.key) return '缺少对话模型 API Key';
    if (!c.model) return '缺少对话模型名称';
  }
  return null;
}

// Embedding + chat may point at different OpenAI-compatible providers
// (e.g. embeddings via OpenAI/SiliconFlow, chat via DeepSeek). Legacy
// single-provider configs (apiBase/apiKey) are accepted as a fallback.
function pickEmbed(config) {
  return {
    base: config.embedBase || config.apiBase,
    key: config.embedKey || config.apiKey,
    model: config.embedModel,
  };
}
function pickChat(config) {
  return {
    base: config.chatBase || config.apiBase,
    key: config.chatKey || config.apiKey,
    model: config.chatModel || 'gpt-4o-mini',
  };
}

function normaliseBase(apiBase) {
  return String(apiBase).trim().replace(/\/+$/, '');
}

// ── OpenAI-compatible API calls ───────────────────────────

/** POST JSON to an absolute URL, resolving parsed JSON (or rejecting). */
function apiPost(urlStr, apiKey, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { reject(new Error('API 地址无效')); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const payload = JSON.stringify(body);
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: API_TIMEOUT,
    }, (r) => {
      let data = '';
      r.on('data', (d) => data += d);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          reject(new Error(`API 返回 ${r.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('API 响应解析失败')); }
      });
    });
    req.on('error', (e) => reject(new Error(`API 请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('API 请求超时')); });
    req.end(payload);
  });
}

/** Embed a batch of texts → array of vectors (same order). */
async function embedBatch(config, inputs) {
  const e = pickEmbed(config);
  const url = `${normaliseBase(e.base)}/embeddings`;
  let resp;
  try {
    resp = await apiPost(url, e.key, { model: e.model, input: inputs });
  } catch (err) {
    // Some providers cap batch size (e.g. 通义/DashScope ≤ 10). Halve and retry.
    if (/batch size|too many|exceed/i.test(err.message) && inputs.length > 1) {
      const mid = Math.ceil(inputs.length / 2);
      const head = await embedBatch(config, inputs.slice(0, mid));
      const tail = await embedBatch(config, inputs.slice(mid));
      return [...head, ...tail];
    }
    if (/API 返回 404/.test(err.message)) {
      throw new Error(
        `向量接口 404：${url} 不存在，或该服务不提供 embeddings（例如 DeepSeek 没有向量模型）。` +
        `请在「向量模型」处单独填写支持 embeddings 的服务（如 OpenAI / SiliconFlow / 通义）。`
      );
    }
    throw err;
  }
  const data = (resp && resp.data) || [];
  // Sort by index defensively — some providers don't preserve order.
  return data
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

/**
 * Stream a chat completion, forwarding tokens via onToken(text).
 * Resolves with the full concatenated answer.
 */
function chatStream(config, messages, onToken) {
  return new Promise((resolve, reject) => {
    const c = pickChat(config);
    const urlStr = `${normaliseBase(c.base)}/chat/completions`;
    let u;
    try { u = new URL(urlStr); } catch { reject(new Error('API 地址无效')); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const payload = JSON.stringify({
      model: c.model,
      messages,
      stream: true,
      temperature: 0.2,
    });
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.key}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: API_TIMEOUT,
    }, (r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) {
        let errData = '';
        r.on('data', (d) => errData += d);
        r.on('end', () => reject(new Error(`API 返回 ${r.statusCode}: ${errData.slice(0, 300)}`)));
        return;
      }
      let full = '';
      let buf = '';
      r.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete tail
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payloadStr = t.slice(5).trim();
          if (payloadStr === '[DONE]') continue;
          try {
            const j = JSON.parse(payloadStr);
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) { full += delta; onToken(delta); }
          } catch { /* partial JSON — ignore */ }
        }
      });
      r.on('end', () => resolve(full));
      r.on('error', (e) => reject(new Error(`流式响应出错: ${e.message}`)));
    });
    req.on('error', (e) => reject(new Error(`API 请求失败: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('API 请求超时')); });
    req.end(payload);
  });
}

// ── Chunking ──────────────────────────────────────────────

/**
 * Split text into line-tracked chunks of at most CHUNK_MAX_CHARS.
 * Returns [{ text, startLine, endLine }] (1-based inclusive lines).
 */
function chunkText(text, maxChars = CHUNK_MAX_CHARS) {
  const lines = text.split('\n');
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let startLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (bufLen + line.length + 1 > maxChars && buf.length) {
      const body = buf.join('\n');
      if (body.trim()) chunks.push({ text: body, startLine, endLine: i });
      buf = [];
      bufLen = 0;
      startLine = i + 1;
    }
    buf.push(line);
    bufLen += line.length + 1;
  }
  if (buf.length) {
    const body = buf.join('\n');
    if (body.trim()) chunks.push({ text: body, startLine, endLine: lines.length });
  }
  return chunks;
}

function isIndexable(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return INDEXABLE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/** Recursively collect indexable files under a server-backed root. */
function collectDiskDocuments(root) {
  const docs = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDED_DIRS.has(e.name.toLowerCase())) walk(abs);
      } else if (e.isFile() && isIndexable(e.name)) {
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_INDEX_FILE_SIZE) continue;
          const content = fs.readFileSync(abs, 'utf-8');
          docs.push({
            path: path.relative(root, abs),
            name: e.name,
            content,
            serverPath: abs,
          });
        } catch { /* unreadable — skip */ }
      }
    }
  };
  walk(root);
  return docs;
}

// ── Vector math ───────────────────────────────────────────

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Handler: build index ──────────────────────────────────

async function handleIndex(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const { key, path: repoPath, documents, config } = body;
  if (!key) { sendJSON(res, 400, { error: '缺少 key' }); return; }
  const cfgErr = validateConfig(config);
  if (cfgErr) { sendJSON(res, 400, { error: cfgErr }); return; }

  // Resolve documents
  let docs;
  if (repoPath) {
    try {
      if (!fs.statSync(repoPath).isDirectory()) {
        sendJSON(res, 400, { error: '路径不是目录' }); return;
      }
    } catch { sendJSON(res, 400, { error: '路径不存在' }); return; }
    docs = collectDiskDocuments(repoPath);
  } else if (Array.isArray(documents)) {
    docs = documents
      .filter((d) => d && typeof d.content === 'string' && d.content.length <= MAX_INDEX_FILE_SIZE)
      .map((d) => ({ path: d.path, name: d.name || path.basename(d.path || ''), content: d.content, serverPath: null }));
  } else {
    sendJSON(res, 400, { error: '缺少 path 或 documents' }); return;
  }

  sseInit(res);
  let aborted = false;
  req.on('close', () => { aborted = true; });

  // Build the flat chunk list
  const pending = [];
  for (const doc of docs) {
    for (const c of chunkText(doc.content)) {
      pending.push({
        path: doc.path,
        name: doc.name,
        serverPath: doc.serverPath,
        text: c.text,
        startLine: c.startLine,
        endLine: c.endLine,
      });
      if (pending.length >= MAX_CHUNKS) break;
    }
    if (pending.length >= MAX_CHUNKS) break;
  }

  sseWrite(res, 'progress', {
    phase: 'start', files: docs.length, chunks: pending.length, embedded: 0,
  });

  if (pending.length === 0) {
    sseWrite(res, 'error', { message: '没有可索引的内容（未找到文本文件）' });
    res.end();
    return;
  }

  // Embed in batches
  const chunks = [];
  try {
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      if (aborted) return;
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(config, batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;
        chunks.push({ ...batch[j], id: chunks.length, embedding: vec });
      }
      sseWrite(res, 'progress', {
        phase: 'embedding', files: docs.length, chunks: pending.length,
        embedded: Math.min(i + EMBED_BATCH, pending.length),
      });
    }
  } catch (e) {
    sseWrite(res, 'error', { message: e.message });
    res.end();
    return;
  }

  if (aborted) return;

  const fileCount = new Set(chunks.map((c) => c.path)).size;
  const index = {
    version: 1,
    key,
    embedModel: config.embedModel,
    updatedAt: Date.now(),
    fileCount,
    chunks,
  };
  try { saveIndex(key, index); }
  catch (e) { sseWrite(res, 'error', { message: `写入索引失败: ${e.message}` }); res.end(); return; }

  sseWrite(res, 'done', { chunks: chunks.length, files: fileCount, updatedAt: index.updatedAt });
  res.end();
}

// ── Handler: query ────────────────────────────────────────

function buildPrompt(question, hits) {
  const contextBlocks = hits.map((h, i) =>
    `[${i + 1}] 来源: ${h.path} (第 ${h.startLine}-${h.endLine} 行)\n${h.text}`
  ).join('\n\n---\n\n');

  const system = [
    '你是一个笔记问答助手。请只依据下面提供的「上下文」回答用户的问题。',
    '要求：',
    '1. 用简洁清晰的中文回答。',
    '2. 在引用具体信息时，用 [编号] 标注来源，例如 [1]、[2]。',
    '3. 如果上下文中没有相关信息，请明确说明「根据当前笔记内容无法回答该问题」，不要编造。',
  ].join('\n');

  const user = `上下文：\n\n${contextBlocks}\n\n---\n\n问题：${question}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function handleQuery(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }

  const { key, question, config } = body;
  if (!key) { sendJSON(res, 400, { error: '缺少 key' }); return; }
  if (!question || !question.trim()) { sendJSON(res, 400, { error: '问题不能为空' }); return; }
  const cfgErr = validateConfig(config, 'both');
  if (cfgErr) { sendJSON(res, 400, { error: cfgErr }); return; }

  const index = loadIndex(key);
  if (!index || !index.chunks || index.chunks.length === 0) {
    sendJSON(res, 404, { error: '该空间尚未建立索引，请先建立索引' });
    return;
  }

  sseInit(res);

  // Embed the question
  let qVec;
  try {
    const [v] = await embedBatch(config, [question]);
    qVec = v;
  } catch (e) {
    sseWrite(res, 'error', { message: `问题向量化失败: ${e.message}` });
    res.end();
    return;
  }
  if (!qVec) { sseWrite(res, 'error', { message: '问题向量化失败' }); res.end(); return; }

  // Rank chunks by cosine similarity
  const scored = index.chunks.map((c) => ({ c, score: cosineSim(qVec, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, TOP_K).map(({ c, score }) => ({
    id: c.id, path: c.path, name: c.name, serverPath: c.serverPath || null,
    startLine: c.startLine, endLine: c.endLine, text: c.text, score,
  }));

  // Stream the answer
  try {
    await chatStream(config, buildPrompt(question, hits), (tok) => {
      sseWrite(res, 'token', { text: tok });
    });
  } catch (e) {
    sseWrite(res, 'error', { message: e.message });
    res.end();
    return;
  }

  // Emit citations (dedupe by path+line range, preserve rank order)
  const seen = new Set();
  const citations = [];
  for (const h of hits) {
    const tag = `${h.path}:${h.startLine}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    citations.push({
      n: h.id, path: h.path, name: h.name, serverPath: h.serverPath,
      startLine: h.startLine, endLine: h.endLine,
      snippet: h.text.slice(0, CONTEXT_SNIPPET),
      score: Math.round(h.score * 1000) / 1000,
    });
  }
  // Re-number citations to match [1..N] used in the prompt
  citations.forEach((c, i) => { c.n = i + 1; });

  sseWrite(res, 'citations', { citations });
  sseWrite(res, 'done', {});
  res.end();
}

// ── Handler: status ───────────────────────────────────────

function handleStatus(res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const key = params.get('key');
  if (!key) { sendJSON(res, 400, { error: '缺少 key' }); return; }
  const index = loadIndex(key);
  if (!index) { sendJSON(res, 200, { exists: false }); return; }
  sendJSON(res, 200, {
    exists: true,
    chunks: index.chunks.length,
    files: index.fileCount,
    embedModel: index.embedModel,
    updatedAt: index.updatedAt,
  });
}

// ── Handler: clear ────────────────────────────────────────

async function handleClear(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { sendJSON(res, 400, { error: e.message }); return; }
  const { key } = body;
  if (!key) { sendJSON(res, 400, { error: '缺少 key' }); return; }
  try { fs.unlinkSync(indexPathFor(key)); } catch { /* already gone */ }
  sendJSON(res, 200, { ok: true });
}

module.exports = { handleIndex, handleQuery, handleStatus, handleClear };
