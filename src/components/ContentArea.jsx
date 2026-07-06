import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js';
import { getFileObject, getCodeLanguage } from '../utils/fileSystem';

const CONTENT_MIN = 400, CONTENT_MAX = 1800;

/**
 * ContentArea — renders the currently hovered file.
 *
 * Supported types: markdown (with code highlighting), PDF, image,
 * code (syntax highlighted via highlight.js), and other (fallback).
 *
 * The reading column has an adjustable max-width, controlled by a
 * draggable handle on its right edge.
 */
export default function ContentArea({ file, contentMaxWidth, setContentMaxWidth }) {
  const areaRef = useRef(null);
  const [areaWidth, setAreaWidth] = useState(9999);

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

  return (
    <main className="content-area" ref={areaRef}>
      <div className="content-body">
        {file.type === 'pdf' ? (
          <PdfViewer file={file} />
        ) : (
          <div className="content-inner" style={{ maxWidth: effMax }}>
            {file.type === 'markdown' && <MarkdownViewer file={file} />}
            {file.type === 'image' && <ImageViewer file={file} />}
            {(file.type === 'code' || file.type === 'text') && <CodeViewer file={file} />}
            {file.type === 'other' && <UnsupportedViewer file={file} />}
          </div>
        )}
      </div>
      <div
        className="content-resizer"
        style={{ left: Math.max(0, effMax - 3) }}
        onMouseDown={onContentResizeStart}
        title="拖动调整内容宽度"
      />
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

// ── Markdown ──────────────────────────────────────────────
function MarkdownViewer({ file }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
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

// ── Code (syntax highlighted) ─────────────────────────────
function CodeViewer({ file }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        console.error('Code read error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node]);

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  const lang = getCodeLanguage(file.name);
  const supported = lang !== 'plaintext' && hljs.getLanguage(lang);
  // Guard against huge files slowing down highlighting
  const tooLarge = content.length > 500_000;

  let html = null;
  if (supported && !tooLarge) {
    try {
      html = hljs.highlight(content, { language: lang }).value;
    } catch {
      html = null;
    }
  }

  return (
    <div className="code-viewer">
      <pre className="code-pre">
        {html ? (
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: html }}
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
