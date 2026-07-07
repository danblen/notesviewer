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

const LS_KEY = 'nv_clone_last_path'

/** Read the last-used clone destination (or null). */
export function getLastPath() {
  return localStorage.getItem(LS_KEY)
}

/** Save the last-used clone destination. */
export function saveLastPath(p) {
  if (p) localStorage.setItem(LS_KEY, p)
}

/**
 * Check whether the clone server is reachable and git is installed.
 * Returns { ok: boolean, git?: string, error?: string }.
 */
export async function checkHealth() {
  try {
    const r = await fetch('/api/health')
    return await r.json()
  } catch {
    return { ok: false, error: '无法连接到克隆服务' }
  }
}

/**
 * Open the native OS folder picker and return the chosen path.
 * Returns { path: string } | { cancelled: true } | { error: string }.
 */
export async function pickFolder() {
  try {
    const r = await fetch('/api/pick-folder', { method: 'POST' })
    return await r.json()
  } catch {
    return { error: '无法打开文件夹选择器' }
  }
}

/**
 * Clone a GitHub repository via Server-Sent Events.
 *
 * @param {string} repo    — "owner/name" or full URL
 * @param {string} dest    — absolute destination path
 * @param {object} callbacks
 *   onProgress(text)  — called for each progress line
 *   onDone(path)      — called on successful completion
 *   onError(err)      — called on failure ({ message, suggestion })
 * @returns {function} cancel function to abort the clone
 */
export function cloneRepo(repo, dest, { onProgress, onDone, onError } = {}) {
  const params = new URLSearchParams({ repo, dest })
  const es = new EventSource(`/api/clone?${params}`)

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type === 'progress' && onProgress) {
        onProgress(data.text)
      } else if (data.type === 'done') {
        saveLastPath(dest)
        if (onDone) onDone(data.path)
        es.close()
      } else if (data.type === 'error') {
        if (onError) onError(data)
        es.close()
      }
    } catch {
      // ignore malformed events
    }
  }

  es.onerror = () => {
    if (onError) onError({ message: '连接中断', suggestion: '克隆服务可能已停止，请重启开发服务器' })
    es.close()
  }

  // Return a cancel function
  return () => es.close()
}

/**
 * Re-parse a raw progress/error text into a friendly error.
 * Used as a fallback when the server sends a generic error but the
 * accumulated log contains a recognisable pattern.
 */
export function parseErrorFromLog(log) {
  const t = (log || '').toLowerCase()
  if (/repository not found|not found/.test(t))
    return { message: '仓库不存在或无访问权限', suggestion: '请检查仓库名称，私有仓库需使用 Token 认证' }
  if (/permission denied \(publickey\)/.test(t))
    return { message: 'SSH 密钥认证失败', suggestion: '请配置 SSH Key，或改用 HTTPS + Token 方式克隆' }
  if (/could not read username|authentication failed|terminal prompts disabled/.test(t))
    return { message: '需要身份认证', suggestion: '私有仓库请使用 Token：https://<token>@github.com/owner/repo.git' }
  if (/already exists and is not an empty directory/.test(t))
    return { message: '目标目录已存在且非空', suggestion: '请选择一个空目录或更换路径' }
  if (/could not resolve host|unable to access/.test(t))
    return { message: '无法连接到 GitHub', suggestion: '请检查网络连接或代理设置' }
  if (/operation not permitted/.test(t))
    return { message: '系统拒绝了操作（macOS 权限限制）', suggestion: '请在系统设置 → 隐私与安全性 → 完全磁盘访问权限 中添加终端/Node，或在终端中手动运行 git clone' }
  return null
}
