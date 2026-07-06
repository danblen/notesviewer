import { useState, useRef, useCallback, useEffect } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ContentArea from './components/ContentArea';
import {
  selectAndBuildTree,
  getFileType,
  loadRecentSpaces,
  addRecentSpace,
  removeRecentSpace,
  saveDirHandle,
  deleteDirHandle,
  switchToSpace,
  tryRestoreSpace,
  loadLastSpaceId,
  saveLastSpaceId,
} from './utils/fileSystem';

const LS_SIDEBAR_W = 'nv_sidebar_width';
const LS_CONTENT_W = 'nv_content_width';
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 520;
const CONTENT_MIN = 400, CONTENT_MAX = 1800;

function loadNum(key, fallback, min, max) {
  const v = Number(localStorage.getItem(key));
  if (!v || isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export default function App() {
  const [rootName, setRootName] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [sidebarItems, setSidebarItems] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Recent spaces
  const [recentSpaces, setRecentSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);

  // Resizable widths (persisted)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadNum(LS_SIDEBAR_W, 260, SIDEBAR_MIN, SIDEBAR_MAX));
  const [contentMaxWidth, setContentMaxWidth] = useState(() =>
    loadNum(LS_CONTENT_W, 860, CONTENT_MIN, CONTENT_MAX));

  const fileOpenTimerRef = useRef(null);
  const currentFileIdRef = useRef(null);

  const currentFileId = currentFile?.node?.id || null;

  // Persist widths
  useEffect(() => { localStorage.setItem(LS_SIDEBAR_W, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem(LS_CONTENT_W, String(contentMaxWidth)); }, [contentMaxWidth]);

  // ── Boot: load recent spaces + silently restore last active ──
  useEffect(() => {
    const spaces = loadRecentSpaces();
    setRecentSpaces(spaces);

    const lastId = loadLastSpaceId();
    const tryId = lastId || (spaces.length > 0 ? spaces[0].id : null);
    if (tryId) {
      tryRestoreSpace(tryId).then(result => {
        if (result) {
          setRootName(result.name);
          setFileTree(result.tree);
          setActiveSpaceId(tryId);
          saveLastSpaceId(tryId);
        }
      }).catch(() => { /* ignore — user will select manually */ });
    }
  }, []);

  // ── Directory selection (the ONLY click action) ──────────
  const handleSelectDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const { tree, name, handle } = await selectAndBuildTree();
      setRootName(name);
      setFileTree(tree);
      setSidebarItems(null);
      setCurrentFile(null);
      currentFileIdRef.current = null;

      // Register as a recent space (only when handle is persistable)
      if (handle) {
        const spaceId = `space_${Date.now()}`;
        await saveDirHandle(spaceId, handle);
        setRecentSpaces(prev => addRecentSpace(prev, spaceId, name));
        setActiveSpaceId(spaceId);
        saveLastSpaceId(spaceId);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to select directory:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Switch to a previously-saved space (hover-triggered) ──
  const handleSwitchSpace = useCallback(async (spaceId) => {
    if (spaceId === activeSpaceId) return;
    setLoading(true);
    try {
      const { tree, name } = await switchToSpace(spaceId);
      setRootName(name);
      setFileTree(tree);
      setSidebarItems(null);
      setCurrentFile(null);
      currentFileIdRef.current = null;
      setActiveSpaceId(spaceId);
      saveLastSpaceId(spaceId);
    } catch (err) {
      console.error('Failed to switch space:', err);
      // Remove the stale space from the list + IDB
      setRecentSpaces(prev => removeRecentSpace(prev, spaceId));
      await deleteDirHandle(spaceId).catch(() => {});
      if (activeSpaceId === spaceId) {
        setActiveSpaceId(null);
        saveLastSpaceId(null);
      }
      alert(`无法切换到该笔记空间：\n${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeSpaceId]);

  // ── Open file ────────────────────────────────────────────
  const openFile = useCallback((fileNode) => {
    if (!fileNode || fileNode.kind !== 'file') return;
    if (currentFileIdRef.current === fileNode.id) return;

    const type = getFileType(fileNode.name);
    setCurrentFile({
      node: fileNode,
      name: fileNode.name,
      path: fileNode.path,
      type,
    });
    currentFileIdRef.current = fileNode.id;
  }, []);

  // ── Hover-to-open (200ms debounce) ───────────────────────
  const handleFileHover = useCallback((fileNode) => {
    clearTimeout(fileOpenTimerRef.current);
    fileOpenTimerRef.current = setTimeout(() => openFile(fileNode), 200);
  }, [openFile]);

  const handleFileLeave = useCallback(() => {
    clearTimeout(fileOpenTimerRef.current);
  }, []);

  // ── L2 folder hover → update sidebar ─────────────────────
  const handleLevel2Hover = useCallback((folderNode) => {
    setSidebarItems(folderNode.children || []);
  }, []);

  // ── Sidebar resize (delta-based, no ref needed) ──────────
  const onSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="app">
      <TopBar
        rootName={rootName}
        level1Items={fileTree}
        loading={loading}
        currentFileId={currentFileId}
        recentSpaces={recentSpaces}
        activeSpaceId={activeSpaceId}
        onSelectDirectory={handleSelectDirectory}
        onFileHover={handleFileHover}
        onFileLeave={handleFileLeave}
        onLevel2Hover={handleLevel2Hover}
        onSwitchSpace={handleSwitchSpace}
      />
      <div className="app-body">
        <Sidebar
          items={sidebarItems}
          width={sidebarWidth}
          currentFileId={currentFileId}
          onFileHover={handleFileHover}
          onFileLeave={handleFileLeave}
        />
        <div
          className="resizer sidebar-resizer"
          onMouseDown={onSidebarResizeStart}
          title="拖动调整侧边栏宽度"
        />
        <ContentArea
          file={currentFile}
          contentMaxWidth={contentMaxWidth}
          setContentMaxWidth={setContentMaxWidth}
        />
      </div>
    </div>
  );
}
