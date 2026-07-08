import { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  FolderIcon, FileTypeIcon, ChevronRight,
  MoreIcon, RenameIcon, NewFolderIcon, TrashIcon,
  OpenWorkspaceIcon,
} from './Icons';

/**
 * Recursive navigation menu — used by Sidebar.
 *
 * Hover rules:
 *  - Folder name → no action
 *  - Expand chevron → toggle expand/collapse (debounced 80ms)
 *  - File row → open file (debounced in App)
 *  - ⋯ button (appears on row hover) → hover to open action dropdown
 *
 * Action dropdown (⋯):
 *  - Folder: 新建文件 / 新建文件夹 / 重命名 / 删除
 *  - File:   重命名 / 删除
 *  - Click 删除 → dropdown transforms to inline confirmation popover
 *  - Click 重命名 → row name becomes inline editable input
 *  - Click 新建* → new input row appears at top of expanded children
 *  - No window.confirm — all confirmations are inline UI popovers.
 *
 * Children are rendered directly below the parent (indented).
 * Expansion persists — does NOT auto-collapse on mouse leave.
 *
 * Wrapped in React.memo: props are stable (items by ref, callbacks by
 * useCallback), so the tree only re-renders when data actually changes.
 */
function NavMenuInner({
  items, onFileHover, onFileLeave, currentFileId, variant = 'sidebar',
  onDeleteEntry, onCreateFile, onCreateFolder, onRenameEntry, onLoadChildren,
  onOpenAsWorkspace, revealPath,
}) {
  const [expandedItemId, setExpandedItemId] = useState(null);
  const expandedItem = (expandedItemId && items) ? items.find(i => i.id === expandedItemId) : null;
  const expandLoadingRef = useRef(new Set());
  const toggleTimerRef = useRef(null);

  // More-menu (⋯) state
  const [moreMenu, setMoreMenu] = useState(null);      // { item, pos }
  const [confirmDelete, setConfirmDelete] = useState(null); // { item }
  const moreOpenTimer = useRef(null);
  const moreCloseTimer = useRef(null);

  // Inline rename
  const [renaming, setRenaming] = useState(null);      // { id, value }
  const renameInputRef = useRef(null);

  // Inline create (new file/folder inside a directory)
  const [creating, setCreating] = useState(null);      // { dirId, type, value }
  const createInputRef = useRef(null);

  // ── Expand chevron hover (debounced toggle) ──────────────
  const handleExpandEnter = useCallback((item) => {
    clearTimeout(toggleTimerRef.current);
    toggleTimerRef.current = setTimeout(() => {
      setExpandedItemId(prev => prev === item.id ? null : item.id);
    }, 80);
  }, []);

  const handleExpandLeave = useCallback(() => {
    clearTimeout(toggleTimerRef.current);
  }, []);

  // ── ⋯ button hover → open action dropdown ────────────────
  const handleMoreEnter = useCallback((item, e) => {
    clearTimeout(moreCloseTimer.current);
    onFileLeave?.(); // cancel pending file-open
    const rect = e.currentTarget.getBoundingClientRect();
    moreOpenTimer.current = setTimeout(() => {
      const menuW = 168;
      const left = rect.right + 6 + menuW > window.innerWidth
        ? Math.max(4, rect.left - menuW - 6)
        : rect.right + 6;
      setMoreMenu({ item, pos: { top: rect.top, left } });
      setConfirmDelete(null);
    }, 80);
  }, [onFileLeave]);

  const handleMoreLeave = useCallback(() => {
    clearTimeout(moreOpenTimer.current);
    if (confirmDelete) return; // sticky in confirmation mode
    moreCloseTimer.current = setTimeout(() => {
      setMoreMenu(null);
      setConfirmDelete(null);
    }, 300);
  }, [confirmDelete]);

  const handleMenuEnter = useCallback(() => {
    clearTimeout(moreCloseTimer.current);
  }, []);

  const handleMenuLeave = useCallback(() => {
    if (confirmDelete) return; // sticky in confirmation mode
    moreCloseTimer.current = setTimeout(() => {
      setMoreMenu(null);
      setConfirmDelete(null);
    }, 300);
  }, [confirmDelete]);

  const closeMore = useCallback(() => {
    setMoreMenu(null);
    setConfirmDelete(null);
  }, []);

  // ── Open as workspace ────────────────────────────────────
  const handleOpenAsWorkspaceClick = useCallback(() => {
    if (!moreMenu?.item) return;
    const item = moreMenu.item;
    closeMore();
    onOpenAsWorkspace?.(item);
  }, [moreMenu, closeMore, onOpenAsWorkspace]);


  // ── Dropdown action handlers ─────────────────────────────
  const startRename = useCallback((item) => {
    setRenaming({ id: item.id, value: item.name });
    closeMore();
  }, [closeMore]);

  const startCreate = useCallback((item, type) => {
    setExpandedItemId(item.id); // auto-expand
    const defaultName = type === 'folder' ? '新建文件夹' : 'untitled.md';
    setCreating({ dirId: item.id, type, value: defaultName });
    closeMore();
  }, [closeMore]);

  const startConfirmDelete = useCallback(() => {
    setConfirmDelete({ item: moreMenu.item });
  }, [moreMenu]);

  const doDelete = useCallback(async () => {
    const item = confirmDelete?.item;
    if (!item) return;
    closeMore();
    if (expandedItemId === item.id) setExpandedItemId(null);
    try {
      await onDeleteEntry?.(item);
    } catch (err) {
      alert(`删除失败：\n${err.message}`);
    }
  }, [confirmDelete, closeMore, expandedItemId, onDeleteEntry]);

  // ── Rename commit / cancel ───────────────────────────────
  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const { id, value } = renaming;
    const item = items?.find(i => i.id === id);
    setRenaming(null);
    if (!item || !value.trim() || value.trim() === item.name) return;
    try {
      await onRenameEntry?.(item, value.trim());
    } catch (err) {
      alert(`重命名失败：\n${err.message}`);
    }
  }, [renaming, items, onRenameEntry]);

  const cancelRename = useCallback(() => setRenaming(null), []);

  // ── Create commit / cancel ───────────────────────────────
  const commitCreate = useCallback(async () => {
    if (!creating) return;
    const { dirId, type, value } = creating;
    const dir = items?.find(i => i.id === dirId);
    setCreating(null);
    if (!dir || !value.trim()) return;
    try {
      if (type === 'folder') await onCreateFolder?.(dir, value.trim());
      else await onCreateFile?.(dir, value.trim());
    } catch (err) {
      alert(`创建失败：\n${err.message}`);
    }
  }, [creating, items, onCreateFile, onCreateFolder]);

  const cancelCreate = useCallback(() => setCreating(null), []);

  // ── Auto-focus + select on inline inputs ─────────────────
  // Only re-run when the *target item* changes (renaming.id or
  // creating.dirId), NOT on every keystroke (renaming.value change
  // would re-trigger and steal focus mid-typing).
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      //.focus() is handled by the autoFocus prop on mount;
      // this effect only needs to set the initial selection range.
      const dot = renaming.value.lastIndexOf('.');
      renameInputRef.current.setSelectionRange(0, dot > 0 ? dot : renaming.value.length);
    }
  }, [renaming?.id]);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.select();
    }
  }, [creating?.dirId]);

  // Lazy-load children when a folder is expanded
  useEffect(() => {
    if (expandedItem && expandedItem.kind === 'directory' && expandedItem.children === null && !expandLoadingRef.current.has(expandedItem.id)) {
      expandLoadingRef.current.add(expandedItem.id);
      onLoadChildren?.(expandedItem);
    }
  }, [expandedItem, onLoadChildren]);

  // ── Reveal: auto-expand folders along revealPath ────────
  // When revealPath is set (e.g. from search), expand the directory
  // whose path is a prefix of revealPath.  Each recursive NavMenu
  // level does the same, so the full path unfolds top-down.
  useEffect(() => {
    if (!revealPath || !items) return;
    const target = items.find(item =>
      item.kind === 'directory' &&
      (revealPath === item.path || revealPath.startsWith(item.path + '/'))
    );
    if (target && expandedItemId !== target.id) {
      setExpandedItemId(target.id);
    }
  }, [revealPath, items]); // eslint-disable-line -- expandedItemId omitted intentionally

  // ── Empty state ──────────────────────────────────────────
  if (!items || items.length === 0) {
    if (variant === 'sidebar') {
      return <div className="sidebar-empty">悬停在顶部菜单上以浏览笔记</div>;
    }
    return null;
  }

  const isMoreOpen = (id) => moreMenu?.item.id === id;

  // ── Shared ⋯ button ──────────────────────────────────────
  const moreBtn = (item) => (
    <span className="nav-item-actions">
      <button
        className="nav-action-btn more"
        onMouseEnter={(e) => handleMoreEnter(item, e)}
        onMouseLeave={handleMoreLeave}
        title="更多操作"
      >
        <MoreIcon size={14} />
      </button>
    </span>
  );

  // ── Shared rename input (only constructed when renaming is active) ──
  // NOTE: must be guarded — `renaming` is null by default, and constructing
  // this JSX unconditionally would read `renaming.value` and crash the whole
  // tree (no error boundary) the first time NavMenu renders non-empty items
  // (i.e. when an L2 folder is hovered and populates the sidebar).
  const renameInput = renaming ? (
    <input
      ref={renameInputRef}
      autoFocus
      className="nav-rename-input"
      value={renaming.value}
      onChange={(e) => setRenaming(prev => prev ? { ...prev, value: e.target.value } : prev)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  ) : null;

  return (
    <div className={`nav-menu nav-menu-${variant}`}>
      {items.map(item => {
        const isRenaming = renaming?.id === item.id;
        const isCreatingHere = creating?.dirId === item.id;

        return (
          <div key={item.id} className="nav-item-wrapper">
            {item.kind === 'directory' ? (
              <>
                <div className={`nav-item-row folder-row ${isMoreOpen(item.id) ? 'more-open' : ''}`}>
                  {item.kind === 'directory'
                  ? (item.children !== null && item.children.length === 0
                    ? <span className="expand-icon-placeholder" />
                    : <span
                        className={`expand-icon ${expandedItemId === item.id ? 'expanded' : ''}`}
                        onMouseEnter={() => handleExpandEnter(item)}
                        onMouseLeave={handleExpandLeave}
                      >
                        <ChevronRight size={12} />
                      </span>)
                  : <span className="expand-icon-placeholder" />}
                  <span className="nav-item-icon"><FolderIcon size={15} /></span>
                  {isRenaming ? renameInput : <span className="nav-item-name">{item.name}</span>}
                  {!isRenaming && moreBtn(item)}
                </div>

                {/* Inline children — expanded below parent, indented */}
                {expandedItemId === item.id && (
                  <div className="nav-children">
                    {isCreatingHere && (
                      <div className="nav-item-row nav-create-row">
                        <span className="expand-icon-placeholder" />
                        <span className="nav-item-icon">
                          {creating.type === 'folder'
                            ? <FolderIcon size={15} />
                            : <FileTypeIcon name={creating.value} size={15} />}
                        </span>
                        <input
                          ref={createInputRef}
                          autoFocus
                          className="nav-rename-input"
                          value={creating.value}
                          onChange={(e) => setCreating(prev => prev ? { ...prev, value: e.target.value } : prev)}
                          onBlur={commitCreate}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
                            if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    {item.children === null ? (
                      <div className="nav-loading"><span className="nav-item-icon"><FolderIcon size={15} /></span>加载中…</div>
                    ) : item.children.length > 0 ? (
                      <NavMenu
                        items={item.children}
                        onFileHover={onFileHover}
                        onFileLeave={onFileLeave}
                        currentFileId={currentFileId}
                        variant={variant}
                        onDeleteEntry={onDeleteEntry}
                        onCreateFile={onCreateFile}
                        onCreateFolder={onCreateFolder}
                        onRenameEntry={onRenameEntry}
                        onLoadChildren={onLoadChildren}
                        onOpenAsWorkspace={onOpenAsWorkspace}
                        revealPath={revealPath}
                      />
                                        ) : null}
                  </div>
                )}
              </>
            ) : (
              <div
                className={`nav-item-row file-row ${currentFileId === item.id ? 'active' : ''} ${isMoreOpen(item.id) ? 'more-open' : ''}`}
                onMouseEnter={() => onFileHover(item)}
                onMouseLeave={onFileLeave}
              >
                <span className="expand-icon-placeholder" />
                <span className="nav-item-icon"><FileTypeIcon name={item.name} size={15} /></span>
                {isRenaming ? renameInput : <span className="nav-item-name">{item.name}</span>}
                {!isRenaming && moreBtn(item)}
              </div>
            )}
          </div>
        );
      })}

      {/* ⋯ Action dropdown — position:fixed, never clipped by sidebar overflow */}
      {moreMenu && (
        <>
          {confirmDelete && (
            <div className="more-overlay" onClick={closeMore} />
          )}
          <div
            className="more-menu"
            style={{
              position: 'fixed',
              top: `${moreMenu.pos.top}px`,
              left: `${moreMenu.pos.left}px`,
            }}
            onMouseEnter={handleMenuEnter}
            onMouseLeave={handleMenuLeave}
          >
            {confirmDelete ? (
              /* ── Inline confirmation popover ── */
              <div className="more-confirm">
                <div className="more-confirm-msg">
                  确认删除「{confirmDelete.item.name}」？
                  {confirmDelete.item.kind === 'directory' && (
                    <span className="more-confirm-sub">文件夹内所有内容将被删除</span>
                  )}
                </div>
                <div className="more-confirm-actions">
                  <button className="more-btn cancel" onClick={closeMore}>取消</button>
                  <button className="more-btn danger" onClick={doDelete}>删除</button>
                </div>
              </div>
            ) : (
              /* ── Action menu ── */
              <>
                {moreMenu.item.kind === 'directory' && (
                  <>
                    <div className="more-menu-item" onClick={handleOpenAsWorkspaceClick}>
                      <span className="more-menu-icon"><OpenWorkspaceIcon size={14} /></span>
                      <span>打开为空间</span>
                    </div>
                    <div className="more-menu-divider" />
                    <div className="more-menu-item" onClick={() => startCreate(moreMenu.item, 'file')}>
                      <span className="more-menu-icon"><FileTypeIcon name="new.md" size={14} /></span>
                      <span>新建文件</span>
                    </div>
                    <div className="more-menu-item" onClick={() => startCreate(moreMenu.item, 'folder')}>
                      <span className="more-menu-icon"><NewFolderIcon size={14} /></span>
                      <span>新建文件夹</span>
                    </div>
                    <div className="more-menu-divider" />
                  </>
                )}
                <div className="more-menu-item" onClick={() => startRename(moreMenu.item)}>
                  <span className="more-menu-icon"><RenameIcon size={14} /></span>
                  <span>重命名</span>
                </div>
                <div className="more-menu-item danger" onClick={startConfirmDelete}>
                  <span className="more-menu-icon"><TrashIcon size={14} /></span>
                  <span>删除</span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const NavMenu = memo(NavMenuInner);
export default NavMenu;
