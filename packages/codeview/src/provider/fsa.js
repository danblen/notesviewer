/**
 * FsaProvider — a FileProvider backed by the File System Access API.
 *
 * Wraps a root FileSystemDirectoryHandle. Tree nodes carry only paths; the
 * provider resolves a path → handle on demand (caching handles as it lists
 * directories) so the view layer never touches raw handles.
 *
 * Migrated from notesview's fileSystem.js (lazy per-level listing, 1 MB read
 * cap, write-back, create/delete/rename, concurrent full-text search).
 *
 * Git is optional and host-injected via `options.git` — an object exposing
 * `status()` and `diff(path, status)` — so isomorphic-git stays out of this
 * package.
 */
import {
  MAX_TEXT_VIEW_SIZE,
  sortEntries,
  escapeRegExp,
  isSearchableFile,
  EXCLUDED_DIRS,
} from './shared';

const MAX_SEARCH_FILE_SIZE = 1024 * 1024;
const MAX_TOTAL_MATCHES = 1000;
const SEARCH_CONCURRENCY = 8;

export class FsaProvider {
  /**
   * @param {FileSystemDirectoryHandle} rootHandle
   * @param {object} [options]
   * @param {{status:Function, diff:Function}} [options.git]
   */
  constructor(rootHandle, options = {}) {
    if (!rootHandle) throw new Error('FsaProvider 需要一个目录句柄');
    this._root = rootHandle;
    this._git = options.git || null;
    // path → FileSystemHandle cache (populated as directories are listed)
    this._handles = new Map();
    this._handles.set('', rootHandle);
    this.capabilities = {
      write: true,
      fileOps: true,
      search: true,
      git: Boolean(this._git),
    };
    if (this._git) {
      this.git = {
        status: (...a) => this._git.status(...a),
        diff: (...a) => this._git.diff(...a),
      };
    }
  }

  // ── Handle resolution ─────────────────────────────────────────
  async _resolveDir(path) {
    if (this._handles.has(path)) {
      const h = this._handles.get(path);
      if (h.kind === 'directory') return h;
    }
    const segments = path.split('/').filter(Boolean);
    let dir = this._root;
    let cur = '';
    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg);
      cur = cur ? `${cur}/${seg}` : seg;
      this._handles.set(cur, dir);
    }
    return dir;
  }

  async _resolveFile(path) {
    const cached = this._handles.get(path);
    if (cached && cached.kind === 'file') return cached;
    const idx = path.lastIndexOf('/');
    const parent = idx >= 0 ? path.slice(0, idx) : '';
    const name = idx >= 0 ? path.slice(idx + 1) : path;
    const dir = await this._resolveDir(parent);
    const handle = await dir.getFileHandle(name);
    this._handles.set(path, handle);
    return handle;
  }

  async _getFile(path) {
    const handle = await this._resolveFile(path);
    return handle.getFile();
  }

  /**
   * Public: resolve a directory path to its FileSystemDirectoryHandle.
   * Used by hosts that re-root the workspace to a subfolder (“open as space”).
   * @param {string} path
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async getDirHandle(path) {
    return this._resolveDir(path || '');
  }

  async _ensureWrite(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    throw new Error('未获得文件写入权限');
  }

  // ── Read ──────────────────────────────────────────────────────
  async listDir(path = '') {
    const dir = await this._resolveDir(path);
    const entries = [];
    let count = 0;
    for await (const entry of dir.values()) {
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      this._handles.set(childPath, entry);
      entries.push({ name: entry.name, kind: entry.kind, path: childPath });
      if (++count % 200 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return sortEntries(entries);
  }

  async readFileText(path, maxBytes = MAX_TEXT_VIEW_SIZE) {
    const file = await this._getFile(path);
    const size = file.size;
    const truncated = size > maxBytes;
    const blob = truncated ? file.slice(0, maxBytes) : file;
    const text = await blob.text();
    return { text, size, truncated };
  }

  async readFileBlob(path) {
    return this._getFile(path);
  }

  // ── Write ─────────────────────────────────────────────────────
  async writeFile(path, content) {
    const handle = await this._resolveFile(path);
    await this._ensureWrite(handle);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  // ── File operations ──────────────────────────────────────────
  async createFile(dirPath, name) {
    const dir = await this._resolveDir(dirPath);
    await this._ensureWrite(dir);
    const handle = await dir.getFileHandle(name, { create: true });
    const childPath = dirPath ? `${dirPath}/${name}` : name;
    this._handles.set(childPath, handle);
  }

  async createDir(dirPath, name) {
    const dir = await this._resolveDir(dirPath);
    await this._ensureWrite(dir);
    const handle = await dir.getDirectoryHandle(name, { create: true });
    const childPath = dirPath ? `${dirPath}/${name}` : name;
    this._handles.set(childPath, handle);
  }

  async deleteEntry(path, kind) {
    const idx = path.lastIndexOf('/');
    const parent = idx >= 0 ? path.slice(0, idx) : '';
    const name = idx >= 0 ? path.slice(idx + 1) : path;
    const dir = await this._resolveDir(parent);
    await this._ensureWrite(dir);
    await dir.removeEntry(name, { recursive: kind === 'directory' });
    this._handles.delete(path);
  }

  async renameEntry(path, newName, kind) {
    const idx = path.lastIndexOf('/');
    const parent = idx >= 0 ? path.slice(0, idx) : '';
    const name = idx >= 0 ? path.slice(idx + 1) : path;
    const dir = await this._resolveDir(parent);
    await this._ensureWrite(dir);
    if (kind === 'file') {
      const handle = await dir.getFileHandle(name);
      if (typeof handle.move === 'function') {
        await handle.move(newName);
      } else {
        const oldFile = await handle.getFile();
        const newHandle = await dir.getFileHandle(newName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(oldFile);
        await writable.close();
        await dir.removeEntry(name);
      }
    } else {
      const srcHandle = await dir.getDirectoryHandle(name);
      const destHandle = await dir.getDirectoryHandle(newName, { create: true });
      await copyDirectoryContents(srcHandle, destHandle);
      await dir.removeEntry(name, { recursive: true });
    }
    this._handles.delete(path);
  }

  // ── Search ────────────────────────────────────────────────────
  async search(query, opts = {}) {
    const { useRegex = false, caseSensitive = false, signal, onResult, onProgress } = opts;
    if (!query) return;
    let regex;
    try {
      const pattern = useRegex ? query : escapeRegExp(query);
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return;
    }
    let totalMatches = 0;
    let filesScanned = 0;
    let lastYield = performance.now();

    const searchFile = async (fileHandle, filePath) => {
      if (signal?.aborted) return;
      try {
        const file = await fileHandle.getFile();
        if (file.size > MAX_SEARCH_FILE_SIZE) { filesScanned++; return; }
        const text = await file.text();
        const lines = text.split('\n');
        const matches = [];
        for (let i = 0; i < lines.length && totalMatches < MAX_TOTAL_MATCHES; i++) {
          regex.lastIndex = 0;
          const m = regex.exec(lines[i]);
          if (m) {
            const lineText = lines[i].length > 200 ? lines[i].slice(0, 200) + '…' : lines[i];
            matches.push({ lineNum: i + 1, text: lineText, start: m.index, length: m[0].length });
            totalMatches++;
          }
        }
        if (matches.length > 0) onResult?.({ path: filePath, name: fileHandle.name, matches });
      } catch { /* unreadable — skip */ }
      filesScanned++;
    };

    const walkDir = async (dirHandle, basePath) => {
      if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;
      const fileEntries = [];
      const subdirs = [];
      for await (const entry of dirHandle.values()) {
        if (signal?.aborted) return;
        if (entry.kind === 'directory') {
          if (!EXCLUDED_DIRS.has(entry.name.toLowerCase())) subdirs.push(entry);
        } else if (isSearchableFile(entry.name)) {
          const path = basePath ? `${basePath}/${entry.name}` : entry.name;
          fileEntries.push({ handle: entry, path });
        }
      }
      for (let i = 0; i < fileEntries.length; i += SEARCH_CONCURRENCY) {
        if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;
        const batch = fileEntries.slice(i, i + SEARCH_CONCURRENCY);
        await Promise.all(batch.map((f) => searchFile(f.handle, f.path)));
        onProgress?.({ files: filesScanned, matches: totalMatches });
        const now = performance.now();
        if (now - lastYield > 16) {
          await new Promise((r) => setTimeout(r, 0));
          lastYield = performance.now();
        }
      }
      for (const sub of subdirs) {
        if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;
        const path = basePath ? `${basePath}/${sub.name}` : sub.name;
        await walkDir(sub, path);
      }
    };

    await walkDir(this._root, '');
  }
}

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
