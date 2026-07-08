import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { SearchIcon, RegexIcon, CaseSensitiveIcon, FileTypeIcon } from './Icons';
import { searchInTree } from '../utils/fileSystem';

/**
 * SearchPanel — full-text search across the current space.
 *
 * Features:
 *  - Plain text or regex search (toggle .* button)
 *  - Case sensitivity toggle (Aa button)
 *  - Results grouped by file, showing line number + match preview
 *  - Hover a result → opens the file in the content area and reveals
 *    its location in the sidebar tree (via onHoverResult callback)
 *
 * Search is debounced (300ms) and cancellable (AbortController).
 * Files > 1MB are skipped; binary/image/PDF files are excluded.
 */
function SearchPanelInner({ rootHandle, onHoverResult, onLeaveResult }) {
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState({ files: 0, matches: 0 });
  const [regexError, setRegexError] = useState(false);
  const abortRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-focus the input when the panel mounts
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q || !rootHandle) {
      setResults([]);
      setSearching(false);
      setProgress({ files: 0, matches: 0 });
      setRegexError(false);
      return;
    }

    // Validate regex upfront
    if (useRegex) {
      try { new RegExp(q, caseSensitive ? 'g' : 'gi'); }
      catch { setRegexError(true); setSearching(false); return; }
    }
    setRegexError(false);

    setSearching(true);
    setResults([]);
    setProgress({ files: 0, matches: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        await searchInTree(rootHandle, q, {
          useRegex,
          caseSensitive,
          signal: controller.signal,
          onResult: (r) => {
            if (controller.signal.aborted) return;
            setResults(prev => [...prev, r]);
          },
          onProgress: (p) => {
            if (controller.signal.aborted) return;
            setProgress(p);
          },
        });
      } catch { /* aborted or error */ }
      finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, useRegex, caseSensitive, rootHandle]);

  const handleMatchHover = useCallback((result, match) => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      onHoverResult?.(result, match);
    }, 200);
  }, [onHoverResult]);

  const handleMatchLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    onLeaveResult?.();
  }, [onLeaveResult]);

  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);

  return (
    <div className="search-panel">
      {/* ── Search header ── */}
      <div className="search-header">
        <div className="search-input-wrap">
          <SearchIcon size={13} className="search-input-icon" />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="搜索内容…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {(query || useRegex || caseSensitive) && (
            <button
              className="search-clear-btn"
              onClick={() => { setQuery(''); setUseRegex(false); setCaseSensitive(false); }}
              title="清除"
            >✕</button>
          )}
        </div>
        <div className="search-toggles">
          <button
            className={`search-toggle ${useRegex ? 'active' : ''}`}
            onClick={() => setUseRegex(v => !v)}
            title="正则表达式"
          ><RegexIcon size={13} /></button>
          <button
            className={`search-toggle ${caseSensitive ? 'active' : ''}`}
            onClick={() => setCaseSensitive(v => !v)}
            title="区分大小写"
          ><CaseSensitiveIcon size={13} /></button>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="search-status">
        {regexError ? '⚠ 正则表达式无效'
         : searching ? `搜索中… ${progress.files} 文件 / ${progress.matches} 匹配`
         : query.trim() ? `${results.length} 文件 / ${totalMatches} 匹配`
         : '输入关键词搜索当前空间'}
      </div>

      {/* ── Results ── */}
      <div className="search-results">
        {results.map(result => (
          <div key={result.path} className="search-result-item">
            <div className="search-result-file">
              <FileTypeIcon name={result.name} size={13} />
              <span className="search-result-name">{result.name}</span>
              <span className="search-result-path" title={result.path}>
                {result.path.includes('/')
                  ? result.path.slice(0, result.path.lastIndexOf('/'))
                  : ''}
              </span>
            </div>
            {result.matches.map((match, i) => (
              <div
                key={i}
                className="search-result-match"
                onMouseEnter={() => handleMatchHover(result, match)}
                onMouseLeave={handleMatchLeave}
              >
                <span className="search-result-line-num">{match.lineNum}</span>
                <span className="search-result-line-text">
                  {match.text.slice(0, match.start)}
                  <mark>{match.text.slice(match.start, match.start + match.length)}</mark>
                  {match.text.slice(match.start + match.length)}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!searching && query.trim() && results.length === 0 && !regexError && (
          <div className="search-empty">未找到匹配结果</div>
        )}
      </div>
    </div>
  );
}

const SearchPanel = memo(SearchPanelInner);
export default SearchPanel;
