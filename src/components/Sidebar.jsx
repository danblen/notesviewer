import { useState, useRef, useCallback, useEffect, memo } from 'react';
import NavMenu from './NavMenu';
import SpaceSelector from './SpaceSelector';
import LayoutToggle from './LayoutToggle';
import {
  MoreIcon, RenameIcon, NewFolderIcon, TrashIcon,
  FolderIcon, FileTypeIcon, OpenWorkspaceIcon,
} from './Icons';

/**
 * Sidebar — persistent left panel showing Level-3+ items.
 *
 * Content updates when the user hovers on a Level-2 folder in the
 * TopBar dropdown.  Width is adjustable via the resizer handle in App.
 * The currently-open file is highlighted.
 *
 * Header: shows the current folder name with a ⋯ (more) button that opens
 * the same action dropdown as folder rows in NavMenu:
 *   新建文件 / 新建文件夹 / 重命名 / 删除
 * with inline confirmation + inline inputs (no window.confirm/prompt).
 */
function SidebarInner({
  items, onFileHover, onFileLeave, currentFileId, width, folder,
  onDeleteEntry, onCreateFile, onCreateFolder, onRenameEntry, onLoadChildren,
  onOpenAsWorkspace,
  layoutMode, onToggleLayout,
  rootName, loading, recentSpaces, activeSpaceId,
  onSelectDirectory, onSwitchSpace, onDeleteSpace, onCloneGithub,
}) {
  // More-menu (⋯) state
  const [moreMenu, setMoreMenu] = useState(null);      // { pos }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const moreOpenTimer = useRef(null);
  const moreCloseTimer = useRef(null);

  // Inline rename (of the folder itself)
  const [renaming, setRenaming] = useState(null);      // { value }
  const renameInputRef = useRef(null);

  // Inline create (new file/folder inside this folder)
  const [creating, setCreating] = useState(null);      // { type, value }
  const createInputRef = useRef(null);

  // ── ⋯ button hover → open action dropdown ────────────────
  const handleMoreEnter = useCallback((e) => {
    clearTimeout(moreCloseTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    moreOpenTimer.current = setTimeout(() => {
      const menuW = 168;
      const left = rect.right + 6 + menuW > window.innerWidth
        ? Math.max(4, rect.left - menuW - 6)
        : rect.right + 6;
      setMoreMenu({ pos: { top: rect.bottom + 2, left } });
      setConfirmDelete(false);
    }, 80);
  }, []);

  const handleMoreLeave = useCallback(() => {
    clearTimeout(moreOpenTimer.current);
    if (confirmDelete) return; // sticky in confirmation mode
    moreCloseTimer.current = setTimeout(() => {
      setMoreMenu(null);
      setConfirmDelete(false);
    }, 300);
  }, [confirmDelete]);

  const handleMenuEnter = useCallback(() => {
    clearTimeout(moreCloseTimer.current);
  }, []);

  const handleMenuLeave = useCallback(() => {
    if (confirmDelete) return; // sticky in confirmation mode
    moreCloseTimer.current = setTimeout(() => {
      setMoreMenu(null);
      setConfirmDelete(false);
    }, 300);
  }, [confirmDelete]);

  const closeMore = useCallback(() => {
    setMoreMenu(null);
    setConfirmDelete(false);
  }, []);

  // ── Open as workspace ────────────────────────────────────
  const handleOpenAsWorkspaceClick = useCallback(() => {
    if (!folder) return;
    closeMore();
    onOpenAsWorkspace?.(folder);
  }, [folder, closeMore, onOpenAsWorkspace]);

  // ── Dropdown action handlers ─────────────────────────────
  const startRename = useCallback(() => {
    if (!folder) return;
    setRenaming({ value: folder.name });
    closeMore();
  }, [folder, closeMore]);

  const startCreate = useCallback((type) => {
    const defaultName = type === 'folder' ? '新建文件夹' : 'untitled.md';
    setCreating({ type, value: defaultName });
    closeMore();
  }, [closeMore]);

  const startConfirmDelete = useCallback(() => {
    setConfirmDelete(true);
  }, []);

  const doDelete = useCallback(async () => {
    if (!folder) return;
    closeMore();
    try {
      await onDeleteEntry?.(folder);
    } catch (err) {
      alert(`删除失败：\n${err.message}`);
    }
  }, [folder, closeMore, onDeleteEntry]);

  // ── Rename commit / cancel ───────────────────────────────
  const commitRename = useCallback(async () => {
    if (!renaming || !folder) { setRenaming(null); return; }
    const value = renaming.value;
    setRenaming(null);
    if (!value.trim() || value.trim() === folder.name) return;
    try {
      await onRenameEntry?.(folder, value.trim());
    } catch (err) {
      alert(`重命名失败：\n${err.message}`);
    }
  }, [renaming, folder, onRenameEntry]);

  const cancelRename = useCallback(() => setRenaming(null), []);

  // ── Create commit / cancel ───────────────────────────────
  const commitCreate = useCallback(async () => {
    if (!creating || !folder) { setCreating(null); return; }
    const { type, value } = creating;
    setCreating(null);
    if (!value.trim()) return;
    try {
      if (type === 'folder') await onCreateFolder?.(folder, value.trim());
      else await onCreateFile?.(folder, value.trim());
    } catch (err) {
      alert(`创建失败：\n${err.message}`);
    }
  }, [creating, folder, onCreateFile, onCreateFolder]);

  const cancelCreate = useCallback(() => setCreating(null), []);

  // ── Auto-focus + select on inline inputs ─────────────────
  // Only re-run when rename/create STARTS (null→non-null), NOT on every
  // keystroke — otherwise .focus()+setSelectionRange() fires after each
  // letter and disrupts typing.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      const dot = renaming.value.lastIndexOf('.');
      renameInputRef.current.setSelectionRange(0, dot > 0 ? dot : renaming.value.length);
    }
  }, [!!renaming]);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.select();
    }
  }, [!!creating]);

  // Rename input (only constructed when renaming is active — avoids null access)
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

  const isLeftOnly = layoutMode === 'left-only';

  return (
    <aside className="sidebar" style={{ width }}>
      {/* Left-only mode: header with layout toggle + space switcher */}
      {isLeftOnly && (
        <div className="sidebar-left-header">
          <LayoutToggle layoutMode={layoutMode} onToggleLayout={onToggleLayout} />
          <div className="sidebar-space-wrap">
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
          </div>
        </div>
      )}

      {/* Top-left mode: folder header */}
      {!isLeftOnly && folder && (
        <>
          <div className="sidebar-header">
            <span className="nav-item-icon"><FolderIcon size={14} /></span>
            {renaming ? renameInput : (
              <span className="sidebar-header-name" title={folder.name}>{folder.name}</span>
            )}
            {!renaming && (
              <button
                className="nav-action-btn more"
                onMouseEnter={handleMoreEnter}
                onMouseLeave={handleMoreLeave}
                title="更多操作"
              >
                <MoreIcon size={14} />
              </button>
            )}
          </div>

          {/* Inline create row — appears below the header */}
          {creating && (
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
        </>
      )}

      {/* Left-only: always show NavMenu (show empty hint when no items) */}
      {/* Top-left: show NavMenu only when folder is selected */}
      {(isLeftOnly || folder) && (
        items === null ? (
          <div className="sidebar-empty">加载中…</div>
        ) : (
          <NavMenu
            items={items}
            onFileHover={onFileHover}
            onFileLeave={onFileLeave}
            currentFileId={currentFileId}
            variant="sidebar"
            onDeleteEntry={onDeleteEntry}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRenameEntry={onRenameEntry}
            onLoadChildren={onLoadChildren}
            onOpenAsWorkspace={onOpenAsWorkspace}
          />
        )
      )}

      {/* ⋯ Action dropdown — position:fixed, never clipped by sidebar overflow */}
      {moreMenu && folder && (
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
                  确认删除「{folder.name}」？
                  <span className="more-confirm-sub">文件夹内所有内容将被删除</span>
                </div>
                <div className="more-confirm-actions">
                  <button className="more-btn cancel" onClick={closeMore}>取消</button>
                  <button className="more-btn danger" onClick={doDelete}>删除</button>
                </div>
              </div>
            ) : (
              /* ── Action menu ── */
              <>
                <div className="more-menu-item" onClick={handleOpenAsWorkspaceClick}>
                  <span className="more-menu-icon"><OpenWorkspaceIcon size={14} /></span>
                  <span>打开为空间</span>
                </div>
                <div className="more-menu-divider" />
                <div className="more-menu-item" onClick={() => startCreate('file')}>
                  <span className="more-menu-icon"><FileTypeIcon name="new.md" size={14} /></span>
                  <span>新建文件</span>
                </div>
                <div className="more-menu-item" onClick={() => startCreate('folder')}>
                  <span className="more-menu-icon"><NewFolderIcon size={14} /></span>
                  <span>新建文件夹</span>
                </div>
                <div className="more-menu-divider" />
                <div className="more-menu-item" onClick={startRename}>
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
    </aside>
  );
}

const Sidebar = memo(SidebarInner);
export default Sidebar;
