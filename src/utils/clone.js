/**
 * clone.js — client-side helpers for the git-clone backend service.
 *
 * Three operations:
 *   checkHealth()    → verify the server + git are available
 *   cloneRepo(...)   → SSE stream with live progress callbacks
 *   pickFolder()     → trigger the native OS folder picker
 *
 * Last download path is persisted in localStorage.
 */

import { apiUrl, getServerUrl, setServerUrl, isDev } from './apiConfig';

// Where a locally-running clone server listens by default. Used as an
// automatic fallback for static HTTPS deployments (e.g. GitHub Pages) that
// have no same-origin backend.
const LOCAL_FALLBACK = 'http://localhost:5181';

/** Search GitHub repositories via the clone server proxy. */
export async function searchRepos(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const r = await fetch(apiUrl(`/api/search-github?q=${encodeURIComponent(query.trim())}`));
    return (await r.json()).items || [];
  } catch {
    return [];
  }
}

const LS_KEY = 'nv_clone_last_path';

export function getLastPath() {
  return localStorage.getItem(LS_KEY);
}

export function saveLastPath(p) {
  if (p) localStorage.setItem(LS_KEY, p);
}

export async function checkHealth() {
  // 1) Try the currently-configured base (dev proxy, same-origin nginx, or a
  //    user-set override).
  try {
    const r = await fetch(apiUrl('/api/health'));
    const data = await r.json();
    if (data && data.ok) return data;
  } catch { /* fall through to the local-server probe */ }

  // 2) Static HTTPS deployments have no same-origin backend. When not in dev
  //    and no explicit override is set, probe the user's local clone server
  //    directly; on success, remember it so clone/search/pick-folder target
  //    it too. (localStorage is per-origin, so this won't leak to other
  //    deployments opened in the same browser.)
  if (!isDev() && !getServerUrl()) {
    try {
      const r = await fetch(`${LOCAL_FALLBACK}/api/health`);
      const data = await r.json();
      if (data && data.ok) {
        setServerUrl(LOCAL_FALLBACK);
        return data;
      }
    } catch { /* local server not reachable */ }
  }

  return { ok: false, error: '无法连接到克隆服务' };
}

export async function pickFolder() {
  try {
    const r = await fetch(apiUrl('/api/pick-folder'), { method: 'POST' });
    return await r.json();
  } catch {
    return { error: '无法打开文件夹选择器' };
  }
}

/**
 * Clone a GitHub repository via Server-Sent Events.
 *
 * @param {string} repo      — "owner/name" or full URL
 * @param {string} dest      — absolute destination path
 * @param {object} callbacks
 *   onProgress(text)  — called for each progress line
 *   onDone(path)      — called on successful completion
 *   onError(err)      — called on failure ({ message, suggestion })
 * @returns {function} cancel function to abort the clone
 */
export function cloneRepo(repo, dest, { onProgress, onDone, onError } = {}) {
  const params = new URLSearchParams({ repo, dest });
  const es = new EventSource(apiUrl(`/api/clone?${params}`));

  es.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (onProgress) onProgress(data.text);
    } catch { /* malformed event — ignore */ }
  });

  es.addEventListener('done', (e) => {
    try {
      const data = JSON.parse(e.data);
      saveLastPath(dest);
      es.close();
      if (onDone) onDone(data.path);
    } finally { es.close(); }
  });

  es.addEventListener('error', (e) => {
    try {
      if (e.data) {
        const data = JSON.parse(e.data);
        if (onError) onError(data);
      }
    } finally { es.close(); }
  });

  // Connection-level error (server down, network)
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      if (onError) onError({ message: '连接中断', suggestion: '克隆服务可能已停止，请重启开发服务器' });
      es.close();
    }
  };

  return () => es.close();
}

/**
 * Re-parse a raw progress/error text into a friendly error.
 * Used as a client-side fallback when the accumulated log contains
 * a recognisable pattern that the server didn't catch explicitly.
 * Must stay in sync with ERROR_PATTERNS in server/clone-server.cjs.
 */
export function parseErrorFromLog(log) {
  const t = (log || '').toLowerCase();
  if (/repository not found|not found/.test(t))
    return { message: '仓库不存在或无访问权限', suggestion: '请检查仓库名称，私有仓库需使用 Token 认证' };
  if (/permission denied \(publickey\)/.test(t))
    return { message: 'SSH 密钥认证失败', suggestion: '请配置 SSH Key，或改用 HTTPS + Token 方式克隆' };
  if (/could not read username|authentication failed|terminal prompts disabled/.test(t))
    return { message: '需要身份认证', suggestion: '私有仓库请使用 Token：https://<token>@github.com/owner/repo.git' };
  if (/already exists and is not an empty directory/.test(t))
    return { message: '目标目录已存在且非空', suggestion: '请选择一个空目录或更换路径' };
  if (/could not resolve host|unable to access/.test(t))
    return { message: '无法连接到 GitHub', suggestion: '请检查网络连接或代理设置' };
  if (/eacces|permission denied/.test(t) && !/publickey/.test(t))
    return { message: '没有目标目录的写入权限', suggestion: '请选择一个有权限的目录，或更换克隆位置' };
  if (/operation not permitted/.test(t))
    return { message: '系统拒绝了操作（macOS 权限限制）', suggestion: '请在系统设置 → 隐私与安全性 → 完全磁盘访问权限 中添加终端/Node，或在终端中手动运行 git clone' };
  if (/could not create leading directories/.test(t))
    return { message: '无法创建目标目录', suggestion: '路径无效或没有写入权限，请重新选择' };
  return null;
}
