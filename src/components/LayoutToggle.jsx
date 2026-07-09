import { useState, useRef, useCallback, useEffect } from 'react';
import { LayoutIcon, ChevronRight, CheckIcon } from './Icons';

const LAYOUTS = [
  { value: 'top-left',  label: '顶 + 左侧' },
  { value: 'left-only', label: '仅左侧' },
  { value: 'auto-hide', label: '自动隐藏左侧' },
];

/**
 * LayoutToggle — hover-to-open dropdown that lets the user pick one of
 * three sidebar layouts. Visual style is unified with SpaceSelector's
 * dropdown (same .spaces-dropdown base class). When `dropdownGroup` is
 * supplied, opening this dropdown closes any other dropdown in the group
 * (mutual exclusion).
 */
export default function LayoutToggle({ layoutMode, onChangeLayout, dropdownGroup, dropdownId = 'layout' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const closeTimer = useRef(null);

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

  const handleEnter = useCallback((e) => {
    clearTimeout(closeTimer.current);
    if (dropdownGroup) dropdownGroup.acquire(dropdownId);
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
    setOpen(true);
  }, [dropdownGroup, dropdownId]);

  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      if (dropdownGroup) dropdownGroup.release(dropdownId);
    }, 300);
  }, [dropdownGroup, dropdownId]);

  const handleDropEnter = useCallback(() => clearTimeout(closeTimer.current), []);
  const handleDropLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      if (dropdownGroup) dropdownGroup.release(dropdownId);
    }, 300);
  }, [dropdownGroup, dropdownId]);

  const pick = useCallback((v) => {
    clearTimeout(closeTimer.current);
    setOpen(false);
    if (dropdownGroup) dropdownGroup.release(dropdownId);
    onChangeLayout?.(v);
  }, [onChangeLayout, dropdownGroup, dropdownId]);

  return (
    <>
      <div
        className={`layout-switcher ${open ? 'open' : ''}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        title="切换布局"
      >
        <LayoutIcon size={15} />
        <ChevronRight size={10} className="layout-chevron" />
      </div>
      {open && (
        <div
          className="spaces-dropdown layout-dropdown"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onMouseEnter={handleDropEnter}
          onMouseLeave={handleDropLeave}
        >
          {LAYOUTS.map(opt => (
            <div
              key={opt.value}
              className={`layout-dropdown-item ${layoutMode === opt.value ? 'active' : ''}`}
              onClick={() => pick(opt.value)}
            >
              <span className="layout-dropdown-label">{opt.label}</span>
              {layoutMode === opt.value && <CheckIcon size={12} className="check-icon" />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
