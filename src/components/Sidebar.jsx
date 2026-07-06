import NavMenu from './NavMenu';
import { PlusIcon } from './Icons';

/**
 * Sidebar — persistent left panel showing Level-3+ items.
 *
 * Content updates when the user hovers on a Level-2 folder in the
 * TopBar dropdown.  Width is adjustable via the resizer handle in App.
 * The currently-open file is highlighted.
 *
 * Header: shows the current folder name with a "+" button to create
 * a new file directly inside it.
 */
export default function Sidebar({ items, onFileHover, onFileLeave, currentFileId, width, folder, onDeleteEntry, onCreateFile, onCreateFolder, onRenameEntry }) {
  return (
    <aside className="sidebar" style={{ width }}>
      {folder && (
        <div className="sidebar-header">
          <span className="sidebar-header-name" title={folder.name}>{folder.name}</span>
          <button
            className="nav-action-btn create"
            onClick={() => onCreateFile?.(folder)}
            title="在此文件夹中新建文件"
          >
            <PlusIcon size={14} />
          </button>
        </div>
      )}
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
      />
    </aside>
  );
}
