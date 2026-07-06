import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getFileObject } from '../utils/fileSystem';

/**
 * ContentArea — renders the currently hovered file.
 *
 * Supported types: markdown, PDF, image, plain text.
 * All viewers include error handling — a failed read shows
 * an error message instead of hanging on "加载中…" forever.
 */
export default function ContentArea({ file }) {
  if (!file) {
    return (
      <main className="content-area">
        <div className="content-empty">
          <div className="content-empty-icon">📖</div>
          <p>将鼠标悬停在文件上即可阅读</p>
        </div>
      </main>
    );
  }

  return (
    <main className="content-area">
      <div className="content-body">
        {file.type === 'markdown' && <MarkdownViewer file={file} />}
        {file.type === 'pdf' && <PdfViewer file={file} />}
        {file.type === 'image' && <ImageViewer file={file} />}
        {file.type === 'text' && <TextViewer file={file} />}
        {file.type === 'other' && <UnsupportedViewer file={file} />}
      </div>
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

// ── Plain text ────────────────────────────────────────────
function TextViewer({ file }) {
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
        console.error('Text read error:', err);
        setError(err.message || String(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [file.node]);

  if (loading) return <div className="content-loading">加载中…</div>;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <pre className="text-viewer">
      <code>{content}</code>
    </pre>
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
