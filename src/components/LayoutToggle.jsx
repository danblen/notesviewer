import { LayoutIcon } from './Icons';

export default function LayoutToggle({ layoutMode, onToggleLayout }) {
  return (
    <button
      className="layout-toggle-btn"
      onClick={onToggleLayout}
      title={
  layoutMode === 'left-right' ? '显示顶栏' :
  layoutMode === 'top-left' ? '仅显示侧边栏' :
  '仅左右布局'
}
    >
      <LayoutIcon size={15} />
    </button>
  );
}
