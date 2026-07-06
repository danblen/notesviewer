import { useState, useRef, useCallback } from 'react';
import { FolderIcon, FileTypeIcon, ChevronRight } from './Icons';

/**
 * Recursive navigation menu — used by Sidebar.
 *
 * Hover rules (per user spec):
 *  - Hover on a folder NAME → no action
 *  - Hover on the expand icon (left chevron) → toggle expand/collapse
 *  - Hover on a file → open it (debounced in App)
 *
 * Children are rendered directly below the parent item (indented).
 * Expansion persists — does NOT auto-collapse on mouse leave.
 * The currently-open file row is highlighted via `currentFileId`.
 */
export default function NavMenu({ items, onFileHover, onFileLeave, currentFileId, variant = 'sidebar' }) {
  const [expandedItem, setExpandedItem] = useState(null);
  const toggleTimerRef = useRef(null);

  // ── Expand icon hover (toggle, no auto-collapse) ─────────
  const handleExpandEnter = useCallback((item) => {
    clearTimeout(toggleTimerRef.current);
    toggleTimerRef.current = setTimeout(() => {
      setExpandedItem(prev => prev?.id === item.id ? null : item);
    }, 80);
  }, []);

  const handleExpandLeave = useCallback(() => {
    clearTimeout(toggleTimerRef.current);
  }, []);

  // ── Empty states ─────────────────────────────────────────
  if (!items || items.length === 0) {
    if (variant === 'sidebar') {
      return <div className="sidebar-empty">悬停在顶部菜单上以浏览笔记</div>;
    }
    return null;
  }

  return (
    <div className={`nav-menu nav-menu-${variant}`}>
      {items.map(item => (
        <div key={item.id} className="nav-item-wrapper">
          {item.kind === 'directory' ? (
            <>
              <div className="nav-item-row folder-row">
                {item.children && item.children.length > 0 ? (
                  <span
                    className={`expand-icon ${expandedItem?.id === item.id ? 'expanded' : ''}`}
                    onMouseEnter={() => handleExpandEnter(item)}
                    onMouseLeave={handleExpandLeave}
                  >
                    <ChevronRight size={12} />
                  </span>
                ) : (
                  <span className="expand-icon-placeholder" />
                )}
                <span className="nav-item-icon"><FolderIcon size={15} /></span>
                <span className="nav-item-name">{item.name}</span>
              </div>

              {/* Inline expansion — children rendered directly below, indented */}
              {expandedItem?.id === item.id && item.children && item.children.length > 0 && (
                <div className="nav-children">
                  <NavMenu
                    items={item.children}
                    onFileHover={onFileHover}
                    onFileLeave={onFileLeave}
                    currentFileId={currentFileId}
                    variant={variant}
                  />
                </div>
              )}
            </>
          ) : (
            <div
              className={`nav-item-row file-row ${currentFileId === item.id ? 'active' : ''}`}
              onMouseEnter={() => onFileHover(item)}
              onMouseLeave={onFileLeave}
            >
              <span className="expand-icon-placeholder" />
              <span className="nav-item-icon"><FileTypeIcon name={item.name} size={15} /></span>
              <span className="nav-item-name">{item.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
