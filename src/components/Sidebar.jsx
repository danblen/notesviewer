import NavMenu from './NavMenu';

/**
 * Sidebar — persistent left panel showing Level-3+ items.
 *
 * Content updates when the user hovers on a Level-2 folder in the
 * TopBar dropdown.  Width is adjustable via the resizer handle in App.
 * The currently-open file is highlighted.
 */
export default function Sidebar({ items, onFileHover, onFileLeave, currentFileId, width }) {
  return (
    <aside className="sidebar" style={{ width }}>
      <NavMenu
        items={items}
        onFileHover={onFileHover}
        onFileLeave={onFileLeave}
        currentFileId={currentFileId}
        variant="sidebar"
      />
    </aside>
  );
}
