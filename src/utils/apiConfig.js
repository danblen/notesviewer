/**
 * apiConfig.js — resolve the clone-server API base URL.
 *
 * In development (Vite dev server) the proxy forwards /api → localhost:5015,
 * so we use relative URLs (empty base).
 *
 * In production with HTTPS (EC2 with nginx proxy), we also use relative URLs
 * so the browser doesn't block mixed content.
 *
 * In production over HTTP (GitHub Pages), there is no backend on the same origin,
 * so we point at the user's locally-running clone server
 * (default http://localhost:5015).
 */

const LS_KEY = 'nv_clone_server_url';
const DEFAULT_URL = 'http://localhost:5015';

/** True when running under the Vite dev server (proxy is available). */
export function isDev() {
  return Boolean(import.meta.env && import.meta.env.DEV);
}

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

/**
 * Return the configured server origin with no trailing slash.
 * Returns '' (relative URLs) in these cases:
 *  - Dev mode (Vite proxy handles /api)
 *  - Production served over HTTPS (nginx proxies /api on the same origin)
 * Otherwise returns the stored override or the default http://localhost:5015.
 */
export function getServerUrl() {
  const override = localStorage.getItem(LS_KEY);
  if (override) return normalizeUrl(override);
  if (isDev()) return '';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') return '';
  return DEFAULT_URL;
}

/** Persist (or clear, when empty) the server URL override. */
export function setServerUrl(url) {
  const trimmed = (url || '').trim();
  if (trimmed) {
    localStorage.setItem(LS_KEY, normalizeUrl(trimmed));
  } else {
    localStorage.removeItem(LS_KEY);
  }
}

/**
 * Build a full API URL from a path that begins with '/api/...'.
 * In dev or HTTPS production, this returns the path unchanged (relative → nginx proxy).
 */
export function apiUrl(path) {
  const base = getServerUrl();
  return base ? base + path : path;
}

/** Human-readable label for the currently active server origin. */
export function getServerLabel() {
  const url = getServerUrl();
  if (url) return url;
  if (isDev()) return '本地代理';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') return window.location.origin;
  return DEFAULT_URL;
}
