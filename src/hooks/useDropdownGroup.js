import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * useDropdownGroup — small store that lets multiple dropdowns coordinate.
 * Each dropdown calls `acquire(id)` when it wants to open, and
 * `release(id)` when it wants to close. The store tracks the active
 * id and notifies all subscribers, so other dropdowns close themselves.
 *
 * Usage:
 *   const group = useDropdownGroup();
 *   useEffect(() => { if (group.activeId && group.activeId !== id) setOpen(false); }, [group.activeId]);
 *   const handleEnter = () => { group.acquire(id); setOpen(true); };
 *   const handleLeave = () => { group.scheduleRelease(id, 300); };
 */
export function useDropdownGroup() {
  const subscribers = useRef(new Set());
  const [activeId, setActiveId] = useState(null);

  const acquire = useCallback((id) => {
    setActiveId(id);
    subscribers.current.forEach(fn => fn(id));
  }, []);

  const release = useCallback((id) => {
    setActiveId(prev => (prev === id ? null : prev));
    subscribers.current.forEach(fn => fn(null));
  }, []);

  const subscribe = useCallback((fn) => {
    subscribers.current.add(fn);
    return () => subscribers.current.delete(fn);
  }, []);

  return { activeId, acquire, release, subscribe };
}
