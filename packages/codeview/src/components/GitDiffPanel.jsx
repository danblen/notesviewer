import { useState, useMemo } from 'react';
import { ChevronRight, FileIcon, FolderIcon } from './Icons';
import { buildChangeTree } from '../provider/shared';

const STATUS_CONFIG = {
  modified:  { label: 'M', color: '#d29922', bg: 'rgba(210, 153, 34, 0.12)', title: '已修改' },
  added:     { label: 'A', color: '#3fb950', bg: 'rgba(63, 185, 80, 0.12)',  title: '新增' },
  untracked: { label: 'U', color: '#3fb950', bg: 'rgba(63, 185, 80, 0.12)',  title: '未跟踪' },
  deleted:   { label: 'D', color: '#f85149', bg: 'rgba(248, 81, 73, 0.12)',  title: '已删除' },
  renamed:   { label: 'R', color: '#58a6ff', bg: 'rgba(88, 166, 255, 0.12)', title: '重命名' },
};

function ChangeTreeNode({ node, depth, selectedPath, onFileClick }) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 14;

  if (node.kind === 'file') {
    const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.modified;
    const isSelected = selectedPath === node.path;
    return (
      <div
        className={`git-tree-file ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + indent }}
        onMouseEnter={() => onFileClick(node)}
        title={node.path}
      >
        <span className="git-file-icon"><FileIcon size={13} /></span>
        <span className="git-file-name">{node.name}</span>
        <span className="git-status-badge" style={{ color: cfg.color, background: cfg.bg }} title={cfg.title}>
          {cfg.label}
        </span>
      </div>
    );
  }

  return (
    <div className="git-tree-dir-group">
      <div
        className="git-tree-dir"
        style={{ paddingLeft: 4 + indent }}
        onClick={() => setExpanded(v => !v)}
      >
        <span className={`git-chevron ${expanded ? 'expanded' : ''}`}><ChevronRight size={11} /></span>
        <span className="git-dir-icon"><FolderIcon size={14} /></span>
        <span className="git-dir-name">{node.name}</span>
      </div>
      {expanded && node.children?.map((child) => (
        <ChangeTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

export default function GitDiffPanel({
  changes,
  branch,
  loading,
  error,
  onRefresh,
  onFileClick,
  selectedFile,
  onClose,
  width,
}) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);

  const counts = useMemo(() => {
    const c = { modified: 0, added: 0, deleted: 0, renamed: 0 };
    for (const ch of changes) {
      if (c[ch.status] !== undefined) c[ch.status]++;
    }
    return c;
  }, [changes]);

  return (
    <div className="git-panel" style={width ? { width } : undefined}>
      <div className="git-panel-header">
        <div className="git-panel-title">
          <span className="git-branch-icon" title="Git 分支">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.1" />
              <path d="M4 5v6M4 8c0-2 8-2 8-4.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
            </svg>
          </span>
          <span className="git-branch-name">{branch}</span>
          <span className="git-change-count">{changes.length}</span>
        </div>
        <div className="git-panel-actions">
          <button className="git-icon-btn" onClick={onRefresh} title="刷新" disabled={loading}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={loading ? 'spinning' : ''}>
              <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
          <button className="git-icon-btn" onMouseEnter={onClose} title="关闭">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {changes.length > 0 && (
        <div className="git-summary">
          {counts.modified > 0 && <span className="git-chip modified">{counts.modified} 修改</span>}
          {counts.added > 0 && <span className="git-chip added">{counts.added} 新增</span>}
          {counts.deleted > 0 && <span className="git-chip deleted">{counts.deleted} 删除</span>}
          {counts.renamed > 0 && <span className="git-chip renamed">{counts.renamed} 重命名</span>}
        </div>
      )}

      <div className="git-panel-body">
        {loading ? (
          <div className="git-panel-msg">分析 Git 状态中…</div>
        ) : error ? (
          <div className="git-panel-msg error">{error}</div>
        ) : changes.length === 0 ? (
          <div className="git-panel-msg">
            <div className="git-clean-icon">✓</div>
            <p>工作区干净，无未提交的更改</p>
          </div>
        ) : (
          <div className="git-tree-section" style={{ flex: 1, maxHeight: '100%' }}>
            <div className="git-tree-header">更改的文件</div>
            <div className="git-tree-list">
              {tree.map((node) => (
                <ChangeTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedFile?.path}
                  onFileClick={onFileClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
