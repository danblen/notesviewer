import { useState, useRef, useCallback, useEffect } from 'react';
import { FolderIcon, FileTypeIcon, ChevronRight } from './Icons';
import LayoutToggle from './LayoutToggle';
import SpaceSelector from './SpaceSelector';

const DROPDOWN_W = 220;

/**
 * TopBar — persistent header.
 *  Left:   SpaceSelector (space switcher).
 *  Center: Level-1 file/folder items with dropdown.
 */
export default function TopBar({
  rootName, loading, level1Items, currentFileId,
  recentSpaces, activeSpaceId,
  onSelectDirectory, onFileHover, onFileLeave, onLevel2Hover,
  onSwitchSpace, onDeleteSpace, onCloneGithub, onLoadChildren,
  layoutMode, onToggleLayout,
}) {
  const [hoveredL1Id, setHoveredL1Id] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeL2, setActiveL2] = useState(null);
  const closeTimer = useRef(null);
  const l1Loading = useRef(new Set());

  const hoveredL1 = hoveredL1Id ? level1Items.find(i => i.id === hoveredL1Id) : null;

  // ── L1 file/dir hover ──
  const handleL1Enter = useCallback((item, e) => {
    clearTimeout(closeTimer.current);
    if (item.kind === 'file') {
      onFileHover(item);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const left = rect.left + DROPDOWN_W > window.innerWidth
        ? Math.max(4, rect.right - DROPDOWN_W)
        : rect.left;
      setDropdownPos({ top: rect.bottom + 4, left });
      setHoveredL1Id(item.id);
    }
  }, [onFileHover]);

  const handleL1Leave = useCallback((item) => {
    if (item.kind === 'file') onFileLeave();
    closeTimer.current = setTimeout(() => setHoveredL1Id(null), 300);
  }, [onFileLeave]);

  const handleDropdownEnter = useCallback(() => clearTimeout(closeTimer.current), []);
  const handleDropdownLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setHoveredL1Id(null), 300);
  }, []);

  // ── Lazy-load L1 children ──
  useEffect(() => {
    if (hoveredL1?.kind === 'directory' && hoveredL1.children === null && !l1Loading.current.has(hoveredL1.id)) {
      l1Loading.current.add(hoveredL1.id);
      onLoadChildren?.(hoveredL1);
    }
  }, [hoveredL1, onLoadChildren]);

  // Reset loading set when tree changes
  const treeGen = useRef(level1Items);
  if (treeGen.current !== level1Items) {
    treeGen.current = level1Items;
    l1Loading.current = new Set();
  }

  // ── L2 hover ──
  const handleL2Enter = useCallback((item) => {
    if (item.kind === 'file') onFileHover(item);
    else { onLevel2Hover(item); setActiveL2(item); }
  }, [onFileHover, onLevel2Hover]);

  const handleL2Leave = useCallback((item) => {
    if (item.kind === 'file') onFileLeave();
  }, [onFileLeave]);

  // ── Render ──
  return (
    <header className="topbar">
      <LayoutToggle layoutMode={layoutMode} onToggleLayout={onToggleLayout} />
      <SpaceSelector
        rootName={rootName}
        loading={loading}
        recentSpaces={recentSpaces}
        activeSpaceId={activeSpaceId}
        onSelectDirectory={onSelectDirectory}
        onSwitchSpace={onSwitchSpace}
        onDeleteSpace={onDeleteSpace}
        onCloneGithub={onCloneGithub}
      />

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

      {hoveredL1?.kind === 'directory' && (
        <div
          className="l1-dropdown"
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
        >
          {hoveredL1.children === null ? (
            <div className="l1-dropdown-loading">加载中…</div>
          ) : hoveredL1.children.length > 0 ? (
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
                {l2.kind === 'directory' && <span className="l2-arrow"><ChevronRight size={10} /></span>}
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
