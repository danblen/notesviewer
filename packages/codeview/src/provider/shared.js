/**
 * shared.js — pure, provider-agnostic helpers.
 *
 * Migrated from notesview's fileSystem.js: language detection, file-type
 * detection, binary sniffing, size formatting, sorting, searchable-file
 * rules, plus small tree helpers used by the in-memory provider and the
 * git change panel.
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
  tf: 'haskell',
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
    if (SPECIAL_FILE_LANG[base]) return SPECIAL_FILE_LANG[base];
    return 'plaintext';
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return CODE_LANG_MAP[ext] || 'plaintext';
}

// ── File type detection ──────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba', 'mid', 'midi']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv']);

export function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  const base = filename.toLowerCase();
  if (SPECIAL_FILE_LANG[base] || CODE_LANG_MAP[ext]) return 'code';
  return 'other';
}

// ── Large-file / text-viewing helpers ────────────────────────────

// Max bytes rendered by the text/code/markdown viewers. Larger files are
// read only up to this cap so the DOM stays light and the UI never freezes.
export const MAX_TEXT_VIEW_SIZE = 1024 * 1024; // 1 MB

/**
 * Heuristic: does this text look like binary (non-text) data?
 * Checks a leading sample for NUL bytes and a high ratio of control chars.
 */
export function looksBinary(text) {
  const sample = text.slice(0, 8000);
  if (!sample) return false;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true; // NUL byte → definitely binary
    if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) suspicious++;
  }
  return suspicious / sample.length > 0.15;
}

/** Human-readable file size. */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Sorting ──────────────────────────────────────────────────────
// Works on any object carrying { name, kind } — directories first,
// then locale-aware numeric name comparison.
export function sortEntries(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });
}

// ── Tree helpers ─────────────────────────────────────────────────

/** Immutably set `children` on the node at targetPath within a tree. */
export function setChildrenInTree(tree, targetPath, children) {
  if (targetPath === '') return children;
  return tree.map((node) => {
    if (node.path === targetPath) return { ...node, children };
    if (node.kind === 'directory' && targetPath.startsWith(node.path + '/')) {
      if (node.children) {
        return { ...node, children: setChildrenInTree(node.children, targetPath, children) };
      }
    }
    return node;
  });
}

/** Find a tree node by its path (depth-first, only into loaded children). */
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

/** Convert a provider entry ({name,kind,path}) into a view tree node. */
export function toTreeNode(entry) {
  return {
    id: entry.path,
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
    children: entry.kind === 'directory' ? null : null,
  };
}

// ── Searchable-file rules (shared by memory search) ──────────────

export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.turbo', '.parcel-cache',
  '.svelte-kit', '.vercel', '.deno', '.gradle',
  '.idea', '.vscode', '.DS_Store', 'out', '.output',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'bower_components', 'jspm_packages',
]);

const SEARCHABLE_EXTS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'log', 'csv',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'json', 'json5', 'jsonc',
  'css', 'scss', 'sass', 'less', 'styl',
  'html', 'htm', 'xml', 'xhtml', 'vue', 'svelte',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'properties',
  'py', 'pyw', 'pyi', 'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'rb', 'erb', 'php', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'ksh', 'bat', 'cmd', 'ps1',
  'sql', 'graphql', 'gql', 'lua', 'r', 'dart', 'pl', 'pm',
  'clj', 'cljs', 'edn', 'ex', 'exs', 'hs', 'elm', 'ml', 'mli',
  'proto', 'diff', 'patch', 'dockerfile', 'makefile', 'mk', 'cmake', 'nginx', 'vim', 'tf', 'env',
]);
const SEARCHABLE_SPECIAL = new Set([
  'dockerfile', 'makefile', 'gnumakefile', 'cmakelists',
  '.gitignore', '.dockerignore', '.npmignore', '.env',
  '.editorconfig', '.eslintrc', '.prettierrc', '.babelrc',
]);

export function isSearchableFile(filename) {
  const base = filename.toLowerCase();
  if (SEARCHABLE_SPECIAL.has(base)) return true;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = filename.slice(dot + 1).toLowerCase();
  return SEARCHABLE_EXTS.has(ext);
}

/** Escape a literal string for safe use inside a RegExp. */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Build a lazy tree structure from a flat file list ────────────
// Used by MemoryProvider. Returns a full nested tree of
// { name, kind, path, children? } and a Map<dirPath, entries[]> so the
// provider can answer listDir(path) in O(1).
export function buildDirIndex(files) {
  // dirMap: path → array of direct child entries {name, kind, path}
  const dirMap = new Map();
  dirMap.set('', []);
  const seen = new Set(); // paths already added to their parent

  const ensureDir = (dirPath) => {
    if (!dirMap.has(dirPath)) dirMap.set(dirPath, []);
  };

  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let parent = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const curPath = parent ? `${parent}/${name}` : name;
      const isLeaf = i === parts.length - 1;
      const kind = isLeaf ? 'file' : 'directory';
      const key = `${parent}\u0000${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        ensureDir(parent);
        dirMap.get(parent).push({ name, kind, path: curPath });
        if (kind === 'directory') ensureDir(curPath);
      }
      parent = curPath;
    }
  }

  // Sort each directory's entries
  for (const [k, entries] of dirMap) dirMap.set(k, sortEntries(entries));
  return dirMap;
}

// ── Git change tree (used by GitDiffPanel) ───────────────────────
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
        current.children.push({ name: part, path: childPath, kind: 'file', status: change.status });
      } else {
        let dir = current.children.find((c) => c.kind === 'directory' && c.name === part);
        if (!dir) {
          dir = { name: part, path: childPath, kind: 'directory', children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }
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
