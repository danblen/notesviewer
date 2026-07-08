import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import { getFileObject, getCodeLanguage, writeFileContent } from '../utils/fileSystem';
import { EditIcon, SaveIcon, EyeIcon, ExitIcon } from './Icons';

const CONTENT_MIN = 400, CONTENT_MAX = 1800;

// File types that can be edited in-app (text-based)
const EDITABLE_TYPES = new Set(['markdown', 'code', 'text']);

// ── Remark plugin: tag block elements with source line numbers ──
// Adds data-source-line attr so the MarkdownViewer can scroll to the
// block containing a specific source line (search result navigation).
function remarkSourceLines() {
  return (tree) => {
    const walk = (node) => {
      if (node.position && node.type !== 'root' && node.type !== 'text') {
        if (!node.data) node.data = {};
        if (!node.data.hProperties) node.data.hProperties = {};
        node.data.hProperties['data-source-line'] = node.position.start.line;
      }
      if (node.children) node.children.forEach(walk);
    };
    walk(tree);
    return tree;
  };
}

/**
 * ContentArea — renders the currently hovered file.
 *
 * Supported types: markdown (with code highlighting), PDF, image,
 * code (syntax highlighted via highlight.js), and other (fallback).
 *
 * Markdown / code / text files are EDITABLE: a floating "编辑" button
 * switches to a full editor (textarea + optional live preview for md).
 * Saving writes back via the File System Access API (Chrome/Edge).
 *
 * The reading column has an adjustable max-width, controlled by a
 * draggable handle on its right edge (hidden while editing).
 */
export default function ContentArea({ file, contentMaxWidth, setContentMaxWidth, onDirtyChange, scrollTarget }) {
  const areaRef = useRef(null);
  const [areaWidth, setAreaWidth] = useState(9999);
  const [editing, setEditing] = useState(false);

  // Track content-area width so the resizer handle stays visible
  // even when the sidebar is resized or the window changes.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setAreaWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Leave edit mode (and clear dirty) whenever the open file changes.
  useEffect(() => {
    setEditing(false);
    onDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.node?.id]);

  // ── Content column resize ───────────────────────────────
  const onContentResizeStart = useCallback((e) => {
    e.preventDefault();
    const rect = areaRef.current.getBoundingClientRect();
    const onMove = (ev) => {
      const w = Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, ev.clientX - rect.left));
      setContentMaxWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [setContentMaxWidth]);

  // Effective column width (clamped to available area)
  const effMax = Math.min(contentMaxWidth, areaWidth || 9999);

  // ── Empty state ─────────────────────────────────────────
  if (!file) {
    return (
      <main className="content-area" ref={areaRef}>
        <div className="content-empty">
          <div className="content-empty-icon">📖</div>
          <p>将鼠标悬停在文件上即可阅读</p>
        </div>
      </main>
    );
  }

  const editable = EDITABLE_TYPES.has(file.type);

  return (
    <main className="content-area" ref={areaRef}>
      {/* Floating edit button (view mode only, editable files) */}
      {editable && !editing && (
        <div className="content-toolbar">
          <button className="tool-btn" onClick={() => setEditing(true)} title="编辑此文件">
            <EditIcon size={14} />
            <span>编辑</span>
          </button>
        </div>
      )}

      <div className="content-body">
        {editing && editable ? (
          <Editor file={file} onDirtyChange={onDirtyChange} onExit={() => setEditing(false)} />
        ) : file.type === 'pdf' ? (
          <PdfViewer file={file} />
        ) : (
          <div className="content-inner" style={{ maxWidth: effMax }}>
            {file.type === 'markdown' && <MarkdownViewer file={file} scrollTarget={scrollTarget} />}
            {file.type === 'image' && <ImageViewer file={file} />}
            {(file.type === 'code' || file.type === 'text') && <CodeViewer file={file} scrollTarget={scrollTarget} />}
            {file.type === 'other' && <UnsupportedViewer file={file} />}
          </div>
        )}
      </div>

      {/* Width handle — hidden while editing (editor uses full width) */}
      {!editing && (
        <div
          className="content-resizer"
          style={{ left: Math.max(0, effMax - 3) }}
          onMouseDown={onContentResizeStart}
          title="拖动调整内容宽度"
        />
      )}
    </main>
  );
}

// ── Error display (shared) ───────────────────────────────
function ErrorDisplay({ message }) {
  return (
    <div className="content-error">
      <div className="content-error-icon">⚠️</div>
      <p>无法读取文件</p>
      <p className="content-error-detail">{message}</p>
    </div>
  );
}

// ── Editor (markdown / code / text) ──────────────────────
function Editor({ file, onDirtyChange, onExit }) {
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load file text
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    getFileObject(file.node).then(async (f) => {
      const t = await f.text();
      if (!cancelled) {
        setText(t);
        setOriginal(t);
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error('Editor load error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node]);

  // Report dirty state up so App can guard hover-switching
  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    setDirty(v !== original);
  };

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFileContent(file.node, text);
      setOriginal(text);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      console.error('Save error:', err);
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, file.node, text]);

  // ⌘S / Ctrl+S to save
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave]);

  // Tab key → insert two spaces (don't lose focus)
  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const insert = '  ';
      const newText = text.slice(0, s) + insert + text.slice(en);
      setText(newText);
      setDirty(newText !== original);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + insert.length;
      });
    }
  };

  const handleExit = () => {
    if (dirty && !window.confirm('有未保存的修改，确定退出编辑？')) return;
    onExit();
  };

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error && !text) return <ErrorDisplay message={error} />;

  const isMarkdown = file.type === 'markdown';

  return (
    <div className="editor-wrap">
      <div className="editor-toolbar">
        <span className="editor-filename" title={file.name}>{file.name}</span>
        <div className="editor-actions">
          {dirty && <span className="editor-dirty" title="未保存的修改">●</span>}
          {savedFlash && <span className="editor-saved">已保存</span>}
          {isMarkdown && (
            <button
              className={`tool-btn ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(v => !v)}
              title="分屏预览"
            >
              <EyeIcon size={14} />
              <span>预览</span>
            </button>
          )}
          <button
            className="tool-btn primary"
            onClick={handleSave}
            disabled={saving || !dirty}
            title="保存 (⌘S)"
          >
            <SaveIcon size={14} />
            <span>{saving ? '保存中…' : '保存'}</span>
          </button>
          <button className="tool-btn" onClick={handleExit} title="退出编辑">
            <ExitIcon size={14} />
            <span>退出</span>
          </button>
        </div>
        {error && <span className="editor-error-msg" title={error}>{error}</span>}
      </div>
      <div className={`editor-body ${showPreview && isMarkdown ? 'split' : ''}`}>
        <textarea
          className="editor-textarea"
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
          placeholder="开始编辑…"
        />
        {showPreview && isMarkdown && (
          <div className="editor-preview markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Markdown ──────────────────────────────────────────────
function MarkdownViewer({ file, scrollTarget }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFileObject(file.node).then(async (f) => {
      const text = await f.text();
      if (!cancelled) {
        setContent(text);
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error('Markdown read error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node]);

  // Scroll to the block containing the target source line
  // (triggered by search result hover)
  useEffect(() => {
    if (!scrollTarget || loading || !content) return;
    if (scrollTarget.path !== file.node.path) return;

    const raf = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const els = container.querySelectorAll('[data-source-line]');
      if (!els.length) return;

      // Find the element with the largest source-line <= target line
      let best = null;
      let bestLine = -1;
      els.forEach(el => {
        const line = parseInt(el.getAttribute('data-source-line'), 10);
        if (line <= scrollTarget.line && line > bestLine) {
          best = el;
          bestLine = line;
        }
      });

      if (best) {
        const scrollContainer = container.closest('.content-body');
        if (scrollContainer) {
          const rect = best.getBoundingClientRect();
          const cRect = scrollContainer.getBoundingClientRect();
          const offset = rect.top - cRect.top + scrollContainer.scrollTop - 80;
          scrollContainer.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, content, loading, file.node.path]);

  // Memoize markdown parsing — must be before any early returns (rules of hooks)
  const rendered = useMemo(() => {
    if (!content) return null;
    return (
      <div className="markdown-content" ref={containerRef}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkSourceLines]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  return rendered;
}

// ── PDF ───────────────────────────────────────────────────
function PdfViewer({ file }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let blobUrl = null;
    let cancelled = false;
    getFileObject(file.node).then((f) => {
      if (cancelled) return;
      blobUrl = URL.createObjectURL(f);
      setUrl(blobUrl);
    }).catch((err) => {
      if (!cancelled) {
        console.error('PDF read error:', err);
        setError(err.message || String(err));
      }
    });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file.node]);

  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;

  return <iframe src={url} className="pdf-viewer" title={file.name} />;
}

// ── Image ─────────────────────────────────────────────────
function ImageViewer({ file }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let blobUrl = null;
    let cancelled = false;
    getFileObject(file.node).then((f) => {
      if (cancelled) return;
      blobUrl = URL.createObjectURL(f);
      setUrl(blobUrl);
    }).catch((err) => {
      if (!cancelled) {
        console.error('Image read error:', err);
        setError(err.message || String(err));
      }
    });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file.node]);

  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;

  return (
    <div className="image-viewer-wrapper">
      <img src={url} alt={file.name} className="image-viewer" />
    </div>
  );
}

// ── Code (syntax highlighted, with line numbers) ────────
function CodeViewer({ file, scrollTarget }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightedHtml, setHighlightedHtml] = useState(null);
  const preRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHighlightedHtml(null);
    getFileObject(file.node).then(async (f) => {
      const text = await f.text();
      if (!cancelled) {
        setContent(text);
        setLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error('Code read error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node]);

  // Deferred highlighting — runs after paint so UI stays responsive
  useEffect(() => {
    if (loading || error || !content) return;
    const lang = getCodeLanguage(file.name);
    const supported = lang !== 'plaintext' && hljs.getLanguage(lang);
    const tooLarge = content.length > 500_000;
    if (supported && !tooLarge) {
      const raf = requestAnimationFrame(() => {
        try {
          const html = hljs.highlight(content, { language: lang }).value;
          setHighlightedHtml(html);
        } catch { /* ignore */ }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [content, loading, error, file.name]);

  // Scroll to a specific line (triggered by search result hover)
  useEffect(() => {
    if (!scrollTarget || loading || !content) return;
    if (scrollTarget.path !== file.node.path) return;

    const raf = requestAnimationFrame(() => {
      const container = preRef.current?.closest('.content-body');
      if (!container) return;

      // Line height = 13px font-size * 1.6 line-height = 20.8px
      // <pre> padding-top = 24px
      const lineHeight = 20.8;
      const paddingTop = 24;
      const targetY = paddingTop + (scrollTarget.line - 1) * lineHeight;

      // Scroll so the target line is ~80px from top (context above)
      container.scrollTo({
        top: Math.max(0, targetY - 80),
        behavior: 'smooth',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, content, loading, file.node.path]);

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  const lang = getCodeLanguage(file.name);
  const lineCount = content ? content.split('\n').length : 0;

  return (
    <div className="code-viewer">
      <div className="code-gutter">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="code-line-num">{i + 1}</div>
        ))}
      </div>
      <pre className="code-pre" ref={preRef}>
        {highlightedHtml ? (
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code>{content}</code>
        )}
      </pre>
    </div>
  );
}

// ── Unsupported ──────────────────────────────────────────
function UnsupportedViewer({ file }) {
  return (
    <div className="content-unsupported">
      <div className="content-unsupported-icon">📄</div>
      <p>不支持预览此文件格式</p>
      <p className="content-unsupported-name">{file.name}</p>
    </div>
  );
}
