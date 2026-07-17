import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import { getFileObject, getCodeLanguage, writeFileContent, readFileTextCapped, looksBinary, formatFileSize, MAX_TEXT_VIEW_SIZE } from '../utils/fileSystem';
import { EditIcon, SaveIcon, EyeIcon, ExitIcon } from './Icons';
import GitDiffViewer from './GitDiffViewer';

const CONTENT_MIN = 400, CONTENT_MAX = 1800;

// File types that can be edited in-app (text-based)
const EDITABLE_TYPES = new Set(['markdown', 'code', 'text', 'html']);

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
export default function ContentArea({ file, contentMaxWidth, setContentMaxWidth, onDirtyChange, scrollTarget, gitFile, gitDiffData, gitDiffLoading, gitDiffError, onCloseDiff }) {
  const areaRef = useRef(null);
  const [areaWidth, setAreaWidth] = useState(9999);
  const [editing, setEditing] = useState(false);
  // HTML view sub-mode: rendered preview vs. source code.
  const [htmlMode, setHtmlMode] = useState('preview');

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
    setHtmlMode('preview');
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

  // ── Git diff override ──────────────────────────────────
  // When a git change file is selected, show the diff full-screen.
  if (gitFile) {
    return (
      <main className="content-area" ref={areaRef}>
        <div className="content-body" style={{ padding: 0 }}>
          <GitDiffViewer
            gitFile={gitFile}
            diffData={gitDiffData}
            diffLoading={gitDiffLoading}
            diffError={gitDiffError}
            onClose={onCloseDiff}
          />
        </div>
      </main>
    );
  }

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
  const isHtml = file.type === 'html';
  const htmlPreview = isHtml && htmlMode === 'preview';

  return (
    <main className="content-area" ref={areaRef}>
      {/* Floating toolbar (view mode only): HTML preview/source toggle + edit */}
      {!editing && (isHtml || editable) && (
        <div className="content-toolbar">
          {isHtml && (
            <div className="seg-toggle" role="group">
              <button
                className={`seg-btn ${htmlMode === 'preview' ? 'active' : ''}`}
                onClick={() => setHtmlMode('preview')}
                title="渲染预览"
              >
                预览
              </button>
              <button
                className={`seg-btn ${htmlMode === 'source' ? 'active' : ''}`}
                onClick={() => setHtmlMode('source')}
                title="查看源码"
              >
                源码
              </button>
            </div>
          )}
          {editable && (
            <button className="tool-btn" onClick={() => setEditing(true)} title="编辑此文件">
              <EditIcon size={14} />
              <span>编辑</span>
            </button>
          )}
        </div>
      )}

      <div className="content-body">
        {editing && editable ? (
          <Editor file={file} onDirtyChange={onDirtyChange} onExit={() => setEditing(false)} />
        ) : file.type === 'pdf' ? (
          <PdfViewer file={file} />
        ) : htmlPreview ? (
          <HtmlViewer file={file} />
        ) : (
          <div className="content-inner" style={{ maxWidth: effMax }}>
            {file.type === 'markdown' && <MarkdownViewer file={file} scrollTarget={scrollTarget} />}
            {file.type === 'image' && <ImageViewer file={file} />}
            {file.type === 'audio' && <AudioViewer file={file} />}
            {file.type === 'video' && <VideoViewer file={file} />}
            {(file.type === 'code' || file.type === 'text' || isHtml) && <CodeViewer file={file} scrollTarget={scrollTarget} />}
            {file.type === 'other' && <CodeViewer file={file} scrollTarget={scrollTarget} fallback />}
          </div>
        )}
      </div>

      {/* Width handle — hidden while editing / in HTML preview (full-width iframe) */}
      {!editing && !htmlPreview && (
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
  const [truncated, setTruncated] = useState(false);

  // Load file text (capped). A truncated load means the file is too large
  // to edit safely — saving would overwrite the original with a partial
  // copy, so we switch the editor to read-only in that case.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    setTruncated(false);
    readFileTextCapped(file.node).then(({ text, truncated }) => {
      if (!cancelled) {
        setText(text);
        setOriginal(text);
        setTruncated(truncated);
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
    if (!dirty || saving || truncated) return;
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
  }, [dirty, saving, truncated, file.node, text]);

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
          {truncated && <span className="editor-error-msg" title="文件过大，已截断，仅供预览">文件过大 · 只读预览</span>}
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
            disabled={saving || !dirty || truncated}
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
          readOnly={truncated}
          placeholder="开始编辑…"
        />
        {showPreview && isMarkdown && (
          <div className="editor-preview markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
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
  const [truncated, setTruncated] = useState(false);
  const [size, setSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    readFileTextCapped(file.node).then(({ text, size, truncated }) => {
      if (!cancelled) {
        setContent(text);
        setSize(size);
        setTruncated(truncated);
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
        {truncated && (
          <div className="content-truncated-banner">
            文件较大，仅渲染前 {formatFileSize(MAX_TEXT_VIEW_SIZE)}（共 {formatFileSize(size)}）
          </div>
        )}
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, remarkSourceLines]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, truncated, size]);

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  return rendered;
}

// ── Object-URL hook (shared by PDF / image / audio / video) ──
// Loads the file as a Blob and exposes an object URL, revoking it on
// unmount / file change. The browser streams media from the URL, so
// large media files play without loading everything into the DOM.
function useObjectUrl(fileNode) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let blobUrl = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    getFileObject(fileNode).then((f) => {
      if (cancelled) return;
      blobUrl = URL.createObjectURL(f);
      setUrl(blobUrl);
    }).catch((err) => {
      if (!cancelled) {
        console.error('Media read error:', err);
        setError(err.message || String(err));
      }
    });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [fileNode]);

  return { url, error };
}

// ── PDF ───────────────────────────────────────────────────
function PdfViewer({ file }) {
  const { url, error } = useObjectUrl(file.node);
  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;
  return <iframe src={url} className="pdf-viewer" title={file.name} />;
}

// ── HTML (rendered preview) ───────────────────────────────
// Renders the file in a sandboxed iframe. The iframe runs with a null
// origin (no allow-same-origin), so scripts in the previewed HTML cannot
// reach the app's storage or DOM — self-contained pages still render and
// stay interactive. Relative resource links won't resolve from a blob URL;
// use the source toggle for those.
function HtmlViewer({ file }) {
  const { url, error } = useObjectUrl(file.node);
  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;
  return (
    <iframe
      src={url}
      className="html-viewer"
      title={file.name}
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
    />
  );
}

// ── Image ─────────────────────────────────────────────────
function ImageViewer({ file }) {
  const { url, error } = useObjectUrl(file.node);
  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;
  return (
    <div className="image-viewer-wrapper">
      <img src={url} alt={file.name} className="image-viewer" />
    </div>
  );
}

// ── Audio ─────────────────────────────────────────────────
function AudioViewer({ file }) {
  const { url, error } = useObjectUrl(file.node);
  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;
  return (
    <div className="media-viewer-wrapper">
      <audio src={url} controls className="audio-viewer" />
      <div className="media-viewer-name">{file.name}</div>
    </div>
  );
}

// ── Video ─────────────────────────────────────────────────
function VideoViewer({ file }) {
  const { url, error } = useObjectUrl(file.node);
  if (error) return <ErrorDisplay message={error} />;
  if (!url) return <div className="content-loading">加载中…</div>;
  return (
    <div className="media-viewer-wrapper">
      <video src={url} controls className="video-viewer" />
    </div>
  );
}

// ── Code / text (syntax highlighted, with line numbers) ──
// Also serves as the universal fallback for unknown file types: when
// `fallback` is set, the file is probed and, if it looks binary, a
// download notice is shown instead of garbled text.
//
// Large-file safety: content is read capped (readFileTextCapped) and the
// line-number gutter is skipped past MAX_GUTTER_LINES so millions of DOM
// nodes are never created.
const MAX_GUTTER_LINES = 10000;

function CodeViewer({ file, scrollTarget, fallback = false }) {
  const [content, setContent] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [size, setSize] = useState(0);
  const [isBinary, setIsBinary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightedHtml, setHighlightedHtml] = useState(null);
  const preRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHighlightedHtml(null);
    setIsBinary(false);
    readFileTextCapped(file.node).then(({ text, size, truncated }) => {
      if (cancelled) return;
      // Unknown-type fallback: bail to the binary notice for non-text data.
      setIsBinary(fallback && looksBinary(text));
      setContent(text);
      setSize(size);
      setTruncated(truncated);
      setLoading(false);
    }).catch((err) => {
      if (!cancelled) {
        console.error('Code read error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node, fallback]);

  // Deferred highlighting — runs after paint so UI stays responsive
  useEffect(() => {
    if (loading || error || !content || isBinary) return;
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
  }, [content, loading, error, isBinary, file.name]);

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
  if (isBinary) return <BinaryNotice file={file} size={size} />;

  const lang = getCodeLanguage(file.name);
  const lineCount = content ? content.split('\n').length : 0;
  const showGutter = lineCount <= MAX_GUTTER_LINES;

  return (
    <>
      {truncated && (
        <div className="content-truncated-banner">
          文件较大，仅显示前 {formatFileSize(MAX_TEXT_VIEW_SIZE)}（共 {formatFileSize(size)}）
        </div>
      )}
      <div className="code-viewer">
        {showGutter && (
          <div className="code-gutter">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="code-line-num">{i + 1}</div>
            ))}
          </div>
        )}
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
    </>
  );
}

// ── Binary file notice (unknown, non-text file) ─────────
function BinaryNotice({ file, size }) {
  const openRaw = async () => {
    try {
      const f = await getFileObject(file.node);
      const url = URL.createObjectURL(f);
      window.open(url, '_blank', 'noopener');
      // Revoke later so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Open raw error:', err);
    }
  };
  return (
    <div className="content-unsupported">
      <div className="content-unsupported-icon">📦</div>
      <p>这是二进制文件，无法以文本方式预览</p>
      <p className="content-unsupported-name">
        {file.name}{size ? ` · ${formatFileSize(size)}` : ''}
      </p>
      <button className="tool-btn" onClick={openRaw} title="在新标签页用浏览器打开">
        用浏览器打开
      </button>
    </div>
  );
}
