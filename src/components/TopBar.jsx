import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { FolderIcon, FolderOpenIcon, FileTypeIcon, ChevronRight, SpacesIcon, PlusIcon, MoreIcon, TrashIcon, DownloadIcon } from './Icons';

/**
 * TopBar — persistent header.
 *
 * Left/Center: Level-1 items (horizontal, left-aligned).
 * Right:       notes-spaces switcher (hover to open dropdown).
 *
 * Spaces dropdown:
 *  - First item "打开目录…" → CLICK to open the OS directory picker.
 *  - Other items (existing spaces) → hover 300ms to switch note root.
 *  - Each space has a ⋯ button → hover to open action sub-menu →
 *    click 删除 → inline confirmation popover (no window.confirm).
 *
 * Hover behaviour (L1/L2):
 *  - L1 folder → dropdown with L2 children (position:fixed, never clipped)
 *  - L1 file   → open file (debounced)
 *  - L2 folder → updates Sidebar with L3 children
 *  - L2 file   → open file (debounced)
 */
function TopBarInner({
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
  onDeleteSpace,
  onCloneGithub,
  onLoadChildren,
}) {
  const [hoveredL1Id, setHoveredL1Id] = useState(null);
  const hoveredL1 = hoveredL1Id ? level1Items.find(i => i.id === hoveredL1Id) : null;
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeL2, setActiveL2] = useState(null);
  const closeTimerRef = useRef(null);
  const l1LoadingRef = useRef(new Set());

  // Spaces dropdown state
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [spacesPos, setSpacesPos] = useState({ top: 0, right: 0 });
  const spacesCloseTimer = useRef(null);
  const switchTimer = useRef(null);

  // Space ⋯ sub-menu state
  const [spaceMore, setSpaceMore] = useState(null);     // { spaceId, pos }
  const [spaceConfirm, setSpaceConfirm] = useState(null); // { space }
  const spaceMoreOpenTimer = useRef(null);
  const spaceMoreCloseTimer = useRef(null);

  const activeSpace = recentSpaces.find(s => s.id === activeSpaceId);

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
      setHoveredL1Id(item.id);
    }
  }, [onFileHover]);

  const handleL1Leave = useCallback((item) => {
    if (item.kind === 'file') onFileLeave();
    closeTimerRef.current = setTimeout(() => setHoveredL1Id(null), 300);
  }, [onFileLeave]);

  const handleDropdownEnter = useCallback(() => {
    clearTimeout(closeTimerRef.current);
  }, []);

  const handleDropdownLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setHoveredL1Id(null), 300);
  }, []);

  // Lazy-load L1 folder children on hover
  useEffect(() => {
    if (hoveredL1 && hoveredL1.kind === 'directory' && hoveredL1.children === null && !l1LoadingRef.current.has(hoveredL1.id)) {
      l1LoadingRef.current.add(hoveredL1.id);
      onLoadChildren?.(hoveredL1);
    }
  }, [hoveredL1, onLoadChildren]);

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
    const rect = e.currentTarget.getBoundingClientRect();
    setSpacesPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setSpacesOpen(true);
  }, []);

  const handleSpacesLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    spacesCloseTimer.current = setTimeout(() => setSpacesOpen(false), 300);
  }, []);

  const handleSpacesDropdownEnter = useCallback(() => {
    clearTimeout(spacesCloseTimer.current);
  }, []);

  const handleSpacesDropdownLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    // Don't close the spaces dropdown while a sub-menu confirmation is active
    if (spaceConfirm) return;
    spacesCloseTimer.current = setTimeout(() => setSpacesOpen(false), 300);
  }, [spaceConfirm]);

  // Hover a space → switch after 300ms
  const handleSpaceHover = useCallback((spaceId) => {
    if (spaceMore || spaceConfirm) return; // don't switch while interacting with ⋯
    clearTimeout(switchTimer.current);
    if (spaceId === activeSpaceId) return;
    switchTimer.current = setTimeout(() => {
      onSwitchSpace(spaceId);
      setSpacesOpen(false);
    }, 300);
  }, [onSwitchSpace, activeSpaceId, spaceMore, spaceConfirm]);

  const handleSpaceLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
  }, []);

  // ── Space ⋯ sub-menu handlers ────────────────────────────
  const handleSpaceMoreEnter = useCallback((e, space) => {
    e.stopPropagation();
    clearTimeout(switchTimer.current);
    clearTimeout(spaceMoreCloseTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    spaceMoreOpenTimer.current = setTimeout(() => {
      const menuW = 120;
      // Position to the LEFT of the ⋯ (dropdown is right-aligned)
      const left = Math.max(4, rect.left - menuW - 6);
      setSpaceMore({ spaceId: space.id, pos: { top: rect.top, left } });
      setSpaceConfirm(null);
    }, 80);
  }, []);

  const handleSpaceMoreLeave = useCallback(() => {
    clearTimeout(spaceMoreOpenTimer.current);
    if (spaceConfirm) return; // sticky in confirmation mode
    spaceMoreCloseTimer.current = setTimeout(() => {
      setSpaceMore(null);
      setSpaceConfirm(null);
    }, 300);
  }, [spaceConfirm]);

  const handleSpaceMenuEnter = useCallback(() => {
    clearTimeout(spaceMoreCloseTimer.current);
  }, []);

  const handleSpaceMenuLeave = useCallback(() => {
    if (spaceConfirm) return;
    spaceMoreCloseTimer.current = setTimeout(() => {
      setSpaceMore(null);
      setSpaceConfirm(null);
    }, 300);
  }, [spaceConfirm]);

  const closeSpaceMore = useCallback(() => {
    setSpaceMore(null);
    setSpaceConfirm(null);
  }, []);

  const handleSpaceDeleteAction = useCallback(() => {
    const space = recentSpaces.find(s => s.id === spaceMore?.spaceId);
    if (space) setSpaceConfirm({ space });
  }, [recentSpaces, spaceMore]);

  const confirmSpaceDelete = useCallback(() => {
    const space = spaceConfirm?.space;
    if (!space) return;
    closeSpaceMore();
    onDeleteSpace(space.id);
  }, [spaceConfirm, closeSpaceMore, onDeleteSpace]);

  // "打开目录…" — click only
  const handleOpenDirClick = useCallback(() => {
    if (loading) return;
    clearTimeout(switchTimer.current);
    setSpacesOpen(false);
    onSelectDirectory();
  }, [loading, onSelectDirectory]);

  // "克隆 GitHub 项目" — click only
  const handleCloneClick = useCallback(() => {
    clearTimeout(switchTimer.current);
    setSpacesOpen(false);
    onCloneGithub();
  }, [onCloneGithub]);

  // ── Render ───────────────────────────────────────────────
  return (
    <header className="topbar">
      {/* Level-1 items (left-aligned) */}
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

      {/* Right: notes-spaces switcher (hover to open) */}
      <div
        className={`spaces-switcher ${spacesOpen ? 'open' : ''} ${activeSpaceId ? '' : 'no-active'}`}
        onMouseEnter={handleSpacesEnter}
        onMouseLeave={handleSpacesLeave}
        title="切换笔记空间 / 打开目录"
      >
        <SpacesIcon size={15} />
        <span className="spaces-label">{activeSpace?.name || rootName || '笔记空间'}</span>
        <ChevronRight size={10} className="spaces-chevron" />
      </div>

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
                {l2.kind === 'directory' && (
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
      {spacesOpen && (
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
          <div
            className={`space-action ${loading ? 'disabled' : ''}`}
            onClick={handleOpenDirClick}
            onMouseEnter={() => clearTimeout(switchTimer.current)}
            title="选择一个新的笔记根目录"
          >
            <span className="space-action-icon"><PlusIcon size={14} /></span>
            <span className="space-action-name">打开目录…</span>
          </div>
          <div
            className="space-action"
            onClick={handleCloneClick}
            onMouseEnter={() => clearTimeout(switchTimer.current)}
            title="从 GitHub 克隆项目到本地"
          >
            <span className="space-action-icon"><DownloadIcon size={14} /></span>
            <span className="space-action-name">克隆 GitHub 项目…</span>
          </div>
          {recentSpaces.length > 0 && <div className="space-divider" />}
          {recentSpaces.map(space => (
            <div
              key={space.id}
              className={`space-item ${activeSpaceId === space.id ? 'active' : ''} ${spaceMore?.spaceId === space.id ? 'more-open' : ''}`}
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
              {onDeleteSpace && (
                <button
                  className="space-more-btn"
                  onMouseEnter={(e) => handleSpaceMoreEnter(e, space)}
                  onMouseLeave={handleSpaceMoreLeave}
                  title="更多操作"
                >
                  <MoreIcon size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Space ⋯ sub-menu — position:fixed, left of the ⋯ button */}
      {spaceMore && (
        <>
          {spaceConfirm && (
            <div className="more-overlay" onClick={closeSpaceMore} />
          )}
          <div
            className="more-menu space-more-menu"
            style={{
              position: 'fixed',
              top: `${spaceMore.pos.top}px`,
              left: `${spaceMore.pos.left}px`,
            }}
            onMouseEnter={handleSpaceMenuEnter}
            onMouseLeave={handleSpaceMenuLeave}
          >
            {spaceConfirm ? (
              <div className="more-confirm">
                <div className="more-confirm-msg">
                  确认删除笔记空间「{spaceConfirm.space.name}」？
                  <span className="more-confirm-sub">仅从应用中移除，不会删除磁盘文件</span>
                </div>
                <div className="more-confirm-actions">
                  <button className="more-btn cancel" onClick={closeSpaceMore}>取消</button>
                  <button className="more-btn danger" onClick={confirmSpaceDelete}>删除</button>
                </div>
              </div>
            ) : (
              <div className="more-menu-item danger" onClick={handleSpaceDeleteAction}>
                <span className="more-menu-icon"><TrashIcon size={14} /></span>
                <span>删除</span>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  );
}

const TopBar = memo(TopBarInner);
export default TopBar;
