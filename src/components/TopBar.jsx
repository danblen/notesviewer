import { useState, useRef, useCallback } from 'react';
import { FolderIcon, FolderOpenIcon, FileTypeIcon, ChevronRight } from './Icons';

/**
 * TopBar — persistent header.
 *
 * Left:  directory selector button (the ONLY clickable element).
 * Right: Level-1 items (horizontal, left-aligned within the right section).
 *
 * Hover behaviour:
 *  - L1 folder → dropdown with L2 children (position:fixed, never clipped)
 *  - L1 file   → open file (debounced)
 *  - L2 folder → updates Sidebar with L3 children
 *  - L2 file   → open file (debounced)
 */
export default function TopBar({
  rootName,
  level1Items,
  loading,
  onSelectDirectory,
  onFileHover,
  onFileLeave,
  onLevel2Hover,
}) {
  const [hoveredL1, setHoveredL1] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeL2, setActiveL2] = useState(null);
  const closeTimerRef = useRef(null);

  // ── L1 handlers ──────────────────────────────────────────
  const handleL1Enter = useCallback((item, e) => {
    clearTimeout(closeTimerRef.current);
    if (item.kind === 'file') {
      onFileHover(item);
    } else {
      // Calculate dropdown position using the L1 item's bounding rect
      const rect = e.currentTarget.getBoundingClientRect();
      const dropdownWidth = 220;
      const left = rect.left + dropdownWidth > window.innerWidth
        ? Math.max(4, rect.right - dropdownWidth)  // flip left if overflow
        : rect.left;
      setDropdownPos({ top: rect.bottom + 4, left });
      setHoveredL1(item);
    }
  }, [onFileHover]);

  const handleL1Leave = useCallback((item) => {
    if (item.kind === 'file') onFileLeave();
    closeTimerRef.current = setTimeout(() => setHoveredL1(null), 300);
  }, [onFileLeave]);

  // ── Dropdown hover (keeps dropdown alive when mouse moves into it) ──
  const handleDropdownEnter = useCallback(() => {
    clearTimeout(closeTimerRef.current);
  }, []);

  const handleDropdownLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setHoveredL1(null), 300);
  }, []);

  // ── L2 handlers ──────────────────────────────────────────
  const handleL2Enter = useCallback((item) => {
    if (item.kind === 'file') {
      onFileHover(item);
    } else {
      onLevel2Hover(item);
      setActiveL2(item);
    }
  }, [onFileHover, onLevel2Hover]);

  const handleL2Leave = useCallback((item) => {
    if (item.kind === 'file') onFileLeave();
  }, [onFileLeave]);

  // ── Render ───────────────────────────────────────────────
  return (
    <header className="topbar">
      {/* Left: directory button */}
      <div className="topbar-left">
        <button
          className="dir-button"
          onClick={onSelectDirectory}
          disabled={loading}
          title="选择笔记根目录"
        >
          <FolderOpenIcon size={16} />
          <span>{loading ? '加载中…' : (rootName || '选择目录')}</span>
        </button>
      </div>

      {/* Right: Level-1 items (left-aligned within this section) */}
      <nav className="topbar-right">
        {level1Items.map(item => (
          <div
            key={item.id}
            className={`l1-item ${hoveredL1?.id === item.id ? 'hovered' : ''}`}
            onMouseEnter={(e) => handleL1Enter(item, e)}
            onMouseLeave={() => handleL1Leave(item)}
          >
            <span className="l1-icon">
              {item.kind === 'directory'
                ? <FolderIcon size={14} />
                : <FileTypeIcon name={item.name} size={14} />}
            </span>
            <span className="l1-name">{item.name}</span>
          </div>
        ))}
      </nav>

      {/* Level-2 dropdown — rendered OUTSIDE .topbar-right to avoid overflow clipping.
          Uses position:fixed so it's never clipped by any scroll container. */}
      {hoveredL1 && hoveredL1.kind === 'directory' && (
        <div
          className="l1-dropdown"
          style={{
            position: 'fixed',
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
          }}
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
        >
          {hoveredL1.children && hoveredL1.children.length > 0 ? (
            hoveredL1.children.map(l2 => (
              <div
                key={l2.id}
                className={`l2-item ${activeL2?.id === l2.id ? 'active' : ''}`}
                onMouseEnter={() => handleL2Enter(l2)}
                onMouseLeave={() => handleL2Leave(l2)}
              >
                <span className="l2-icon">
                  {l2.kind === 'directory'
                    ? <FolderIcon size={14} />
                    : <FileTypeIcon name={l2.name} size={14} />}
                </span>
                <span className="l2-name">{l2.name}</span>
                {l2.kind === 'directory' && l2.children && l2.children.length > 0 && (
                  <span className="l2-arrow"><ChevronRight size={10} /></span>
                )}
              </div>
            ))
          ) : (
            <div className="l1-dropdown-empty">空文件夹</div>
          )}
        </div>
      )}
    </header>
  );
}
