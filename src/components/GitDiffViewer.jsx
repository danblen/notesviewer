import { useMemo } from 'react';
import * as Diff from 'diff';

// Split lines helper
function splitLines(text) {
  if (!text) return [];
  const s = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (s === '') return [''];
  return s.split('\n');
}

// Build aligned diff rows for split view
function buildSplitRows(oldText, newText) {
  const changes = Diff.diffLines(oldText || '', newText || '');
  const rows = [];
  let oldNum = 1, newNum = 1;

  for (let i = 0; i < changes.length; i++) {
    const part = changes[i];
    const lines = splitLines(part.value);
    if (!part.added && !part.removed) {
      for (const line of lines) {
        rows.push({ type: 'context', oldNum: oldNum++, newNum: newNum++, oldContent: line, newContent: line });
      }
    } else if (part.removed) {
      const removedLines = lines;
      const nextPart = changes[i + 1];
      const addedLines = nextPart && nextPart.added ? splitLines(nextPart.value) : [];
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        const oldC = j < removedLines.length ? removedLines[j] : null;
        const newC = j < addedLines.length ? addedLines[j] : null;
        rows.push({
          type: oldC !== null && newC !== null ? 'modified' : (oldC !== null ? 'removed' : 'added'),
          oldNum: oldC !== null ? oldNum++ : null,
          newNum: newC !== null ? newNum++ : null,
          oldContent: oldC, newContent: newC,
        });
      }
      if (nextPart && nextPart.added) i++;
    } else if (part.added) {
      for (const line of lines) {
        rows.push({ type: 'added', oldNum: null, newNum: newNum++, oldContent: null, newContent: line });
      }
    }
  }
  return rows;
}

function wordDiff(oldLine, newLine) {
  if (!oldLine || !newLine) return null;
  const parts = Diff.diffWordsWithSpace(oldLine, newLine);
  return {
    old: parts.filter(p => !p.added).map(p => ({ text: p.value, type: p.removed ? 'del' : 'equal' })),
    new: parts.filter(p => !p.removed).map(p => ({ text: p.value, type: p.added ? 'add' : 'equal' })),
  };
}

const STATUS_LABELS = {
  modified: '已修改', added: '新增', untracked: '未跟踪', deleted: '已删除', renamed: '重命名',
};

export default function GitDiffViewer({ gitFile, diffData, diffLoading, diffError, onClose }) {
  const rows = useMemo(() => {
    if (!diffData) return [];
    return buildSplitRows(diffData.oldText, diffData.newText);
  }, [diffData]);

  if (!gitFile) return null;

  return (
    <div className="git-diff-viewer-full">
      <div className="git-diff-viewer-header">
        <div className="git-diff-viewer-title">
          <span className="git-diff-viewer-file">{gitFile.path}</span>
          <span className="git-diff-viewer-status">{STATUS_LABELS[gitFile.status] || gitFile.status}</span>
        </div>
        <button className="git-icon-btn" onClick={onClose} title="关闭差异对比">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="git-diff-viewer-body">
        {diffLoading ? (
          <div className="content-loading">加载差异…</div>
        ) : diffError ? (
          <div className="content-error">
            <div className="content-error-icon">⚠️</div>
            <p>无法加载差异</p>
            <p className="content-error-detail">{diffError}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="git-diff-empty">无差异内容</div>
        ) : (
          <div className="git-diff-viewer-split">
            <div className="git-diff-viewer-headers">
              <div className="git-diff-pane-header">原始 (HEAD)</div>
              <div className="git-diff-pane-header">当前</div>
            </div>
            <div className="git-diff-rows">
              {rows.map((row, idx) => (
                <div key={idx} className="git-diff-row-pair">
                  <DiffRowSide row={row} side="old" />
                  <div className="git-diff-divider" />
                  <DiffRowSide row={row} side="new" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffRowSide({ row, side }) {
  const isOld = side === 'old';
  const lineNum = isOld ? row.oldNum : row.newNum;
  const content = isOld ? row.oldContent : row.newContent;

  let rowClass = 'git-diff-row-side';
  if (row.type === 'context') rowClass += ' context';
  else if (isOld && (row.type === 'removed' || row.type === 'modified')) rowClass += ' removed';
  else if (!isOld && (row.type === 'added' || row.type === 'modified')) rowClass += ' added';
  else if (content === null) rowClass += ' empty';

  let segments = null;
  if (row.type === 'modified' && row.oldContent !== null && row.newContent !== null) {
    const hl = wordDiff(row.oldContent, row.newContent);
    segments = isOld ? hl.old : hl.new;
  }

  return (
    <div className={rowClass}>
      <span className="git-diff-linenum">{lineNum ?? ''}</span>
      <span className="git-diff-line-content">
        {content === null ? '' : (
          segments ? segments.map((seg, i) => (
            <span key={i} className={`git-word-${seg.type}`}>{seg.text}</span>
          )) : content
        )}
      </span>
    </div>
  );
}
