/**
 * MemoryProvider — a FileProvider backed by an in-memory flat file list.
 *
 * Shape of `files`: Array<{ path: string, content: string }>. A directory
 * index is built lazily from the paths, so listDir/readFileText answer in
 * O(1) without touching disk or the network. Ideal for AI-generated project
 * snapshots (e.g. AI-team4 sessions).
 *
 * Capabilities: read + optional write. Media preview is limited to what a
 * text Blob can render (source snapshots are text); git is disabled.
 */
import {
  MAX_TEXT_VIEW_SIZE,
  buildDirIndex,
  escapeRegExp,
  isSearchableFile,
} from './shared';

export function createMemoryProvider(files = [], options = {}) {
  return new MemoryProvider(files, options);
}

export class MemoryProvider {
  /**
   * @param {Array<{path:string, content:string}>} files
   * @param {object} [options]
   * @param {(path:string, content:string)=>void|Promise<void>} [options.onWrite]
   *   Called after an in-memory write so the host can persist / round-trip.
   * @param {boolean} [options.writable=false] Enable inline edit + save.
   */
  constructor(files = [], options = {}) {
    this._options = options;
    this._onWrite = options.onWrite || null;
    this.capabilities = {
      write: Boolean(options.writable || options.onWrite),
      fileOps: false,
      search: true,
      git: false,
    };
    this.setFiles(files);
  }

  /** Replace the backing file list (rebuilds the directory index). */
  setFiles(files) {
    this._files = Array.isArray(files) ? files.slice() : [];
    this._map = new Map(this._files.map((f) => [f.path, f]));
    this._dirIndex = buildDirIndex(this._files);
  }

  // ── Read ──────────────────────────────────────────────────────
  async listDir(path = '') {
    return this._dirIndex.get(path) || [];
  }

  async readFileText(path, maxBytes = MAX_TEXT_VIEW_SIZE) {
    const f = this._map.get(path);
    if (!f) throw new Error('文件不存在：' + path);
    const content = f.content ?? '';
    // Byte-accurate truncation via UTF-8 encoding, matching the FSA/server caps.
    const bytes = new TextEncoder().encode(content);
    const size = bytes.length;
    const truncated = size > maxBytes;
    const text = truncated ? new TextDecoder().decode(bytes.slice(0, maxBytes)) : content;
    return { text, size, truncated };
  }

  async readFileBlob(path) {
    const f = this._map.get(path);
    if (!f) throw new Error('文件不存在：' + path);
    return new Blob([f.content ?? ''], { type: 'text/plain' });
  }

  // ── Write ─────────────────────────────────────────────────────
  async writeFile(path, content) {
    if (!this.capabilities.write) throw new Error('当前数据源为只读');
    const existing = this._map.get(path);
    if (existing) {
      existing.content = content;
    } else {
      const f = { path, content };
      this._files.push(f);
      this._map.set(path, f);
      this._dirIndex = buildDirIndex(this._files);
    }
    if (this._onWrite) await this._onWrite(path, content);
  }

  // ── Search ────────────────────────────────────────────────────
  // Streams results via opts.onResult, mirroring searchInTree's shape.
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
    const MAX_TOTAL_MATCHES = 1000;
    for (const f of this._files) {
      if (signal?.aborted || totalMatches >= MAX_TOTAL_MATCHES) return;
      const name = f.path.split('/').pop();
      if (!isSearchableFile(name)) continue;
      const lines = (f.content ?? '').split('\n');
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
      filesScanned++;
      if (matches.length > 0) onResult?.({ path: f.path, name, matches });
      onProgress?.({ files: filesScanned, matches: totalMatches });
    }
  }
}
