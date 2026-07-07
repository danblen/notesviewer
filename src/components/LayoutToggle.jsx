import { LayoutIcon } from './Icons';

export default function LayoutToggle({ layoutMode, onToggleLayout }) {
  return (
    <button
      className="layout-toggle-btn"
      onClick={onToggleLayout}
      title={layoutMode === 'top-left' ? '仅显示侧边栏' : '显示顶栏'}
    >
      <LayoutIcon size={15} />
    </button>
  );
}
