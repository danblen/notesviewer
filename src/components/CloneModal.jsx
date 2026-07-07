import { useState, useRef, useCallback, useEffect } from 'react';
import { ExitIcon } from './Icons';
import { cloneRepo, pickFolder, saveLastPath, checkHealth, parseErrorFromLog, searchRepos } from '../utils/clone';

const DEFAULT_DEST = '/Volumes/z/codemy';

export default function CloneModal({ onClose }) {
  const [repo, setRepo] = useState('');
  const [dest, setDest] = useState(DEFAULT_DEST);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);

  // Search dropdown
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const cancelRef = useRef(null);
  const logRef = useRef('');
  const progressRef = useRef(null);
  const repoInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Check server health on mount
  useEffect(() => { checkHealth().then(setHealth); }, []);

  // Auto-scroll progress
  useEffect(() => {
    if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
  }, [progress]);

  // Escape to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && status !== 'cloning') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, status]);

  // Debounced GitHub search
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)
        && repoInputRef.current && !repoInputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const repoName = (item) => (item.full_name || item).split('/')[1] || '';

  const selectRepo = useCallback((item) => {
    setRepo(item.full_name);
    setShowDropdown(false);
    setDest(`${DEFAULT_DEST}/${repoName(item)}`);
  }, []);

  const handlePickFolder = useCallback(async () => {
    const result = await pickFolder();
    if (result.path) {
      const name = repo.includes('/') ? repo.split('/')[1] : '';
      setDest(name ? `${result.path}/${name}` : result.path);
    }
  }, [repo]);

  const handleClone = useCallback(() => {
    if (!repo.trim() || !dest.trim() || status === 'cloning') return;
    const name = (repo.includes('/') ? repo.split('/').pop() : '').replace(/\.git$/, '');
    const cloneDest = name && !dest.endsWith('/' + name) ? `${dest.replace(/\/$/, '')}/${name}` : dest;
    setStatus('cloning');
    setProgress('');
    setError(null);
    logRef.current = '';
    cancelRef.current = cloneRepo(repo.trim(), cloneDest, {
      onProgress: (t) => { logRef.current += t; setProgress((p) => p + t); },
      onDone: (path) => {
        setStatus('done');
        setProgress((p) => p + `\n✓ ${path}\n`);
        saveLastPath(path);
      },
      onError: (err) => { setStatus('error'); setError(parseErrorFromLog(logRef.current) || err); },
    });
  }, [repo, dest, status]);

  const handleCancel = useCallback(() => {
    if (cancelRef.current) cancelRef.current();
    setStatus('idle'); setProgress('');
  }, []);

  const handleClose = useCallback(() => {
    if (status === 'cloning') handleCancel();
    onClose();
  }, [status, onClose, handleCancel]);

  const canClone = repo.trim() && dest.trim() && status !== 'cloning';
  const showDestHint = dest.trim() === DEFAULT_DEST || dest.trim().startsWith(DEFAULT_DEST + '/');

  const onRepoKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setShowDropdown(false); return; }
    if (showDropdown && results.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx((p) => Math.min(p + 1, results.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx((p) => Math.max(p - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); selectRepo(results[Math.max(0, highlightIdx)]); return; }
    }
    if (e.key === 'Enter' && canClone) handleClone();
  }, [showDropdown, results, highlightIdx, canClone, handleClone, selectRepo]);

  return (
    <div className="clone-overlay" onClick={handleClose}>
      <div className="clone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="clone-header">
          <span className="clone-title">克隆 GitHub 项目</span>
          <button className="clone-close" onClick={handleClose}><ExitIcon size={14} /></button>
        </div>

        {health && !health.ok && <div className="clone-health-warn">{health.error || '克隆服务未就绪'}</div>}

        <div className="clone-body">
          <div className="clone-field">
            <span className="clone-label">仓库</span>
            <div className="clone-search-wrap">
              <input ref={repoInputRef} className="clone-input clone-input-lg" type="text"
                value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={onRepoKeyDown}
                onFocus={() => { if (results.length) setShowDropdown(true); }}
                placeholder="搜索 GitHub 仓库…" autoFocus disabled={status === 'cloning'}
                spellCheck={false} autoComplete="off" />
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

          <div className="clone-field">
            <span className="clone-label">保存至</span>
            <div className="clone-path-row">
              <input className="clone-input clone-input-sm" type="text"
                value={dest} onChange={(e) => setDest(e.target.value)}
                placeholder="/Volumes/z/codemy" disabled={status === 'cloning'} spellCheck={false} />
              <button className="clone-pick-btn" onClick={handlePickFolder} disabled={status === 'cloning'}>浏览…</button>
            </div>
            {showDestHint && <span className="clone-dest-hint">默认存储位置，若不存在将自动创建</span>}
          </div>

          {(status === 'cloning' || status === 'done' || status === 'error') && (
            <div className="clone-progress-wrap">
              <div ref={progressRef} className={`clone-progress ${status === 'error' ? 'has-error' : ''} ${status === 'done' ? 'has-done' : ''}`}>
                {progress}
              </div>
            </div>
          )}

          {status === 'error' && error && (
            <div className="clone-error-box">
              <div className="clone-error-msg">{error.message}</div>
              {error.suggestion && <div className="clone-error-suggestion">{error.suggestion}</div>}
            </div>
          )}

          {status === 'done' && <div className="clone-done-box">✓ 克隆成功</div>}
        </div>

        <div className="clone-footer">
          {status === 'cloning' ? (
            <button className="clone-btn cancel" onClick={handleCancel}>取消</button>
          ) : (
            <>
              <button className="clone-btn ghost" onClick={handleClose}>{status === 'done' ? '关闭' : '取消'}</button>
              <button className="clone-btn primary" onClick={handleClone} disabled={!canClone}>克隆</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
