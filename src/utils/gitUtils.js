/**
 * gitUtils.js — Git repository inspection & diff utilities.
 *
 * Supports two space modes:
 *  1. FSA (File System Access API, Chrome/Edge): uses isomorphic-git with a
 *     custom FileSystemDirectoryHandle → fs adapter.  Pure client-side.
 *  2. Server-backed (cloned repos): uses backend git CLI endpoints.
 *
 * Both produce the same shape of data so the UI component doesn't care
 * which mode it's in.
 */

import { apiUrl } from './apiConfig';
import ignore from 'ignore';

// Lazy-load isomorphic-git with its polyfills.
// CRITICAL: Buffer and process polyfills must NOT be set at module load time —
// setting globalThis.process before React renders causes other libraries
// (react-markdown, rehype-highlight, etc.) to detect "Node.js" and crash.
// We defer all polyfills to inside git() so they only run when git operations
// are actually invoked (well after the app has rendered).
let _git = null;
let _polyfillsReady = false;
async function ensurePolyfills() {
  if (_polyfillsReady) return;
  // isomorphic-git needs Buffer on globalThis
  if (typeof globalThis.Buffer === 'undefined') {
    const { Buffer } = await import('buffer');
    globalThis.Buffer = Buffer;
  }
  // isomorphic-git references process.platform for path handling
  if (typeof globalThis.process === 'undefined') {
    globalThis.process = { env: {}, platform: 'browser', browser: true };
  }
  _polyfillsReady = true;
}

async function git() {
  if (!_git) {
    await ensurePolyfills();
    _git = await import('isomorphic-git');
  }
  return _git;
}

// ============================================================
// FSA → isomorphic-git fs adapter
// ============================================================
// Wraps a FileSystemDirectoryHandle (the repo root) so isomorphic-git's
// callback-style fs calls resolve paths inside it.
//
// isomorphic-git receives `dir: '.'` and internally builds paths like
// `.git/HEAD` or `src/App.jsx`.  This adapter splits those POSIX paths
// and traverses directory handles to reach the target entry.

function normalizePath(p) {
  // Remove leading ./ or / and trailing /
  let s = p.replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
  return s;
}

function createFsaFs(rootHandle) {
  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  // Normalise a path: drop leading "./" or "/" and trailing "/"
  function normalizePath(p) {
    if (!p) return '';
    return String(p).replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
  }

  // Traverse to the parent directory, return { parent, name }
  async function traverseToParent(filePath) {
    const clean = normalizePath(filePath);
    if (!clean) return { parent: rootHandle, name: '' };
    const parts = clean.split('/');
    let dir = rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    return { parent: dir, name: parts[parts.length - 1] };
  }

  // Read a file as ArrayBuffer via the FSA handle
  async function readFileBuffer(filePath) {
    const { parent, name } = await traverseToParent(filePath);
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    return file.arrayBuffer();
  }

  // Stat helper
  function makeStat(isDir, size, mtime) {
    return {
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isSymbolicLink: () => false,
      size: size || 0,
      mtimeMs: mtime || 0,
      mtime: mtime ? new Date(mtime) : new Date(0),
      atimeMs: mtime || 0,
      ctimeMs: mtime || 0,
      birthtimeMs: mtime || 0,
    };
  }

  // -------------------------------------------------------------
  // Promises-style adapter
  //
  // isomorphic-git's FileSystem constructor checks `promises.enumerable`.
  // If true, it uses fs.promises.* (promises-style) — which is far more
  // reliable than pify-wrapped callbacks. We therefore implement the
  // adapter as a promises API and expose it via an enumerable property.
  // -------------------------------------------------------------

  const promises = {
    readFile: async (filePath, options) => {
      const buf = await readFileBuffer(filePath);
      const buffer = Buffer.from(buf);
      // isomorphic-git's FileSystem.read passes through { encoding, autocrlf }
      // and expects a string back when encoding is set. Honour it.
      if (options && options.encoding) {
        return buffer.toString(options.encoding);
      }
      return buffer;
    },

    readdir: async (dirPath) => {
      const clean = normalizePath(dirPath);
      const parts = clean ? clean.split('/') : [];
      let dir = rootHandle;
      for (const p of parts) dir = await dir.getDirectoryHandle(p);
      const entries = [];
      for await (const entry of dir.values()) {
        entries.push(entry.name);
      }
      return entries;
    },

    stat: async (filePath) => {
      const clean = normalizePath(filePath);
      if (!clean) return makeStat(true, 0, 0);
      const { parent, name } = await traverseToParent(filePath);
      try {
        const fh = await parent.getFileHandle(name);
        const file = await fh.getFile();
        return makeStat(false, file.size, file.lastModified);
      } catch {
        try {
          await parent.getDirectoryHandle(name);
          return makeStat(true, 0, 0);
        } catch {
          // Neither a file nor a directory — not accessible
          return makeStat(false, 0, 0);
        }
      }
    },

    lstat: async (filePath) => {
      // No symlinks in FSA — same as stat
      return promises.stat(filePath);
    },

    readlink: async () => {
      throw new Error('ENOSYS: readlink not supported');
    },

    writeFile: async () => {
      throw new Error('Read-only fs adapter');
    },
    mkdir: async () => {
      throw new Error('Read-only fs adapter');
    },
    rmdir: async () => {
      throw new Error('Read-only fs adapter');
    },
    unlink: async () => {
      throw new Error('Read-only fs adapter');
    },
    symlink: async () => {
      throw new Error('ENOSYS: symlink not supported');
    },
  };

  // -------------------------------------------------------------
  // Top-level fs object
  // isomorphic-git calls `fs.readFile()` (no args) once during init
  // to detect whether the adapter is promises-style. Return a Promise
  // so it takes the promises path.
  // -------------------------------------------------------------

  const fs = {
    // No-arg probe → must return a Promise (thenable) so isPromiseFs
    // picks the promises path.
    readFile: () => Promise.reject(new Error('probe')),
    readdir: () => Promise.reject(new Error('probe')),
    stat: () => Promise.reject(new Error('probe')),
    lstat: () => Promise.reject(new Error('probe')),
    readlink: () => Promise.reject(new Error('probe')),
    writeFile: () => Promise.reject(new Error('probe')),
    mkdir: () => Promise.reject(new Error('probe')),
    rmdir: () => Promise.reject(new Error('probe')),
    unlink: () => Promise.reject(new Error('probe')),
    symlink: () => Promise.reject(new Error('probe')),
  };

  // CRITICAL: promises must be ENUMERABLE so isomorphic-git's FileSystem
  // constructor uses fs.promises.* (promises path) instead of trying to
  // pify our top-level callback functions.
  Object.defineProperty(fs, 'promises', {
    value: promises,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  fs.Buffer = Buffer;

  return fs;
}

// ============================================================
// Git repo detection
// ============================================================

/**
 * Check if a FSA directory handle is a git repo (has a `.git` entry).
 */
export async function isGitRepoFsa(rootHandle) {
  if (!rootHandle) return false;
  try {
    await rootHandle.getDirectoryHandle('.git');
    return true;
  } catch (e1) {
    // .git might be a file (worktree/submodule) — try as file
    try {
      await rootHandle.getFileHandle('.git');
      return true;
    } catch (e2) {
      // Final fallback: iterate root entries and look for .git
      try {
        for await (const entry of rootHandle.values()) {
          if (entry.name === '.git') return true;
        }
      } catch { /* ignore */ }
      return false;
    }
  }
}

/**
 * Check if a server-backed path is a git repo.
 */
export async function isGitRepoServer(serverRoot) {
  if (!serverRoot) return false;
  try {
    const r = await fetch(apiUrl(`/api/git-status?path=${encodeURIComponent(serverRoot)}`));
    if (!r.ok) return false;
    const data = await r.json();
    return data.isRepo === true;
  } catch {
    return false;
  }
}

// ============================================================
// Get current branch name
// ============================================================

export async function getBranchFsa(rootHandle) {
  try {
    const g = await git();
    const branch = await g.currentBranch({
      fs: createFsaFs(rootHandle),
      dir: '.',
      fullname: false,
    });
    return branch || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

export async function getBranchServer(serverRoot) {
  try {
    const r = await fetch(apiUrl(`/api/git-status?path=${encodeURIComponent(serverRoot)}`));
    if (!r.ok) return 'HEAD';
    const data = await r.json();
    return data.branch || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

// ============================================================
// Build HEAD tree map (path → blob oid) for FSA
// ============================================================

async function buildHeadTreeMapFsa(g, fs) {
  const map = new Map();
  try {
    const commits = await g.log({ fs, dir: '.', depth: 1 });
    if (commits.length === 0) return map;
    const headOid = commits[0].oid;
    const { commit } = await g.readCommit({ fs, dir: '.', oid: headOid });

    async function walkTree(treeOid, prefix) {
      const { tree } = await g.readTree({ fs, dir: '.', oid: treeOid });
      for (const entry of tree) {
        const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === 'tree') {
          await walkTree(entry.oid, fullPath);
        } else if (entry.type === 'blob') {
          map.set(fullPath, entry.oid);
        }
      }
    }
    await walkTree(commit.tree, '');
  } catch (err) {
    // No commits yet, or error reading — return empty map
  }
  return map;
}

// ============================================================
// Get changed files (status)
// ============================================================

/**
 * Read .gitignore from the repo root and build an ignore filter.
 * Uses the `ignore` npm package — a proven open-source .gitignore parser.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<Object>} an `ignore` instance
 */
async function createIgnoreFilter(rootHandle) {
  const ig = ignore();
  try {
    const fh = await rootHandle.getFileHandle('.gitignore');
    const file = await fh.getFile();
    const text = await file.text();
    ig.add(text);
  } catch {
    // No .gitignore — empty filter
  }
  return ig;
}

/**
 * Recursively walk the working directory, collecting all file paths.
 * Skips the .git directory and any directory matched by the ignore filter.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {Object} ig — ignore instance
 * @param {string} prefix — path prefix (for recursion)
 * @returns {Promise<string[]>} array of file paths relative to repo root
 */
async function walkWorkingDirectory(dirHandle, ig, prefix = '') {
  const files = [];
  for await (const entry of dirHandle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (entry.name === '.git') continue;
      // Skip ignored directories (check with trailing slash for dir patterns)
      if (ig.ignores(path + '/')) continue;
      files.push(...await walkWorkingDirectory(entry, ig, path));
    } else if (entry.kind === 'file') {
      if (ig.ignores(path)) continue;
      files.push(path);
    }
  }
  return files;
}

/**
 * Read raw bytes of a file from the FSA root handle.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filepath — path relative to repo root
 * @returns {Promise<Uint8Array>}
 */
async function readFileBytesFsa(rootHandle, filepath) {
  const clean = filepath.replace(/^\.\//, '');
  const parts = clean.split('/');
  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fh.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/** Compare two Uint8Arrays for equality. */
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * @typedef {Object} GitChange
 * @property {string} path     — file path relative to repo root
 * @property {string} name     — file name (last segment)
 * @property {string} status   — 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
 */

/**
 * Get changed files for a FSA-backed space.
 *
 * Replaces the unreliable `statusMatrix` with a direct approach:
 *   1. Read HEAD tree via isomorphic-git (log → readCommit → readTree)
 *   2. Walk the working directory via FSA API
 *   3. Filter via `ignore` npm package for .gitignore support
 *   4. For tracked files: compare actual bytes (HEAD blob vs workdir file)
 *   5. For untracked files: filter against .gitignore
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<{changes: GitChange[], branch: string, headTreeMap: Map, fs: Object}>}
 */
export async function getGitStatusFsa(rootHandle) {
  const g = await git();
  const fs = createFsaFs(rootHandle);

  // Get branch name
  let branch = 'HEAD';
  try {
    branch = await g.currentBranch({ fs, dir: '.', fullname: false }) || 'HEAD';
  } catch { /* ignore */ }

  // Build HEAD tree map (path → blob oid) — used for both status & diff
  const headTreeMap = await buildHeadTreeMapFsa(g, fs);

  // Build .gitignore filter using the `ignore` package
  const ig = await createIgnoreFilter(rootHandle);

  // Walk the working directory (skips .git and ignored dirs)
  let workdirFiles = [];
  try {
    workdirFiles = await walkWorkingDirectory(rootHandle, ig);
  } catch (err) {
    console.error('[gitUtils] walkWorkingDirectory failed:', err);
    return { changes: [], branch, headTreeMap, fs };
  }

  const changes = [];
  const workdirSet = new Set(workdirFiles);

  // 1. Check tracked files (in HEAD) for modifications or deletions
  for (const [filepath, blobOid] of headTreeMap) {
    const inWorkdir = workdirSet.has(filepath);
    if (!inWorkdir) {
      // File in HEAD but not in working directory → deleted
      const name = filepath.includes('/') ? filepath.slice(filepath.lastIndexOf('/') + 1) : filepath;
      changes.push({ path: filepath, name, status: 'deleted' });
      continue;
    }

    // Compare actual bytes: HEAD blob vs working directory file
    try {
      const { blob } = await g.readBlob({ fs, dir: '.', oid: blobOid });
      const headBytes = new Uint8Array(blob);
      const workdirBytes = await readFileBytesFsa(rootHandle, filepath);

      // Only report as modified if bytes actually differ
      if (!bytesEqual(headBytes, workdirBytes)) {
        const name = filepath.includes('/') ? filepath.slice(filepath.lastIndexOf('/') + 1) : filepath;
        changes.push({ path: filepath, name, status: 'modified' });
      }
    } catch {
      // If we can't read either version, skip
    }
  }

  // 2. Check for untracked files (in workdir but not in HEAD)
  for (const filepath of workdirFiles) {
    if (headTreeMap.has(filepath)) continue; // already tracked
    if (ig.ignores(filepath)) continue;      // double-check .gitignore

    const name = filepath.includes('/') ? filepath.slice(filepath.lastIndexOf('/') + 1) : filepath;
    changes.push({ path: filepath, name, status: 'added' });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { changes, branch, headTreeMap, fs };
}

/**
 * Get changed files for a server-backed space.
 * @param {string} serverRoot — absolute disk path
 * @returns {Promise<{changes: GitChange[], branch: string}>}
 */
export async function getGitStatusServer(serverRoot) {
  const r = await fetch(apiUrl(`/api/git-status?path=${encodeURIComponent(serverRoot)}`));
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || '无法获取 Git 状态');
  }
  const data = await r.json();
  return {
    changes: (data.changes || []).map((c) => ({
      path: c.path,
      name: c.path.includes('/') ? c.path.slice(c.path.lastIndexOf('/') + 1) : c.path,
      status: c.status,
    })),
    branch: data.branch || 'HEAD',
  };
}

// ============================================================
// Get diff content (old + new text) for a single file
// ============================================================

const MAX_DIFF_FILE_SIZE = 512 * 1024; // 512 KB — skip huge files

/**
 * Get diff content for a FSA-backed file.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filepath — path relative to repo root
 * @param {Map} headTreeMap — from getGitStatusFsa (path → blob oid)
 * @param {Object} fs — the FSA fs adapter (reused from status call)
 * @returns {Promise<{oldText: string, newText: string, status: string}>}
 */
export async function getFileDiffFsa(rootHandle, filepath, headTreeMap, fs, status) {
  const g = await git();

  // Read old (HEAD) version
  let oldText = '';
  if (status !== 'added' && status !== 'untracked') {
    const blobOid = headTreeMap?.get(filepath);
    if (blobOid) {
      try {
        const { blob } = await g.readBlob({ fs, dir: '.', oid: blobOid });
        oldText = new TextDecoder('utf-8', { fatal: false }).decode(blob);
      } catch { /* blob unreadable */ }
    }
  }

  // Read new (working tree) version
  let newText = '';
  if (status !== 'deleted') {
    try {
      // Navigate to the file via FSA handle
      const clean = filepath.replace(/^\.\//, '');
      const parts = clean.split('/');
      let dir = rootHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1]);
      const file = await fh.getFile();
      if (file.size <= MAX_DIFF_FILE_SIZE) {
        newText = await file.text();
      } else {
        newText = '(文件过大，已跳过)';
      }
    } catch { /* file unreadable */ }
  }

  return { oldText, newText, status };
}

/**
 * Get diff content for a server-backed file.
 * @param {string} serverRoot — absolute disk path
 * @param {string} filepath — path relative to repo root
 * @param {string} status
 * @returns {Promise<{oldText: string, newText: string, status: string}>}
 */
export async function getFileDiffServer(serverRoot, filepath, status) {
  const r = await fetch(apiUrl(
    `/api/git-diff?path=${encodeURIComponent(serverRoot)}&file=${encodeURIComponent(filepath)}`
  ));
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || '无法获取 diff');
  }
  const data = await r.json();
  return { oldText: data.oldText || '', newText: data.newText || '', status };
}

// ============================================================
// Build a tree structure from flat changed-file paths
// (for rendering in the GitDiffPanel)
// ============================================================

/**
 * @typedef {Object} GitTreeNode
 * @property {string} name
 * @property {string} path
 * @property {'directory'|'file'} kind
 * @property {string} [status]   — only for files
 * @property {GitTreeNode[]} [children]
 */

/**
 * Convert a flat list of changed files into a nested tree.
 * Files at the same level are sorted: directories first, then files.
 */
export function buildChangeTree(changes) {
  const root = { name: '', path: '', kind: 'directory', children: [] };

  for (const change of changes) {
    const parts = change.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');

      if (isLeaf) {
        current.children.push({
          name: part,
          path: childPath,
          kind: 'file',
          status: change.status,
        });
      } else {
        let dir = current.children.find(
          c => c.kind === 'directory' && c.name === part
        );
        if (!dir) {
          dir = { name: part, path: childPath, kind: 'directory', children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  // Sort each level: directories first (alpha), then files (alpha)
  function sortNode(node) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    });
    node.children.forEach(sortNode);
  }
  sortNode(root);

  return root.children;
}
