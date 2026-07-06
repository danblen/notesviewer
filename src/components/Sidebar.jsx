import NavMenu from './NavMenu';

/**
 * Sidebar — persistent left panel showing Level-3+ items.
 *
 * Content updates when the user hovers on a Level-2 folder in the
 * TopBar dropdown.  Once populated, the sidebar keeps its content
 * until another L2 folder is hovered.
 */
export default function Sidebar({ items, onFileHover, onFileLeave }) {
  return (
    <aside className="sidebar">
      <NavMenu
        items={items}
        onFileHover={onFileHover}
        onFileLeave={onFileLeave}
        variant="sidebar"
      />
    </aside>
  );
}
