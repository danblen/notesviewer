/**
 * ragConfig.js — persist the OpenAI-compatible API settings used by RAG.
 *
 * Embedding and chat are configured separately, because many providers only
 * offer one of the two (e.g. DeepSeek has chat models but NO embeddings,
 * while OpenAI / SiliconFlow / 通义 provide embeddings). Each block has its
 * own base URL, API key and model name.
 *
 * All values live only in this browser's localStorage and are sent to the
 * local clone-server with each request; they are never stored server-side.
 */

const LS_KEY = 'nv_rag_config';

const DEFAULTS = {
  // Embedding provider (must support the /embeddings endpoint)
  embedBase: 'https://api.openai.com/v1',
  embedKey: '',
  embedModel: 'text-embedding-3-small',
  // Chat provider (any OpenAI-compatible /chat/completions)
  chatBase: 'https://api.deepseek.com/v1',
  chatKey: '',
  chatModel: 'deepseek-chat',
};

export function getRagConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    // Migrate the legacy single-provider shape ({ apiBase, apiKey, ... }).
    if (stored.apiBase && !stored.embedBase) {
      stored.embedBase = stored.apiBase;
      stored.chatBase = stored.apiBase;
      if (stored.apiKey) {
        stored.embedKey = stored.apiKey;
        stored.chatKey = stored.apiKey;
      }
    }
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setRagConfig(config) {
  const merged = { ...getRagConfig(), ...config };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(merged));
  } catch { /* quota / private mode — ignore */ }
  return merged;
}

/** True when the embedding provider is fully configured (needed to index). */
export function isEmbedConfigured(config = getRagConfig()) {
  return Boolean(config.embedBase && config.embedKey && config.embedModel);
}

/** True when the chat provider is fully configured (needed to answer). */
export function isChatConfigured(config = getRagConfig()) {
  return Boolean(config.chatBase && config.chatKey && config.chatModel);
}

/** True when both embedding and chat providers are ready. */
export function isRagConfigured(config = getRagConfig()) {
  return isEmbedConfigured(config) && isChatConfigured(config);
}
