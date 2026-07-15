/**
 * rag.js — client helpers for the per-space RAG backend.
 *
 * Indexing / querying always go through the local clone-server
 * (see server/rag-engine.cjs). Server-backed spaces are indexed by path;
 * browser (FSA) spaces ship their file contents to the backend.
 */

import { apiUrl } from './apiConfig';

/**
 * Stable index key for a space:
 *  - server-backed (cloned repo): the absolute disk path
 *  - browser FSA space: `fsa:<spaceId>`
 */
export function getSpaceKey({ serverRoot, spaceId, rootName }) {
  if (serverRoot) return serverRoot;
  if (spaceId) return `fsa:${spaceId}`;
  if (rootName) return `fsa:name:${rootName}`;
  return null;
}

/**
 * Parse an SSE stream from a fetch Response body, dispatching each event to
 * handlers[eventName]({...data}). Resolves when the stream ends.
 */
async function readSSE(response, handlers, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    if (signal?.aborted) { reader.cancel().catch(() => {}); return; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Split into complete SSE records (separated by blank lines)
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const record = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = 'message';
      let dataStr = '';
      for (const line of record.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!dataStr) continue;
      let data;
      try { data = JSON.parse(dataStr); } catch { data = {}; }
      handlers[event]?.(data);
    }
  }
}

/** POST JSON and return the raw Response (for SSE streaming). */
function postStream(path, body, signal) {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Build (or rebuild) the index for a space.
 * Pass either { serverRoot } (server-backed) or { documents } (FSA).
 * @returns {Promise<{chunks, files, updatedAt}>}
 */
export async function buildRagIndex({ key, serverRoot, documents, config, onProgress, signal }) {
  const body = serverRoot
    ? { key, path: serverRoot, config }
    : { key, documents, config };

  const resp = await postStream('/api/rag/index', body, signal);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `索引请求失败 (${resp.status})`);
  }

  return new Promise((resolve, reject) => {
    let result = null;
    readSSE(resp, {
      progress: (d) => onProgress?.(d),
      done: (d) => { result = d; },
      error: (d) => reject(new Error(d.message || '索引失败')),
    }, signal).then(() => {
      if (result) resolve(result);
      else if (!signal?.aborted) reject(new Error('索引未完成'));
    }).catch(reject);
  });
}

/**
 * Ask a question against a space's index. Streams answer tokens via
 * onToken(text); onCitations(citations[]) fires once at the end.
 * @returns {Promise<void>}
 */
export async function queryRag({ key, question, config, onToken, onCitations, signal }) {
  const resp = await postStream('/api/rag/query', { key, question, config }, signal);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `查询请求失败 (${resp.status})`);
  }

  return new Promise((resolve, reject) => {
    let errored = false;
    readSSE(resp, {
      token: (d) => { if (d.text) onToken?.(d.text); },
      citations: (d) => onCitations?.(d.citations || []),
      error: (d) => { errored = true; reject(new Error(d.message || '查询失败')); },
      done: () => { if (!errored) resolve(); },
    }, signal).then(() => { if (!errored) resolve(); }).catch(reject);
  });
}

/** Fetch index metadata for a space. */
export async function getRagStatus(key) {
  try {
    const r = await fetch(apiUrl(`/api/rag/status?key=${encodeURIComponent(key)}`));
    if (!r.ok) return { exists: false };
    return await r.json();
  } catch {
    return { exists: false, offline: true };
  }
}

/** Delete a space's index. */
export async function clearRagIndex(key) {
  try {
    await fetch(apiUrl('/api/rag/clear'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  } catch { /* ignore */ }
}
