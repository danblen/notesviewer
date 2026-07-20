import { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  FolderIcon, FileTypeIcon, ChevronRight,
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

  // Reset loading tracking when items change (prevents stale IDs from blocking re-loads)
  const prevItemsRef = useRef(items);
  if (prevItemsRef.current !== items) {
    prevItemsRef.current = items;
    expandLoadingRef.current = new Set();
  }

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
                <div className="nav-item-row folder-row">
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
                  {isRenaming ? renameInput : <span className="nav-item-name" title={item.name}>{item.name}</span>}
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
                className={`nav-item-row file-row ${currentFileId === item.id ? 'active' : ''}`}
                onMouseEnter={() => onFileHover(item)}
                onMouseLeave={onFileLeave}
              >
                <span className="expand-icon-placeholder" />
                <span className="nav-item-icon"><FileTypeIcon name={item.name} size={15} /></span>
                {isRenaming ? renameInput : <span className="nav-item-name" title={item.name}>{item.name}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const NavMenu = memo(NavMenuInner);
export default NavMenu;
