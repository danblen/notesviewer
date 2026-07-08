import { useState, useRef, useCallback, useEffect } from 'react';
import { ExitIcon } from './Icons';
import { cloneRepo, pickFolder, saveLastPath, checkHealth, searchRepos } from '../utils/clone';
import { getServerUrl, setServerUrl, getServerLabel, isDev } from '../utils/apiConfig';

const DEFAULT_DEST = '/Volumes/z/codemy';
let _taskId = 0;

function taskIcon(status) {
  if (status === 'cloning') return '⏳';
  if (status === 'done') return '✓';
  if (status === 'error') return '✗';
  return '';
}

export default function CloneModal({ onClose, onOpenAsSpace }) {
  const [repo, setRepo] = useState('');
  const [dest, setDest] = useState(DEFAULT_DEST);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [editingServer, setEditingServer] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');

  // Search dropdown
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  // Multi-clone tasks
  const [tasks, setTasks] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // Dragging
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const modalRef = useRef(null);

  const repoInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Health (re-runnable so the UI can reconnect after changing the server URL)
  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealth(await checkHealth());
    setHealthLoading(false);
  }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  // Debounced search
  useEffect(() => {
    const q = repo.trim();
    if (!q || q.length < 2) { setResults([]); setShowDropdown(false); setSearching(false); return; }
    setSearching(true);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      const items = await searchRepos(q);
      setResults(items);
      setShowDropdown(items.length > 0);
      setHighlightIdx(-1);
      setSearching(false);
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [repo]);

  // Click outside closes dropdown
  useEffect(() => {
    const onClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          repoInputRef.current && !repoInputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setShowDropdown(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const repoName = (s) => {
    const name = (s || '').includes('/') ? s.split('/').pop() : '';
    return name.replace(/\.git$/, '');
  };

  const selectRepo = useCallback((item) => {
    setRepo(item.full_name);
    setShowDropdown(false);
    setDest(`${DEFAULT_DEST}/${repoName(item.full_name)}`);
  }, []);

  const handlePickFolder = useCallback(async () => {
    const result = await pickFolder();
    if (result.path) {
      const name = repoName(repo);
      setDest(name ? `${result.path}/${name}` : result.path);
    }
  }, [repo]);

  const getCloneDest = useCallback(() => {
    const name = repoName(repo);
    if (!name) return dest;
    if (dest.endsWith('/' + name)) return dest;
    return `${dest.replace(/\/$/, '')}/${name}`;
  }, [repo, dest]);

  // ── Server URL config (lets GitHub Pages deployments point at a local service) ──
  const startEditServer = useCallback(() => {
    setServerUrlInput(getServerUrl() || (isDev() ? '' : 'http://localhost:5181'));
    setEditingServer(true);
  }, []);

  const saveServerUrl = useCallback(async () => {
    setServerUrl(serverUrlInput);
    setEditingServer(false);
    await refreshHealth();
  }, [serverUrlInput, refreshHealth]);

  const cancelEditServer = useCallback(() => setEditingServer(false), []);

  const resetServerUrl = useCallback(async () => {
    setServerUrl('');
    setServerUrlInput('');
    setEditingServer(false);
    await refreshHealth();
  }, [refreshHealth]);

  // ── Clone as task ──
  const handleClone = useCallback(() => {
    if (!repo.trim() || !getCloneDest()) return;
    const cloneDest = getCloneDest();
    const id = `t${++_taskId}`;
    const name = repoName(repo) || repo.trim();

    const task = { id, repo: repo.trim(), name, dest: cloneDest, status: 'cloning', progress: '', error: null };
    setTasks((prev) => [...prev, task]);
    setActiveId(id);

    const cancelFn = cloneRepo(repo.trim(), cloneDest, {
      onProgress: (t) => {
        setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, progress: tk.progress + t } : tk));
      },
      onDone: (path) => {
        setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, status: 'done', progress: tk.progress + `✓ ${path}\n` } : tk));
        saveLastPath(cloneDest);
      },
      onError: (err) => {
        setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, status: 'error', error: err } : tk));
      },
    });
    setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, cancelFn } : tk));
  }, [repo, getCloneDest]);

  const cancelTask = useCallback((id) => {
    setTasks((prev) => {
      const t = prev.find((tk) => tk.id === id);
      if (t && t.cancelFn) t.cancelFn();
      return prev.map((tk) => tk.id === id ? { ...tk, status: 'idle' } : tk);
    });
  }, []);

  const activeTask = tasks.find((t) => t.id === activeId);

  // ── Dragging ──
  const onDragStart = useCallback((e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX - drag.x, y: e.clientY - drag.y };
    document.body.style.userSelect = 'none';
  }, [drag]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setDrag({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    };
    const onUp = () => { dragging.current = false; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const canClone = repo.trim() && getCloneDest();

  // ── Keyboard: repo input ──
  const onRepoKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setShowDropdown(false); return; }
    if (showDropdown && results.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((p) => Math.min(p + 1, results.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((p) => Math.max(p - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); selectRepo(results[Math.max(0, highlightIdx)]); return; }
    }
    if (e.key === 'Enter' && canClone) handleClone();
  }, [showDropdown, results, highlightIdx, canClone, handleClone, selectRepo]);

  const showDestHint = dest.trim() === DEFAULT_DEST || dest.trim().startsWith(DEFAULT_DEST + '/');

  return (
    <div className="clone-overlay">
      <div ref={modalRef} className="clone-modal" style={{ transform: `translate(calc(-50% + ${drag.x}px), calc(-50% + ${drag.y}px))` }}>
        {/* Draggable header */}
        <div className="clone-header" onMouseDown={onDragStart}>
          <span className="clone-title">克隆 GitHub 项目</span>
          <button className="clone-close" onClick={onClose}><ExitIcon size={14} /></button>
        </div>

        {/* Server connection bar — shows status + lets users configure the backend URL */}
        <div className="clone-server-bar">
          <div className="clone-server-row">
            <span className={`clone-server-dot ${health?.ok ? 'ok' : health ? 'down' : 'pending'}`} />
            <span className="clone-server-status">
              {healthLoading ? '检测中…' : !health ? '' : health.ok ? '克隆服务已连接' : '克隆服务未连接'}
            </span>
            <span className="clone-server-url" title={getServerLabel()}>{getServerLabel()}</span>
            <div className="clone-server-actions">
              {!editingServer && <button className="clone-server-btn" onClick={startEditServer}>配置</button>}
              {!editingServer && health && !health.ok && <button className="clone-server-btn" onClick={refreshHealth}>重试</button>}
            </div>
          </div>
          {editingServer && (
            <div className="clone-server-edit-row">
              <input className="clone-input clone-input-sm" type="text"
                value={serverUrlInput} onChange={(e) => setServerUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveServerUrl(); if (e.key === 'Escape') cancelEditServer(); }}
                placeholder="http://localhost:5181" spellCheck={false} autoComplete="off" autoFocus />
              <button className="clone-server-btn primary" onClick={saveServerUrl}>保存</button>
              <button className="clone-server-btn" onClick={cancelEditServer}>取消</button>
              <button className="clone-server-btn" onClick={resetServerUrl} title="恢复默认地址">重置</button>
            </div>
          )}
          {health && !health.ok && (
            <div className="clone-server-hint">
              {health.error ? `${health.error}。` : ''}
              {isDev()
                ? '请确认克隆服务已随开发服务器启动（查看终端日志）'
                : <>GitHub Pages 无后端，需在本地启动克隆服务：在 notesview 目录运行 <code>npm run server</code>，再点击「重试」。浏览器需允许访问 localhost。</>}
            </div>
          )}
        </div>

        <div className="clone-body">
          {/* Repo input */}
          <div className="clone-field">
            <span className="clone-label">仓库</span>
            <div className="clone-search-wrap">
              <input ref={repoInputRef} className="clone-input clone-input-lg" type="text"
                value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={onRepoKeyDown}
                onFocus={() => { if (results.length) setShowDropdown(true); }}
                placeholder="搜索 GitHub 仓库…" autoFocus spellCheck={false} autoComplete="off" />
              {searching && <span className="clone-search-spinner" />}
              {showDropdown && (
                <div ref={dropdownRef} className="clone-search-dropdown">
                  {results.map((item, i) => (
                    <div key={item.full_name} className={`clone-search-item ${i === highlightIdx ? 'highlight' : ''}`}
                      onMouseEnter={() => setHighlightIdx(i)}
                      onMouseDown={(e) => { e.preventDefault(); selectRepo(item); }}>
                      <div className="clone-search-name">
                        <span className="clone-search-owner">{item.full_name.split('/')[0]}/</span>
                        <span className="clone-search-repo">{item.full_name.split('/')[1]}</span>
                        <span className="clone-search-stars-inline">★ {item.stars?.toLocaleString() || 0}</span>
                      </div>
                      <div className="clone-search-desc">{item.description || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Dest */}
          <div className="clone-field">
            <span className="clone-label">保存至</span>
            <div className="clone-path-row">
              <input className="clone-input clone-input-sm" type="text"
                value={dest} onChange={(e) => setDest(e.target.value)}
                placeholder="/Volumes/z/codemy" spellCheck={false} />
              <button className="clone-pick-btn" onClick={handlePickFolder}>浏览…</button>
            </div>
            {showDestHint && <span className="clone-dest-hint">默认存储位置，若不存在将自动创建</span>}
          </div>

          {/* Task list */}
          {tasks.length > 0 && (
            <div className="clone-task-list">
              {tasks.map((t) => (
                <div key={t.id}
                  className={`clone-task-item ${t.id === activeId ? 'active' : ''} ${t.status}`}
                  onClick={() => setActiveId(t.id)}>
                  <span className="clone-task-status">{taskIcon(t.status)}</span>
                  <span className="clone-task-name">{t.name}</span>
                  <span className="clone-task-path" title={t.dest}>{t.status === 'cloning' ? '克隆中…' : t.dest}</span>
                  <span className="clone-task-actions">
                    {t.status === 'cloning' && (
                      <button className="clone-task-cancel" onClick={(e) => { e.stopPropagation(); cancelTask(t.id); }}>取消</button>
                    )}
                    {t.status === 'done' && onOpenAsSpace && (
                      <button className="clone-task-open" onClick={(e) => { e.stopPropagation(); onOpenAsSpace(t.dest); }}
                        title="打开为笔记空间">打开</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Active task detail */}
          {activeTask && (activeTask.status === 'cloning' || activeTask.status === 'done' || activeTask.status === 'error') && (
            <div className="clone-progress-wrap">
              <div className={`clone-progress ${activeTask.status === 'error' ? 'has-error' : ''} ${activeTask.status === 'done' ? 'has-done' : ''}`}>
                {activeTask.progress || '准备中…'}
              </div>
            </div>
          )}

          {activeTask && activeTask.status === 'error' && activeTask.error && (
            <div className="clone-error-box">
              <div className="clone-error-msg">{activeTask.error.message}</div>
              {activeTask.error.suggestion && <div className="clone-error-suggestion">{activeTask.error.suggestion}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="clone-footer">
          <button className="clone-btn ghost" onClick={onClose}>关闭</button>
          <button className="clone-btn primary" onClick={handleClone} disabled={!canClone}>克隆</button>
        </div>
      </div>
    </div>
  );
}
