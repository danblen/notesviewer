import { useState, useRef, useCallback, useEffect } from 'react';
import { FolderIcon, FolderOpenIcon, ChevronRight, SpacesIcon, PlusIcon, MoreIcon, TrashIcon, DownloadIcon } from './Icons';

export default function SpaceSelector({
  rootName, loading, recentSpaces, activeSpaceId,
  onSelectDirectory, onSwitchSpace, onDeleteSpace, onCloneGithub,
  dropdownGroup, dropdownId = 'spaces',
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const closeTimer = useRef(null);
  const switchTimer = useRef(null);

  const [spaceMore, setSpaceMore] = useState(null);
  const [spaceConfirm, setSpaceConfirm] = useState(null);
  const moreOpenTimer = useRef(null);
  const moreCloseTimer = useRef(null);

  const activeSpace = recentSpaces.find(s => s.id === activeSpaceId);

  // Mutual exclusion: close when another dropdown in the group opens
  useEffect(() => {
    if (!dropdownGroup) return;
    return dropdownGroup.subscribe((activeId) => {
      if (activeId && activeId !== dropdownId) {
        clearTimeout(closeTimer.current);
        setOpen(false);
      }
    });
  }, [dropdownGroup, dropdownId]);

  // ── Switcher hover ──
  const handleEnter = useCallback((e) => {
    clearTimeout(closeTimer.current);
    if (dropdownGroup) dropdownGroup.acquire(dropdownId);
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }, [dropdownGroup, dropdownId]);

  const handleLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      if (dropdownGroup) dropdownGroup.release(dropdownId);
    }, 300);
  }, [dropdownGroup, dropdownId]);

  const handleDropdownEnter = useCallback(() => clearTimeout(closeTimer.current), []);
  const handleDropdownLeave = useCallback(() => {
    clearTimeout(switchTimer.current);
    if (spaceConfirm) return;
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      if (dropdownGroup) dropdownGroup.release(dropdownId);
    }, 300);
  }, [spaceConfirm, dropdownGroup, dropdownId]);

  // ── Space hover → switch ──
  const handleSpaceHover = useCallback((spaceId) => {
    if (spaceMore || spaceConfirm) return;
    clearTimeout(switchTimer.current);
    if (spaceId === activeSpaceId) return;
    switchTimer.current = setTimeout(() => {
      onSwitchSpace(spaceId);
      setOpen(false);
      if (dropdownGroup) dropdownGroup.release(dropdownId);
    }, 400);
  }, [onSwitchSpace, activeSpaceId, spaceMore, spaceConfirm, dropdownGroup, dropdownId]);

  const handleSpaceLeave = useCallback(() => clearTimeout(switchTimer.current), []);

  // ── ⋯ sub-menu ──
  const handleMoreEnter = useCallback((e, space) => {
    e.stopPropagation();
    clearTimeout(switchTimer.current);
    clearTimeout(moreCloseTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    moreOpenTimer.current = setTimeout(() => {
      const menuW = 120;
      const left = Math.max(4, rect.left - menuW - 6);
      setSpaceMore({ spaceId: space.id, pos: { top: rect.top, left } });
      setSpaceConfirm(null);
    }, 80);
  }, []);

  const handleMoreLeave = useCallback(() => {
    clearTimeout(moreOpenTimer.current);
    if (spaceConfirm) return;
    moreCloseTimer.current = setTimeout(() => { setSpaceMore(null); setSpaceConfirm(null); }, 300);
  }, [spaceConfirm]);

  const handleMenuEnter = useCallback(() => clearTimeout(moreCloseTimer.current), []);
  const handleMenuLeave = useCallback(() => {
    if (spaceConfirm) return;
    moreCloseTimer.current = setTimeout(() => { setSpaceMore(null); setSpaceConfirm(null); }, 300);
  }, [spaceConfirm]);

  const closeMore = useCallback(() => { setSpaceMore(null); setSpaceConfirm(null); }, []);

  const handleDeleteAction = useCallback(() => {
    const space = recentSpaces.find(s => s.id === spaceMore?.spaceId);
    if (!space) return;
    closeMore();
    onDeleteSpace(space.id);
  }, [recentSpaces, spaceMore, closeMore, onDeleteSpace]);

  const confirmDelete = useCallback(() => {
    const space = spaceConfirm?.space;
    if (!space) return;
    closeMore();
    onDeleteSpace(space.id);
  }, [spaceConfirm, closeMore, onDeleteSpace]);

  // ── Action clicks ──
  const handleOpenDir = useCallback(() => {
    if (loading) return;
    clearTimeout(switchTimer.current);
    setOpen(false);
    if (dropdownGroup) dropdownGroup.release(dropdownId);
    onSelectDirectory();
  }, [loading, onSelectDirectory, dropdownGroup, dropdownId]);

  const handleClone = useCallback(() => {
    clearTimeout(switchTimer.current);
    setOpen(false);
    if (dropdownGroup) dropdownGroup.release(dropdownId);
    onCloneGithub();
  }, [onCloneGithub, dropdownGroup, dropdownId]);

  return (
    <>
      <div
        className={`spaces-switcher ${open ? 'open' : ''} ${activeSpaceId ? '' : 'no-active'}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        title="切换笔记空间 / 打开目录"
      >
        <SpacesIcon size={15} />
        <span className="spaces-label">{activeSpace?.name || rootName || '笔记空间'}</span>
        <ChevronRight size={10} className="spaces-chevron" />
      </div>

      {open && (
        <div
          className="spaces-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onMouseEnter={handleDropdownEnter}
          onMouseLeave={handleDropdownLeave}
        >
          <div
            className={`space-action ${loading ? 'disabled' : ''}`}
            onClick={handleOpenDir}
            onMouseEnter={() => clearTimeout(switchTimer.current)}
          >
            <span className="space-action-icon"><PlusIcon size={14} /></span>
            <span className="space-action-name">打开目录…</span>
          </div>
          <div className="space-action" onClick={handleClone} onMouseEnter={() => clearTimeout(switchTimer.current)}>
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
                {activeSpaceId === space.id ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />}
              </span>
              <span className="space-item-name">{space.name}</span>
              {activeSpaceId === space.id && <span className="space-item-badge">当前</span>}
              <button className="space-more-btn" onMouseEnter={(e) => handleMoreEnter(e, space)} onMouseLeave={handleMoreLeave}>
                <MoreIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {spaceMore && (
        <>
          <div
            className="more-menu space-more-menu"
            style={{ position: 'fixed', top: spaceMore.pos.top, left: spaceMore.pos.left }}
            onMouseEnter={handleMenuEnter}
            onMouseLeave={handleMenuLeave}
          >
            <div className="more-menu-item danger" onClick={handleDeleteAction}>
                <span className="more-menu-icon"><TrashIcon size={14} /></span>
                <span>删除</span>
              </div>
          </div>
        </>
      )}
    </>
  );
}
