/**
 * RagChat — per-space semantic retrieval + AI Q&A panel.
 *
 * Indexing and querying run on the local clone-server (server/rag-engine.cjs).
 * Server-backed spaces are indexed by disk path; browser (FSA) spaces ship
 * their file contents to the backend. The OpenAI-compatible API key stays in
 * the browser (localStorage) and is sent per-request, never persisted server-side.
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { SparklesIcon, SettingsIcon, FileTypeIcon } from './Icons';
import { getRagConfig, setRagConfig, isRagConfigured } from '../utils/ragConfig';
import {
  getSpaceKey,
  getRagStatus,
  buildRagIndex,
  queryRag,
  clearRagIndex,
} from '../utils/rag';
import { collectDocuments } from '../utils/fileSystem';

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function RagPanelInner({ rootHandle, serverRoot, spaceId, rootName, onCitationClick }) {
  const spaceKey = getSpaceKey({ serverRoot, spaceId, rootName });

  const [config, setConfig] = useState(() => getRagConfig());
  // Expand the settings form automatically until the API is fully configured,
  // so the API Key / endpoint / model fields are editable right on the panel.
  const [showSettings, setShowSettings] = useState(() => !isRagConfigured());
  const [status, setStatus] = useState({ exists: false });
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, files, chunks, embedded }
  const [messages, setMessages] = useState([]); // { role, text, citations }
  const [question, setQuestion] = useState('');
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const configured = isRagConfigured(config);

  // Load index status whenever the active space changes.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setError('');
    setProgress(null);
    if (!spaceKey) {
      setStatus({ exists: false });
      return;
    }
    getRagStatus(spaceKey).then((s) => {
      if (!cancelled) setStatus(s || { exists: false });
    });
    return () => { cancelled = true; };
  }, [spaceKey]);

  // Auto-scroll the conversation on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Abort any in-flight request on unmount.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const persistConfig = useCallback((next) => {
    setConfig(next);
    setRagConfig(next);
  }, []);

  const updateField = useCallback((field, value) => {
    persistConfig({ ...config, [field]: value });
  }, [config, persistConfig]);

  const handleBuildIndex = useCallback(async () => {
    if (!spaceKey || indexing) return;
    if (!configured) { setShowSettings(true); setError('请先填写 API Key 与接口地址'); return; }

    setError('');
    setIndexing(true);
    setProgress({ phase: 'collecting', files: 0, chunks: 0, embedded: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let result;
      if (serverRoot) {
        // Server-backed space: backend walks the disk path directly.
        result = await buildRagIndex({
          key: spaceKey,
          serverRoot,
          config,
          onProgress: setProgress,
          signal: controller.signal,
        });
      } else {
        // FSA space: browser reads file contents, backend indexes them.
        const documents = await collectDocuments(rootHandle, {
          signal: controller.signal,
          onProgress: (p) => setProgress({ phase: 'collecting', files: p.files, chunks: 0, embedded: 0 }),
        });
        if (!documents.length) throw new Error('未找到可索引的文档');
        result = await buildRagIndex({
          key: spaceKey,
          documents,
          config,
          onProgress: setProgress,
          signal: controller.signal,
        });
      }
      setStatus({
        exists: true,
        chunks: result.chunks,
        files: result.files,
        embedModel: config.embedModel,
        updatedAt: result.updatedAt,
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message || '索引失败');
    } finally {
      setIndexing(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [spaceKey, indexing, configured, serverRoot, rootHandle, config]);

  const handleCancelIndex = useCallback(() => {
    abortRef.current?.abort();
    setIndexing(false);
    setProgress(null);
  }, []);

  const handleClearIndex = useCallback(async () => {
    if (!spaceKey || indexing) return;
    await clearRagIndex(spaceKey);
    setStatus({ exists: false });
    setMessages([]);
  }, [spaceKey, indexing]);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || querying || !spaceKey) return;
    if (!status.exists) { setError('请先为当前空间建立索引'); return; }
    if (!configured) { setShowSettings(true); setError('请先填写 API Key 与接口地址'); return; }

    setError('');
    setQuestion('');
    setQuerying(true);

    let asstIndex;
    setMessages((prev) => {
      const next = [...prev, { role: 'user', text: q }, { role: 'assistant', text: '', citations: null }];
      asstIndex = next.length - 1;
      return next;
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await queryRag({
        key: spaceKey,
        question: q,
        config,
        signal: controller.signal,
        onToken: (t) => {
          setMessages((prev) => {
            const next = [...prev];
            if (next[asstIndex]) next[asstIndex] = { ...next[asstIndex], text: next[asstIndex].text + t };
            return next;
          });
        },
        onCitations: (cites) => {
          setMessages((prev) => {
            const next = [...prev];
            if (next[asstIndex]) next[asstIndex] = { ...next[asstIndex], citations: cites };
            return next;
          });
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessages((prev) => {
          const next = [...prev];
          if (next[asstIndex]) next[asstIndex] = { ...next[asstIndex], text: next[asstIndex].text || `⚠️ ${e.message || '查询失败'}` };
          return next;
        });
      }
    } finally {
      setQuerying(false);
      abortRef.current = null;
    }
  }, [question, querying, spaceKey, status.exists, configured, config]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  }, [handleAsk]);

  const progressPct = progress && progress.chunks
    ? Math.min(100, Math.round((progress.embedded / progress.chunks) * 100))
    : 0;

  return (
    <div className="rag-panel">
      <div className="rag-header">
        <div className="rag-title">
          <SparklesIcon size={15} />
          <span>AI 问答</span>
        </div>
        <button
          className={`rag-icon-btn${showSettings ? ' active' : ''}`}
          onClick={() => setShowSettings((s) => !s)}
          title="模型设置"
        >
          <SettingsIcon size={14} />
        </button>
      </div>

      {showSettings && (
        <div className="rag-settings">
          <div className="rag-settings-group">向量模型（用于索引/检索）</div>
          <label className="rag-field">
            <span>接口地址</span>
            <input
              className="rag-input"
              type="text"
              value={config.embedBase}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => updateField('embedBase', e.target.value)}
            />
          </label>
          <label className="rag-field">
            <span>API Key</span>
            <input
              className="rag-input"
              type="password"
              value={config.embedKey}
              placeholder="sk-..."
              onChange={(e) => updateField('embedKey', e.target.value)}
            />
          </label>
          <label className="rag-field">
            <span>向量模型</span>
            <input
              className="rag-input"
              type="text"
              value={config.embedModel}
              placeholder="text-embedding-3-small"
              onChange={(e) => updateField('embedModel', e.target.value)}
            />
          </label>

          <div className="rag-settings-group">对话模型（用于问答）</div>
          <label className="rag-field">
            <span>接口地址</span>
            <input
              className="rag-input"
              type="text"
              value={config.chatBase}
              placeholder="https://api.deepseek.com/v1"
              onChange={(e) => updateField('chatBase', e.target.value)}
            />
          </label>
          <label className="rag-field">
            <span>API Key</span>
            <input
              className="rag-input"
              type="password"
              value={config.chatKey}
              placeholder="sk-..."
              onChange={(e) => updateField('chatKey', e.target.value)}
            />
          </label>
          <label className="rag-field">
            <span>对话模型</span>
            <input
              className="rag-input"
              type="text"
              value={config.chatModel}
              placeholder="deepseek-chat"
              onChange={(e) => updateField('chatModel', e.target.value)}
            />
          </label>
          <p className="rag-settings-hint">
            向量与对话可用不同服务商。注意 DeepSeek 无向量模型，向量请用 OpenAI / SiliconFlow / 通义 等。
            所有配置仅存本地浏览器，随请求发送，不写入服务器。
          </p>
        </div>
      )}

      <div className="rag-index-bar">
        <div className="rag-index-info">
          {status.exists ? (
            <>
              <span>已索引 {status.files} 文件 · {status.chunks} 片段</span>
              {status.updatedAt && <span className="rag-index-time">{formatTime(status.updatedAt)}</span>}
            </>
          ) : (
            <span>当前空间尚未建立索引</span>
          )}
        </div>
        <div className="rag-index-actions">
          {indexing ? (
            <button className="rag-btn" onClick={handleCancelIndex}>取消</button>
          ) : (
            <>
              <button className="rag-btn" onClick={handleBuildIndex} disabled={!spaceKey}>
                {status.exists ? '重建索引' : '建立索引'}
              </button>
              {status.exists && (
                <button className="rag-btn" onClick={handleClearIndex}>清除</button>
              )}
            </>
          )}
        </div>
      </div>

      {indexing && progress && (
        <div className="rag-progress">
          <div className="rag-progress-bar">
            <div className="rag-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span>
            {progress.phase === 'collecting'
              ? `收集文档 ${progress.files} 个`
              : `向量化 ${progress.embedded}/${progress.chunks} 片段`}
          </span>
        </div>
      )}

      {error && <div className="rag-error">{error}</div>}

      <div className="rag-conversation" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="rag-empty">
            {status.exists
              ? '就当前空间的笔记内容提问，回答会附带来源引用。'
              : '先建立索引，然后即可基于笔记内容进行问答。'}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`rag-msg rag-msg-${m.role}`}>
              <div className="rag-msg-text">
                {m.text}
                {m.role === 'assistant' && querying && i === messages.length - 1 && (
                  <span className="rag-cursor">▋</span>
                )}
              </div>
              {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                <div className="rag-citations">
                  {m.citations.map((c) => (
                    <button
                      key={c.n}
                      className="rag-citation"
                      title={c.snippet || c.path}
                      onClick={() => onCitationClick?.(c)}
                    >
                      <span className="rag-citation-n">[{c.n}]</span>
                      <FileTypeIcon name={c.name} size={13} />
                      <span className="rag-citation-name">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="rag-ask">
        <textarea
          className="rag-ask-input"
          rows={2}
          value={question}
          placeholder={status.exists ? '输入问题，Enter 发送…' : '请先建立索引'}
          disabled={!status.exists || querying}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="rag-ask-btn"
          onClick={handleAsk}
          disabled={!status.exists || querying || !question.trim()}
        >
          {querying ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
}

const RagPanel = memo(RagPanelInner);
export default RagPanel;
