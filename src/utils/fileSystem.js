/**
 * File system utilities — supports File System Access API (Chrome/Edge)
 * with a webkitdirectory fallback for Safari/Firefox.
 */

// ── Code language map (extension → highlight.js language) ─────────
const CODE_LANG_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', json5: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'stylus',
  html: 'xml', htm: 'xml', xml: 'xml', xhtml: 'xml', vue: 'xml', svelte: 'xml',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini',
  py: 'python', pyw: 'python', pyi: 'python',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  go: 'go', goMod: 'go',
  rs: 'rust',
  rb: 'ruby', erb: 'ruby',
  php: 'php',
  swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ksh: 'bash',
  bat: 'dos', cmd: 'dos', ps1: 'powershell',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  pl: 'perl', pm: 'perl',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure',
  ex: 'elixir', exs: 'elixir',
  hs: 'haskell',
  elm: 'elm',
  ml: 'ocaml', mli: 'ocaml',
  proto: 'protobuf',
  diff: 'diff', patch: 'diff',
  md: 'markdown',
  dockerfile: 'dockerfile',
  makefile: 'makefile', mk: 'makefile', cmake: 'cmake',
  nginx: 'nginx',
  vim: 'vim',
  tf: 'haskell', // terraform not in common; fallback
  txt: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  env: 'bash',
};

// Special filenames (no extension or dotfiles)
const SPECIAL_FILE_LANG = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  cmakelists: 'cmake',
  '.gitignore': 'plaintext',
  '.dockerignore': 'plaintext',
  '.npmignore': 'plaintext',
  '.env': 'bash',
  '.editorconfig': 'ini',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
  '.babelrc': 'json',
};

export function getCodeLanguage(filename) {
  const base = filename.toLowerCase();
  if (SPECIAL_FILE_LANG[base]) return SPECIAL_FILE_LANG[base];
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    // No extension — check special names
    if (SPECIAL_FILE_LANG[base]) return SPECIAL_FILE_LANG[base];
    return 'plaintext';
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return CODE_LANG_MAP[ext] || 'plaintext';
}

// ── File type detection ──────────────────────────────────────────

export function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  const base = filename.toLowerCase();
  if (SPECIAL_FILE_LANG[base] || CODE_LANG_MAP[ext]) return 'code';
  return 'other';
}

// ── Sorting ──────────────────────────────────────────────────────

export function sortTreeNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });
}

// ── Tree node factory ────────────────────────────────────────────

function makeNode(name, kind, path, handle, file) {
  return {
    id: path,
    name,
    kind, // 'file' | 'directory'
    path,
    handle: handle ?? null,
    file: file ?? null,
    children: kind === 'directory' ? [] : null,
  };
}

// ── FSA API: verify permission ───────────────────────────────────

async function verifyPermission(dirHandle) {
  const opts = { mode: 'read' };
  if ((await dirHandle.queryPermission(opts)) === 'granted') return true;
  if ((await dirHandle.requestPermission(opts)) === 'granted') return true;
  return false;
}

// ── FSA API: single-level tree builder (lazy) ───────────────────
// Builds ONE level deep — directories get children=null (loaded on demand).
// Yields to the event loop every 200 entries to avoid blocking UI.

async function buildTreeLevel(dirHandle, basePath = '') {
  const children = [];
  let count = 0;
  for await (const entry of dirHandle.values()) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    const node = makeNode(entry.name, entry.kind, path, entry);
    node.parentHandle = dirHandle; // needed for delete / create operations
    if (entry.kind === 'directory') node.children = null; // lazy
    children.push(node);
    if (++count % 200 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return sortTreeNodes(children);
}

// ── Public: load children of a directory node (1 level, lazy) ──

export async function loadChildren(node) {
  if (node.kind !== 'directory') return [];

  // Server-backed node (cloned repo opened without File System Access API)
  if (node.serverPath) {
    try {
      const r = await fetch(`/api/read-tree?path=${encodeURIComponent(node.serverPath)}`);
      if (!r.ok) return [];
      const { children } = await r.json();
      const basePath = node.path;
      return children.map((c) => {
        const childRelPath = basePath ? `${basePath}/${c.name}` : c.name;
        return {
          id: childRelPath,
          name: c.name,
          kind: c.kind,
          path: childRelPath,
          handle: null,
          serverPath: c.path,
          file: null,
          children: c.kind === 'directory' ? null : null,
        };
      });
    } catch {
      return [];
    }
  }

  if (!node.handle) return [];
  return buildTreeLevel(node.handle, node.path);
}

// ── Public: immutably set children on the node at targetPath ───

export function setChildrenInTree(tree, targetPath, children) {
  if (targetPath === '') return children;
  return tree.map(node => {
    if (node.path === targetPath) return { ...node, children };
    if (node.children && targetPath.startsWith(node.path + '/'))
      return { ...node, children: setChildrenInTree(node.children, targetPath, children) };
    return node;
  });
}

// ── Public: open an existing directory handle as the workspace root ──
//
// Takes a FileSystemDirectoryHandle from a tree node and builds a fresh
// root-level tree from it. Used by the "打开为空间" menu action to
// re-root the workspace to a subfolder.

export async function openFolderAsWorkspace(dirHandle) {
  if (!dirHandle) {
    throw new Error('当前浏览器不支持此操作，请使用 Chrome 或 Edge 打开');
  }
  const tree = await buildTreeLevel(dirHandle);
  return { handle: dirHandle, tree, name: dirHandle.name };
}

// ── Public: open a local filesystem path as a workspace (server-backed) ──
//
// Uses the backend clone-server to read the directory tree, bypassing
// the File System Access API folder picker.  Used by the clone modal's
// "open" button to directly open a freshly-cloned repo as a space.
//
// Tree nodes carry a `serverPath` (absolute disk path) instead of a
// `handle`.  File reading goes through /api/read-file.

export async function openPathAsSpace(destPath) {
  const r = await fetch(`/api/read-tree?path=${encodeURIComponent(destPath)}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || '无法读取目录');
  }
  const { name, children } = await r.json();
  const tree = children.map((c) => ({
    id: c.name,
    name: c.name,
    kind: c.kind,
    path: c.name,
    handle: null,
    serverPath: c.path,
    file: null,
    children: c.kind === 'directory' ? null : null,
  }));
  return { tree, name, serverRoot: destPath };
}

// ── Public: rebuild tree from an existing root handle ──────
// Only rebuilds top level (lazy). Used after major changes.

export async function rebuildTree(rootHandle) {
  return buildTreeLevel(rootHandle);
}

// ── Public: find a tree node by its path ───────────────────

export function findNodeByPath(tree, path) {
  if (!path) return null;
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.kind === 'directory' && node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

// ── Fallback: build tree from FileList (webkitdirectory) ─────────

function buildTreeFromFiles(files, rootName) {
  const root = makeNode(rootName, 'directory', '', null);
  const dirMap = new Map();
  dirMap.set('', root);

  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    let currentPath = '';
    let currentDir = root;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = currentPath ? `${currentPath}/${part}` : part;

      if (i === parts.length - 1) {
        currentDir.children.push(makeNode(part, 'file', fullPath, null, file));
      } else {
        if (!dirMap.has(fullPath)) {
          const dirNode = makeNode(part, 'directory', fullPath, null);
          dirMap.set(fullPath, dirNode);
          currentDir.children.push(dirNode);
        }
        currentDir = dirMap.get(fullPath);
        currentPath = fullPath;
      }
    }
  }

  (function sortRecursive(node) {
    if (node.children) {
      node.children = sortTreeNodes(node.children);
      node.children.forEach(sortRecursive);
    }
  })(root);

  return root.children;
}

// ── Public: select directory and build tree ─────────────────────

export function isFsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function selectAndBuildTree() {
  if (isFsaSupported()) {
    const handle = await window.showDirectoryPicker();
    const tree = await buildTreeLevel(handle);
    return { handle, tree, name: handle.name };
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('multiple', '');

    input.onchange = (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        reject(new Error('No directory selected'));
        return;
      }
      const rootName = files[0].webkitRelativePath.split('/')[0];
      const tree = buildTreeFromFiles(files, rootName);
      resolve({ handle: null, tree, name: rootName });
    };

    input.click();
  });
}

// ── Public: get a File object from a tree node ───────────────────

export async function getFileObject(fileNode) {
  if (!fileNode) throw new Error('Invalid file node');

  // Server-backed file (cloned repo opened without File System Access API)
  if (fileNode.serverPath && !fileNode.handle) {
    const r = await fetch(`/api/read-file?path=${encodeURIComponent(fileNode.serverPath)}`);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || '无法读取文件');
    }
    const blob = await r.blob();
    return new File([blob], fileNode.name, { type: blob.type });
  }

  if (fileNode.handle) {
    const file = await fileNode.handle.getFile();
    return file;
  }

  if (fileNode.file) {
    return fileNode.file;
  }

  throw new Error('File not accessible: no handle or file object');
}

// ── Public: write text content back to a file (FSA only) ─────────
//
// Uses FileSystemFileHandle.createWritable(). Requires readwrite
// permission — requests it on demand (browser prompts the user).
// Not available in the webkitdirectory fallback (Safari/Firefox):
// those File objects are read-only.

async function ensureWritePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function writeFileContent(fileNode, content) {
  if (!fileNode) throw new Error('Invalid file node');
  if (!fileNode.handle) {
    throw new Error('当前浏览器不支持写入文件，请使用 Chrome 或 Edge 打开');
  }
  const granted = await ensureWritePermission(fileNode.handle);
  if (!granted) throw new Error('未获得文件写入权限');
  const writable = await fileNode.handle.createWritable();
  await writable.write(content);
  await writable.close();
}

// ── Public: delete a file or directory from disk (FSA only) ──
//
// Uses the parent directory handle's removeEntry(). For directories,
// { recursive: true } removes all contents. Requires readwrite
// permission on the parent directory (requested on demand).

export async function deleteEntry(node) {
  if (!node) throw new Error('Invalid node');
  if (!node.parentHandle) {
    throw new Error('当前浏览器不支持文件管理操作，请使用 Chrome 或 Edge 打开');
  }
  const granted = await ensureWritePermission(node.parentHandle);
  if (!granted) throw new Error('未获得删除权限');
  await node.parentHandle.removeEntry(node.name, {
    recursive: node.kind === 'directory',
  });
}

// ── Public: create a new file inside a directory (FSA only) ──

export async function createFileEntry(dirHandle, filename) {
  if (!dirHandle) {
    throw new Error('当前浏览器不支持文件管理操作，请使用 Chrome 或 Edge 打开');
  }
  const granted = await ensureWritePermission(dirHandle);
  if (!granted) throw new Error('未获得文件创建权限');
  return dirHandle.getFileHandle(filename, { create: true });
}

// ── Public: create a new directory inside a directory (FSA only) ──

export async function createDirectoryEntry(dirHandle, dirname) {
  if (!dirHandle) {
    throw new Error('当前浏览器不支持文件管理操作，请使用 Chrome 或 Edge 打开');
  }
  const granted = await ensureWritePermission(dirHandle);
  if (!granted) throw new Error('未获得文件夹创建权限');
  return dirHandle.getDirectoryHandle(dirname, { create: true });
}

// ── Public: rename a file or directory (FSA only) ──────────
//
// For files: uses FileSystemFileHandle.move() (Chromium). If move()
// is not available, falls back to copy-content + delete-old.
// For directories: creates a new directory with the new name,
// recursively copies all contents, then removes the old directory.

async function copyDirectoryContents(srcHandle, destHandle) {
  for await (const entry of srcHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      const newFileHandle = await destHandle.getFileHandle(entry.name, { create: true });
      const writable = await newFileHandle.createWritable();
      await writable.write(file);
      await writable.close();
    } else {
      const newSubDir = await destHandle.getDirectoryHandle(entry.name, { create: true });
      await copyDirectoryContents(entry, newSubDir);
    }
  }
}

export async function renameEntry(node, newName) {
  if (!node) throw new Error('Invalid node');
  if (!node.parentHandle) {
    throw new Error('当前浏览器不支持文件管理操作，请使用 Chrome 或 Edge 打开');
  }
  const granted = await ensureWritePermission(node.parentHandle);
  if (!granted) throw new Error('未获得重命名权限');

  if (node.kind === 'file') {
    // Try move() first — efficient, Chromium-specific
    if (typeof node.handle.move === 'function') {
      await node.handle.move(newName);
    } else {
      // Fallback: copy content + delete old
      const oldFile = await node.handle.getFile();
      const newHandle = await node.parentHandle.getFileHandle(newName, { create: true });
      const writable = await newHandle.createWritable();
      await writable.write(oldFile);
      await writable.close();
      await node.parentHandle.removeEntry(node.name);
    }
  } else {
    // Directory: create new dir, copy contents, delete old
    const newDirHandle = await node.parentHandle.getDirectoryHandle(newName, { create: true });
    await copyDirectoryContents(node.handle, newDirHandle);
    await node.parentHandle.removeEntry(node.name, { recursive: true });
  }
}

// ============================================================
// Recent Spaces — persist directory handles in IndexedDB so
// users can switch between note roots without re-selecting.
// Metadata (id + name) lives in localStorage; the actual
// FileSystemDirectoryHandle (structured-cloneable) lives in IDB.
// ============================================================

const DB_NAME = 'notesview-db';
const DB_VERSION = 1;
const STORE_HANDLES = 'dirHandles';
const LS_RECENT_SPACES = 'nv_recent_spaces';
const LS_LAST_SPACE = 'nv_last_space';
const MAX_SPACES = 12;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(spaceId, handle) {
  if (!handle) return;
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).put(handle, spaceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getDirHandle(spaceId) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const req = tx.objectStore(STORE_HANDLES).get(spaceId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteDirHandle(spaceId) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).delete(spaceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// ── Recent spaces metadata (localStorage) ───────────────────────

export function loadRecentSpaces() {
  try {
    return JSON.parse(localStorage.getItem(LS_RECENT_SPACES) || '[]');
  } catch {
    return [];
  }
}

export function saveRecentSpaces(spaces) {
  try {
    localStorage.setItem(LS_RECENT_SPACES, JSON.stringify(spaces));
  } catch { /* quota / private mode — ignore */ }
}

export function loadLastSpaceId() {
  try {
    return localStorage.getItem(LS_LAST_SPACE);
  } catch {
    return null;
  }
}

export function saveLastSpaceId(spaceId) {
  try {
    if (spaceId) localStorage.setItem(LS_LAST_SPACE, spaceId);
    else localStorage.removeItem(LS_LAST_SPACE);
  } catch { /* ignore */ }
}

/**
 * Add or promote a space to the top of the recent list.
 * Deduplicates by name (removes older entry with same name).
 */
export function addRecentSpace(spaces, spaceId, name) {
  const filtered = spaces.filter(s => s.name !== name);
  const updated = [{ id: spaceId, name }, ...filtered].slice(0, MAX_SPACES);
  saveRecentSpaces(updated);
  return updated;
}

export function removeRecentSpace(spaces, spaceId) {
  const updated = spaces.filter(s => s.id !== spaceId);
  saveRecentSpaces(updated);
  return updated;
}

// ── Switch to a previously-saved space ──────────────────────────

export async function switchToSpace(spaceId) {
  const handle = await getDirHandle(spaceId);
  if (!handle) throw new Error('该笔记空间已失效，请重新选择目录');
  const hasPermission = await verifyPermission(handle);
  if (!hasPermission) throw new Error('未获得目录读取权限');
  const tree = await buildTreeLevel(handle);
  return { handle, tree, name: handle.name };
}

/**
 * Silently try to restore a space — only succeeds if read permission
 * is ALREADY granted (no browser prompt).  Used on app boot.
 */
export async function tryRestoreSpace(spaceId) {
  const handle = await getDirHandle(spaceId);
  if (!handle) return null;
  if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') return null;
  const tree = await buildTreeLevel(handle);
  return { handle, tree, name: handle.name };
}

// ============================================================
// Full-text search — recursively walks the directory tree,
// reads text files, and matches against the query (literal or
// regex).  Results are streamed via onResult callback.
//
// Optimizations (VS Code-inspired):
//  - Excludes heavy dirs (node_modules, .git, dist, …)
//  - Reads files CONCURRENTLY in small batches (I/O parallelism)
//  - Time-based yielding (every ~16ms) keeps UI responsive
// ============================================================

const MAX_SEARCH_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_TOTAL_MATCHES = 1000;
const SEARCH_CONCURRENCY = 8; // files read in parallel per batch

// Directories that are always excluded from search.
// Matches VS Code's default `search.exclude` + common build outputs.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.turbo', '.parcel-cache',
  '.svelte-kit', '.vercel', '.deno', '.gradle',
  '.idea', '.vscode', '.DS_Store', 'out', '.output',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'bower_components', 'jspm_packages',
]);

const SEARCHABLE_EXTS = new Set([
  'md','markdown','mdx','txt','log','csv',
  'js','jsx','mjs','cjs','ts','tsx',
  'json','json5','jsonc',
  'css','scss','sass','less','styl',
  'html','htm','xml','xhtml','vue','svelte',
  'yml','yaml','toml','ini','conf','cfg','properties',
  'py','pyw','pyi','java','kt','kts','scala','groovy',
  'c','h','cpp','cc','cxx','hpp','hh','cs','go','rs','rb','erb','php','swift',
  'sh','bash','zsh','fish','ksh','bat','cmd','ps1',
  'sql','graphql','gql','lua','r','dart','pl','pm',
  'clj','cljs','edn','ex','exs','hs','elm','ml','mli',
  'proto','diff','patch','dockerfile','makefile','mk','cmake','nginx','vim','tf','env',
]);
const SEARCHABLE_SPECIAL = new Set([
  'dockerfile','makefile','gnumakefile','cmakelists',
  '.gitignore','.dockerignore','.npmignore','.env',
  '.editorconfig','.eslintrc','.prettierrc','.babelrc',
]);

function isSearchableFile(filename) {
  const base = filename.toLowerCase();
  if (SEARCHABLE_SPECIAL.has(base)) return true;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return SEARCHABLE_EXTS.has(ext);
}

/**
 * Search all text files under rootHandle for `query`.
 *
 * Two-phase approach per directory:
 *  1. Collect all entries (fast — no file I/O)
 *  2. Search files CONCURRENTLY in batches of SEARCH_CONCURRENCY
 *
 * Directories in EXCLUDED_DIRS are skipped entirely.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} query
 * @param {object} opts
 * @param {boolean} opts.useRegex       — treat query as a RegExp
 * @param {boolean} opts.caseSensitive
 * @param {AbortSignal} opts.signal     — abort to cancel
 * @param {(result)=>void} opts.onResult  — called per file with matches
 * @param {(stats)=>void} opts.onProgress — called with {files, matches}
 */
export async function searchInTree(rootHandle, query, opts = {}) {
  const { useRegex = false, caseSensitive = false, signal, onResult, onProgress } = opts;
  if (!rootHandle || !query) return;

  let regex;
  try {
    const pattern = useRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return; // invalid regex — silently skip
  }

  let totalMatches = 0;
  let filesScanned = 0;
  let lastYield = performance.now();

  const searchFile = async (fileHandle, filePath) => {
    if (signal?.aborted) return;
    try {
      const file = await fileHandle.getFile();
      if (file.size > MAX_SEARCH_FILE_SIZE) {
        filesScanned++;
        return;
      }
      const text = await file.text();
      const lines = text.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length && totalMatches < MAX_TOTAL_MATCHES; i++) {
        regex.lastIndex = 0;
        const m = regex.exec(lines[i]);
        if (m) {
          const lineText = lines[i].length > 200
            ? lines[i].slice(0, 200) + '…'
            : lines[i];
          matches.push({
            lineNum: i + 1,
            text: lineText,
            start: m.index,
            length: m[0].length,
          });
          totalMatches++;
        }
      }
      if (matches.length > 0) {
        onResult?.({ path: filePath, name: fileHandle.name, handle: fileHandle, matches });
      }
    } catch { /* unreadable file — skip */ }
    filesScanned++;
  };

  // Walk directory: collect entries, then search files concurrently
  const walkDir = async (dirHandle, basePath) => {
    if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;

    // Phase 1: collect entries (fast — no file content I/O)
    const fileEntries = [];
    const subdirs = [];
    for await (const entry of dirHandle.values()) {
      if (signal?.aborted) return;
      if (entry.kind === 'directory') {
        if (!EXCLUDED_DIRS.has(entry.name.toLowerCase())) {
          subdirs.push(entry);
        }
      } else if (isSearchableFile(entry.name)) {
        const path = basePath ? `${basePath}/${entry.name}` : entry.name;
        fileEntries.push({ handle: entry, path });
      }
    }

    // Phase 2: search files concurrently in batches
    for (let i = 0; i < fileEntries.length; i += SEARCH_CONCURRENCY) {
      if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;

      const batch = fileEntries.slice(i, i + SEARCH_CONCURRENCY);
      await Promise.all(batch.map(f => searchFile(f.handle, f.path)));
      onProgress?.({ files: filesScanned, matches: totalMatches });

      // Time-based yield — keeps UI responsive without over-yielding
      const now = performance.now();
      if (now - lastYield > 16) {
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }

    // Recurse into subdirectories (sequentially — avoids handle storms)
    for (const sub of subdirs) {
      if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;
      const path = basePath ? `${basePath}/${sub.name}` : sub.name;
      await walkDir(sub, path);
    }
  };

  await walkDir(rootHandle, '');
}
