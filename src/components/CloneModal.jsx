import { useState, useRef, useCallback, useEffect } from 'react';
import { ExitIcon } from './Icons';
import { cloneRepo, pickFolder, getLastPath, saveLastPath, checkHealth, parseErrorFromLog } from '../utils/clone';

/**
 * CloneModal — clone a GitHub repository to a local path.
 *
 * Flow:
 *   1. Enter repo (owner/name or URL)
 *   2. Choose destination (type or pick folder — last path pre-filled)
 *   3. Click 克隆 → SSE progress stream → done/error
 *
 * Error handling: server returns structured errors; as a fallback we
 * re-parse the accumulated log for friendly messages.
 */
export default function CloneModal({ onClose }) {

  const extractRepoName = (input) => {
    const s = input.trim();
    if (!s) return null;
    const m = s.match(/(?:github\.com[/:][\w.-]+\/|^)([\w.-]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  };
  const [repo, setRepo] = useState('');
  const [dest, setDest] = useState(() => getLastPath() || '');
  const [status, setStatus] = useState('idle'); // idle | cloning | done | error
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const cancelRef = useRef(null);
  const logRef = useRef('');
  const progressRef = useRef(null);

  // Check server health on mount
  useEffect(() => {
    checkHealth().then(setHealth);
  }, []);

  // Auto-scroll progress to bottom
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [progress]);

  // Escape to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && status !== 'cloning') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, status]);

  const handlePickFolder = useCallback(async () => {
    const result = await pickFolder();
    if (result.path) {
      const repoName = extractRepoName(repo);
      const targetPath = repoName ? `${result.path}/${repoName}` : result.path;
      setDest(targetPath);
    }
  }, [repo]);

  const handleClone = useCallback(() => {
    if (!repo.trim() || !dest.trim() || status === 'cloning') return;

    setStatus('cloning');
    setProgress('');
    setError(null);
    logRef.current = '';

    cancelRef.current = cloneRepo(repo.trim(), dest.trim(), {
      onProgress: (text) => {
        logRef.current += text;
        setProgress((prev) => prev + text);
      },
      onDone: (path) => {
        setStatus('done');
        setProgress((prev) => prev + `\n✓ 克隆完成：${path}\n`);
        saveLastPath(dest.trim());
      },
      onError: (err) => {
        // Try to extract a friendlier message from the accumulated log
        const parsed = parseErrorFromLog(logRef.current);
        const finalErr = parsed || err;
        setStatus('error');
        setError(finalErr);
      },
    });
  }, [repo, dest, status]);

  const handleCancel = useCallback(() => {
    if (cancelRef.current) cancelRef.current();
    setStatus('idle');
    setProgress('');
  }, []);

  const handleClose = useCallback(() => {
    if (status === 'cloning') {
      handleCancel();
    }
    onClose();
  }, [status, onClose, handleCancel]);

  const canClone = repo.trim() && dest.trim() && status !== 'cloning';

  return (
    <div className="clone-overlay" onClick={handleClose}>
      <div className="clone-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="clone-header">
          <div className="clone-title">
            <span>克隆 GitHub 项目</span>
          </div>
          <button className="clone-close" onClick={handleClose} title="关闭">
            <ExitIcon size={14} />
          </button>
        </div>

        {/* Health warning */}
        {health && !health.ok && (
          <div className="clone-health-warn">
            {health.error || '克隆服务未就绪 — 请确保开发服务器正在运行'}
          </div>
        )}

        {/* Body */}
        <div className="clone-body">
          <label className="clone-field">
            <span className="clone-label">仓库地址</span>
            <input
              className="clone-input"
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canClone) handleClone(); }}
              placeholder="owner/repo 或 https://github.com/owner/repo"
              autoFocus
              disabled={status === 'cloning'}
              spellCheck={false}
            />
          </label>

          <label className="clone-field">
            <span className="clone-label">保存位置</span>
            <div className="clone-path-row">
              <input
                className="clone-input"
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="选择或输入本地路径"
                disabled={status === 'cloning'}
                spellCheck={false}
              />
              <button
                className="clone-pick-btn"
                onClick={handlePickFolder}
                disabled={status === 'cloning'}
                title="选择文件夹"
              >
                选择…
              </button>
            </div>
          </label>

          {/* Progress / error display */}
          {(status === 'cloning' || status === 'done' || status === 'error') && (
            <div className="clone-progress-wrap">
              <div
                ref={progressRef}
                className={`clone-progress ${status === 'error' ? 'has-error' : ''} ${status === 'done' ? 'has-done' : ''}`}
              >
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

          {status === 'done' && (
            <div className="clone-done-box">
              <span>✓ 克隆成功！可在「打开目录…」中选择该文件夹查看。</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="clone-footer">
          {status === 'cloning' ? (
            <button className="clone-btn cancel" onClick={handleCancel}>
              取消克隆
            </button>
          ) : (
            <>
              <button className="clone-btn ghost" onClick={handleClose}>
                {status === 'done' ? '关闭' : '取消'}
              </button>
              <button
                className="clone-btn primary"
                onClick={handleClone}
                disabled={!canClone}
              >
                克隆
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
