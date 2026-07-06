import { useState, useRef, useCallback } from 'react';
import { FolderIcon, FolderOpenIcon, FileTypeIcon, ChevronRight, SpacesIcon } from './Icons';

/**
 * TopBar — persistent header.
 *
 * Left:   directory selector button (the ONLY clickable element).
 * Center: Level-1 items (horizontal, left-aligned).
 * Right:  recent-spaces switcher (hover to open dropdown, hover item to switch).
 *
 * Hover behaviour:
 *  - L1 folder → dropdown with L2 children (position:fixed, never clipped)
 *  - L1 file   → open file (debounced)
 *  - L2 folder → updates Sidebar with L3 children
 *  - L2 file   → open file (debounced)
 *  - Space item → switch to that note root (300ms hover delay)
 *
 * The currently-open file is highlighted in both L1 and L2 via `currentFileId`.
 */
export default function TopBar({
  rootName,
  level1Items,
  loading,
  currentFileId,
  recentSpaces,
  activeSpaceId,
  onSelectDirectory,
  onFileHover,
  onFileLeave,
  onLevel2Hover,
  onSwitchSpace,
}) {
  const [hoveredL1, setHoveredL1] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeL2, setActiveL2] = useState(null);
  const closeTimerRef = useRef(null);

  // Spaces dropdown state
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [spacesPos, setSpacesPos] = useState({ top: 0, right: 0 });
  const spacesCloseTimer = useRef(null);
  const switchTimer = useRef(null);

  const activeSpace = recentSpaces.find(s => s.id === activeSpaceId);
  const showSwitcher = recentSpaces.length > 0;

  // ── L1 handlers ──────────────────────────────────────────
  const handleL1Enter = useCallback((item, e) => {
    clearTimeout(closeTimerRef.current);
    if (item.kind === 'file') {
      onFileHover(item);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const dropdownWidth = 220;
      const left = rect.left + dropdownWidth > window.innerWidth
        ? Math.max(4, rect.right - dropdownWidth)
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

  // ── Spaces switcher handlers ─────────────────────────────
  const handleSpacesEnter = useCallback((e) => {
    clearTimeout(spacesCloseTimer.current);
    if (!showSwitcher) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSpacesPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setSpacesOpen(true);
  }, [showSwitcher]);

  const handleSpacesLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    spacesCloseTimer.current = setTimeout(() => setSpacesOpen(false), 300);
  }, []);

  const handleSpacesDropdownEnter = useCallback(() => {
    clearTimeout(spacesCloseTimer.current);
  }, []);

  const handleSpacesDropdownLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    spacesCloseTimer.current = setTimeout(() => setSpacesOpen(false), 300);
  }, []);

  // Hover a space → switch after 300ms (prevents accidental triggers)
  const handleSpaceHover = useCallback((spaceId) => {
    clearTimeout(switchTimer.current);
    if (spaceId === activeSpaceId) return;
    switchTimer.current = setTimeout(() => {
      onSwitchSpace(spaceId);
      setSpacesOpen(false);
    }, 300);
  }, [onSwitchSpace, activeSpaceId]);

  const handleSpaceLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
  }, []);

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

      {/* Center: Level-1 items (left-aligned within this section) */}
      <nav className="topbar-right">
        {level1Items.map(item => (
          <div
            key={item.id}
            className={`l1-item ${hoveredL1?.id === item.id ? 'hovered' : ''} ${currentFileId === item.id ? 'active' : ''}`}
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

      {/* Right: recent-spaces switcher (hover to open) */}
      {showSwitcher && (
        <div
          className={`spaces-switcher ${spacesOpen ? 'open' : ''} ${activeSpaceId ? '' : 'no-active'}`}
          onMouseEnter={handleSpacesEnter}
          onMouseLeave={handleSpacesLeave}
          title="切换笔记空间"
        >
          <SpacesIcon size={15} />
          <span className="spaces-label">{activeSpace?.name || '笔记空间'}</span>
          <ChevronRight size={10} className="spaces-chevron" />
        </div>
      )}

      {/* Level-2 dropdown — rendered OUTSIDE .topbar-right to avoid overflow clipping. */}
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
                className={`l2-item ${(activeL2?.id === l2.id || currentFileId === l2.id) ? 'active' : ''}`}
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

      {/* Spaces dropdown — position:fixed, right-aligned */}
      {spacesOpen && showSwitcher && (
        <div
          className="spaces-dropdown"
          style={{
            position: 'fixed',
            top: `${spacesPos.top}px`,
            right: `${spacesPos.right}px`,
          }}
          onMouseEnter={handleSpacesDropdownEnter}
          onMouseLeave={handleSpacesDropdownLeave}
        >
          {recentSpaces.map(space => (
            <div
              key={space.id}
              className={`space-item ${activeSpaceId === space.id ? 'active' : ''}`}
              onMouseEnter={() => handleSpaceHover(space.id)}
              onMouseLeave={handleSpaceLeave}
            >
              <span className="space-item-icon">
                {activeSpaceId === space.id
                  ? <FolderOpenIcon size={14} />
                  : <FolderIcon size={14} />}
              </span>
              <span className="space-item-name">{space.name}</span>
              {activeSpaceId === space.id && (
                <span className="space-item-badge">当前</span>
              )}
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
