/**
 * ServerProvider — a FileProvider backed by a clone-server HTTP backend.
 *
 * Talks to `/api/read-tree?path=<abs>` and `/api/read-file?path=<abs>`.
 * Tree nodes carry only relative paths; the provider maps a relative path to
 * the backend's absolute path (seeded from `rootPath`, extended as each
 * directory is listed).
 *
 * Write / file-ops are not exposed by the backend, so those capabilities are
 * off. Git is optional and host-injected via `options.git`.
 */
import { MAX_TEXT_VIEW_SIZE, sortEntries } from './shared';

export class ServerProvider {
  /**
   * @param {string} baseUrl  Origin for the API (e.g. '' for same-origin, or 'http://localhost:5015')
   * @param {string} rootPath Absolute disk path of the space root
   * @param {object} [options]
   * @param {{status:Function, diff:Function}} [options.git]
   */
  constructor(baseUrl, rootPath, options = {}) {
    this._base = (baseUrl || '').replace(/\/+$/, '');
    this._rootPath = rootPath;
    this._git = options.git || null;
    // relative path → absolute server path
    this._abs = new Map();
    this._abs.set('', rootPath);
    this.capabilities = {
      write: false,
      fileOps: false,
      search: false,
      git: Boolean(this._git),
    };
    if (this._git) {
      this.git = {
        status: (...a) => this._git.status(...a),
        diff: (...a) => this._git.diff(...a),
      };
    }
  }

  _url(path) {
    return this._base ? this._base + path : path;
  }

  async listDir(path = '') {
    const abs = this._abs.get(path);
    if (abs == null) throw new Error('未知目录：' + path);
    const r = await fetch(this._url(`/api/read-tree?path=${encodeURIComponent(abs)}`));
    if (!r.ok) return [];
    const { children } = await r.json();
    const entries = (children || []).map((c) => {
      const childRelPath = path ? `${path}/${c.name}` : c.name;
      this._abs.set(childRelPath, c.path);
      return { name: c.name, kind: c.kind, path: childRelPath };
    });
    return sortEntries(entries);
  }

  async _absOf(path) {
    if (this._abs.has(path)) return this._abs.get(path);
    // Resolve by listing ancestors so the abs-path map is populated.
    const segments = path.split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < segments.length; i++) {
      const next = cur ? `${cur}/${segments[i]}` : segments[i];
      if (!this._abs.has(next)) await this.listDir(cur);
      cur = next;
    }
    if (!this._abs.has(path)) throw new Error('无法解析路径：' + path);
    return this._abs.get(path);
  }

  async readFileBlob(path) {
    const abs = await this._absOf(path);
    const r = await fetch(this._url(`/api/read-file?path=${encodeURIComponent(abs)}`));
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || '无法读取文件');
    }
    return r.blob();
  }

  async readFileText(path, maxBytes = MAX_TEXT_VIEW_SIZE) {
    const blob = await this.readFileBlob(path);
    const size = blob.size;
    const truncated = size > maxBytes;
    const slice = truncated ? blob.slice(0, maxBytes) : blob;
    const text = await slice.text();
    return { text, size, truncated };
  }
}
