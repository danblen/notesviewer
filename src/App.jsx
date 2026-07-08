import { LayoutIcon, SearchIcon } from './components/Icons';
import { useState, useRef, useCallback, useEffect, memo } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ContentArea from './components/ContentArea';
import CloneModal from './components/CloneModal';
import SearchPanel from './components/SearchPanel';
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
  loadChildren,
  setChildrenInTree,
  findNodeByPath,
  deleteEntry,
  createFileEntry,
  createDirectoryEntry,
  renameEntry,
  openFolderAsWorkspace,
  openPathAsSpace,
} from './utils/fileSystem';

const LS_SIDEBAR_W = 'nv_sidebar_width';
const LS_CONTENT_W = 'nv_content_width';
const LS_LAYOUT = 'nv_layout';
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 520;
const CONTENT_MIN = 400, CONTENT_MAX = 1800;

function loadNum(key, fallback, min, max) {
  const v = Number(localStorage.getItem(key));
  if (!v || isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function loadLayout() {
  const v = localStorage.getItem(LS_LAYOUT);
  const valid = ['left-right', 'top-left', 'left-only'];
  return valid.includes(v) ? v : 'top-left';
}

export default function App() {
  const [rootName, setRootName] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [sidebarFolderPath, setSidebarFolderPath] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Root directory handle — kept for tree rebuilds after file operations
  const rootHandleRef = useRef(null);
  // Server root path — set when a cloned repo is opened without File System Access API
  const serverRootRef = useRef(null);
  const fileTreeRef = useRef([]);
  fileTreeRef.current = fileTree;

  // Derived: find sidebar folder in tree, get its children
  const sidebarFolder = sidebarFolderPath ? findNodeByPath(fileTree, sidebarFolderPath) : null;
  const sidebarItems = sidebarFolder?.children ?? null;

  // Recent spaces
  const [recentSpaces, setRecentSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(null);

  // Resizable widths (persisted)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadNum(LS_SIDEBAR_W, 260, SIDEBAR_MIN, SIDEBAR_MAX));
  const [contentMaxWidth, setContentMaxWidth] = useState(() =>
    loadNum(LS_CONTENT_W, 860, CONTENT_MIN, CONTENT_MAX));
  const [layoutMode, setLayoutMode] = useState(loadLayout);

  const toggleLayout = useCallback(() => {
    setLayoutMode(prev => {
      const order = ['left-right', 'top-left', 'left-only'];
      const next = order[(order.indexOf(prev) + 1) % order.length];
      localStorage.setItem(LS_LAYOUT, next);
      return next;
    });
  }, []);

  const fileOpenTimerRef = useRef(null);
  const currentFileIdRef = useRef(null);

  // True while the open file has unsaved edits — blocks hover-switching
  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((d) => { dirtyRef.current = d; }, []);

  // Clone GitHub modal
  const [showClone, setShowClone] = useState(false);
  const openClone = useCallback(() => setShowClone(true), []);
  const closeClone = useCallback(() => setShowClone(false), []);

  // Search panel
  const [searchOpen, setSearchOpen] = useState(false);
  const [revealPath, setRevealPath] = useState(null);
  const [scrollTarget, setScrollTarget] = useState(null); // { line, path }
  const searchHoverTimerRef = useRef(null);
  const searchFileHoverTimerRef = useRef(null);

  const handleSearchIconEnter = useCallback(() => {
    clearTimeout(searchHoverTimerRef.current);
    searchHoverTimerRef.current = setTimeout(() => setSearchOpen(true), 80);
  }, []);

  const handleSearchIconLeave = useCallback(() => {
    clearTimeout(searchHoverTimerRef.current);
  }, []);

  const handleSearchIconClick = useCallback(() => {
    clearTimeout(searchHoverTimerRef.current);
    setSearchOpen(false);
    setRevealPath(null);
    setScrollTarget(null);
  }, []);

  const handleSearchResultLeave = useCallback(() => {
    clearTimeout(searchFileHoverTimerRef.current);
  }, []);

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
          rootHandleRef.current = result.handle;
          serverRootRef.current = null;
          setRootName(result.name);
          setFileTree(result.tree);
          setActiveSpaceId(tryId);
          activeSpaceIdRef.current = tryId;
          saveLastSpaceId(tryId);
        }
      }).catch(() => { /* ignore — user will select manually */ });
    }
  }, []);

  // ── Directory selection (the ONLY click action) ──────────
  const handleSelectDirectory = useCallback(async () => {
    if (dirtyRef.current && !window.confirm('当前文件有未保存的修改，是否放弃？')) return;
    dirtyRef.current = false;
    setLoading(true);
    try {
      const { tree, name, handle } = await selectAndBuildTree();
      rootHandleRef.current = handle;
      serverRootRef.current = null;
      setRootName(name);
      setFileTree(tree);
      setSidebarFolderPath(null);
      sidebarFolderRef.current = null;
      setCurrentFile(null);
      currentFileIdRef.current = null;

      // Register as a recent space (only when handle is persistable)
      if (handle) {
        const spaceId = `space_${Date.now()}`;
        await saveDirHandle(spaceId, handle);
        setRecentSpaces(prev => addRecentSpace(prev, spaceId, name));
        setActiveSpaceId(spaceId);
        activeSpaceIdRef.current = spaceId;
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
  const activeSpaceIdRef = useRef(null);
  const handleSwitchSpace = useCallback(async (spaceId) => {
    if (spaceId === activeSpaceIdRef.current) return;
    // Don't switch while there are unsaved edits (prevents silent data loss)
    if (dirtyRef.current) return;
    setLoading(true);
    try {
      const { tree, name, handle } = await switchToSpace(spaceId);
      rootHandleRef.current = handle;
      serverRootRef.current = null;
      setRootName(name);
      setFileTree(tree);
      setSidebarFolderPath(null);
      sidebarFolderRef.current = null;
      setCurrentFile(null);
      currentFileIdRef.current = null;
      setActiveSpaceId(spaceId);
      activeSpaceIdRef.current = spaceId;
      saveLastSpaceId(spaceId);
    } catch (err) {
      console.error('Failed to switch space:', err);
      // Remove the stale space from the list + IDB
      setRecentSpaces(prev => removeRecentSpace(prev, spaceId));
      await deleteDirHandle(spaceId).catch(() => {});
      if (activeSpaceIdRef.current === spaceId) {
        setActiveSpaceId(null);
        activeSpaceIdRef.current = null;
        saveLastSpaceId(null);
      }
      alert(`无法切换到该笔记空间：\n${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Open file ────────────────────────────────────────────
  const openFile = useCallback((fileNode) => {
    if (!fileNode || fileNode.kind !== 'file') return;
    if (currentFileIdRef.current === fileNode.id) return;
    // Safety net: handleFileHover already blocks while dirty, but guard anyway
    if (dirtyRef.current) return;

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
    // Block opening another file while the current one has unsaved edits
    if (dirtyRef.current) return;
    fileOpenTimerRef.current = setTimeout(() => openFile(fileNode), 200);
  }, [openFile]);

  const handleFileLeave = useCallback(() => {
    clearTimeout(fileOpenTimerRef.current);
  }, []);

  // ── Reload children of a directory by path (after file ops) ──
  // sidebarFolderRef stores the path string for stable callbacks
  const sidebarFolderRef = useRef(null);

  const reloadDirectory = useCallback(async (dirPath) => {
    if (!dirPath) {
      // Server-backed root (cloned repo)
      if (serverRootRef.current) {
        const children = await loadChildren({ serverPath: serverRootRef.current, path: '', kind: 'directory' });
        setFileTree(children);
        return children;
      }
      const handle = rootHandleRef.current;
      if (!handle) return [];
      const children = await loadChildren({ handle, path: '', kind: 'directory' });
      setFileTree(children);
      return children;
    }
    const dirNode = findNodeByPath(fileTreeRef.current, dirPath);
    if (!dirNode || !dirNode.handle) return [];
    const children = await loadChildren(dirNode);
    setFileTree(prev => setChildrenInTree(prev, dirPath, children));
    return children;
  }, []);

  // ── Lazy-load children for a node (TopBar L1 hover + NavMenu expand) ──
  // Always preloads one extra level for subdirectories so empty folders
  // never show an expand chevron.
  const loadChildrenForNode = useCallback(async (node) => {
    if (node.kind !== 'directory' || node.children !== null) return;
    try {
      const children = await loadChildren(node);
      const preloaded = await Promise.all(children.map(async (ch) => {
        if (ch.kind === 'directory') {
          const sub = await loadChildren(ch).catch(() => []);
          return { ...ch, children: sub };
        }
        return ch;
      }));
      setFileTree(prev => {
        if (!findNodeByPath(prev, node.path)) return prev;
        return setChildrenInTree(prev, node.path, preloaded);
      });
    } catch (err) {
      console.error('Failed to load children:', err);
      setFileTree(prev => setChildrenInTree(prev, node.path, []));
    }
  }, []);

  // ── Delete a file or directory from disk ────────────────
  // (confirmation is handled in the NavMenu UI — no window.confirm)
  const handleDeleteEntry = useCallback(async (node) => {
    if (!node) return;
    try {
      await deleteEntry(node);
      if (node.kind === 'file' && currentFileIdRef.current === node.id) {
        setCurrentFile(null);
        currentFileIdRef.current = null;
        dirtyRef.current = false;
      }
      const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
      await reloadDirectory(parentPath);
    } catch (err) {
      console.error('Delete error:', err);
      alert(`删除失败：\n${err.message}`);
    }
  }, [reloadDirectory]);

  // ── Create a new file inside a directory ─────────────────
  // (filename comes from the inline NavMenu input — no window.prompt)
  const handleCreateFile = useCallback(async (dirNode, name) => {
    if (!dirNode || dirNode.kind !== 'directory' || !name) return;
    // Basic validation
    if (/[\\/]/.test(name)) {
      alert('文件名不能包含路径分隔符');
      return;
    }
    if (dirNode.children?.some(c => c.name === name)) {
      alert(`文件「${name}」已存在`);
      return;
    }
    try {
      const dirHandle = dirNode.handle || dirNode;
      await createFileEntry(dirHandle, name);
      const parentPath = dirNode.path ?? '';
      const filePath = parentPath ? `${parentPath}/${name}` : name;
      const children = await reloadDirectory(parentPath);
      const newNode = children.find(c => c.path === filePath);
      if (newNode && newNode.kind === 'file') {
        const type = getFileType(newNode.name);
        setCurrentFile({ node: newNode, name: newNode.name, path: newNode.path, type });
        currentFileIdRef.current = newNode.id;
      }
    } catch (err) {
      console.error('Create file error:', err);
      alert(`创建失败：\n${err.message}`);
    }
  }, [reloadDirectory]);

  // ── Create a new directory inside a directory ────────────
  const handleCreateFolder = useCallback(async (dirNode, name) => {
    if (!dirNode || dirNode.kind !== 'directory' || !name) return;
    if (/[\\/]/.test(name)) {
      alert('文件夹名不能包含路径分隔符');
      return;
    }
    if (dirNode.children?.some(c => c.name === name)) {
      alert(`文件夹「${name}」已存在`);
      return;
    }
    try {
      const dirHandle = dirNode.handle || dirNode;
      await createDirectoryEntry(dirHandle, name);
      await reloadDirectory(dirNode.path ?? '');
    } catch (err) {
      console.error('Create folder error:', err);
      alert(`创建失败：\n${err.message}`);
    }
  }, [reloadDirectory]);

  // ── Rename a file or directory ───────────────────────────
  // (new name comes from the inline NavMenu input — no window.prompt)
  const handleRenameEntry = useCallback(async (node, newName) => {
    if (!node || !newName || newName === node.name) return;
    if (/[\\/]/.test(newName)) {
      alert('名称不能包含路径分隔符');
      return;
    }
    // Check for duplicates among siblings
    // (We can't easily access siblings here, but renameEntry will throw
    //  if the target name already exists via getDirectoryHandle/getFileHandle)
    try {
      await renameEntry(node, newName);
      const parentPath = node.path.includes('/')
        ? node.path.slice(0, node.path.lastIndexOf('/'))
        : '';
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      const children = await reloadDirectory(parentPath);
      if (node.kind === 'file' && currentFileIdRef.current === node.id) {
        const newNode = children.find(c => c.path === newPath);
        if (newNode && newNode.kind === 'file') {
          const type = getFileType(newNode.name);
          setCurrentFile({ node: newNode, name: newNode.name, path: newNode.path, type });
          currentFileIdRef.current = newNode.id;
        }
      }
    } catch (err) {
      console.error('Rename error:', err);
      alert(`重命名失败：\n${err.message}`);
    }
  }, [reloadDirectory]);

  // ── Open a subfolder as the new workspace root ───────────
  // Re-roots the file tree to the selected folder, registers it as a
  // new space, and clears the sidebar + current file.
  const handleOpenAsWorkspace = useCallback(async (node) => {
    if (!node || node.kind !== 'directory') return;
    if (dirtyRef.current && !window.confirm('当前文件有未保存的修改，是否放弃？')) return;
    dirtyRef.current = false;
    setLoading(true);
    try {
      const { handle, tree, name } = await openFolderAsWorkspace(node.handle);
      rootHandleRef.current = handle;
      serverRootRef.current = null;
      setRootName(name);
      setFileTree(tree);
      setSidebarFolderPath(null);
      sidebarFolderRef.current = null;
      setCurrentFile(null);
      currentFileIdRef.current = null;

      // Register as a new space so it appears in the spaces switcher
      if (handle) {
        const spaceId = `space_${Date.now()}`;
        await saveDirHandle(spaceId, handle);
        setRecentSpaces(prev => addRecentSpace(prev, spaceId, name));
        setActiveSpaceId(spaceId);
        activeSpaceIdRef.current = spaceId;
        saveLastSpaceId(spaceId);
      }
    } catch (err) {
      console.error('Failed to open as workspace:', err);
      alert(`打开空间失败：\n${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Open a freshly-cloned repo as a space (server-backed) ──
  // Bypasses the File System Access API folder picker — reads the
  // directory tree directly via the backend clone-server.
  const handleOpenClonedSpace = useCallback(async (destPath) => {
    if (!destPath) return;
    if (dirtyRef.current && !window.confirm('当前文件有未保存的修改，是否放弃？')) return;
    dirtyRef.current = false;
    setLoading(true);
    try {
      const { tree, name, serverRoot } = await openPathAsSpace(destPath);
      rootHandleRef.current = null;
      serverRootRef.current = serverRoot;
      setRootName(name);
      setFileTree(tree);
      setSidebarFolderPath(null);
      sidebarFolderRef.current = null;
      setCurrentFile(null);
      currentFileIdRef.current = null;
      setActiveSpaceId(null);
      activeSpaceIdRef.current = null;
      saveLastSpaceId(null);
      closeClone();
    } catch (err) {
      console.error('Failed to open cloned space:', err);
      alert(`打开克隆仓库失败：\n${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [closeClone]);

  // ── Delete a workspace from the spaces dropdown ──────────
  // (confirmation is handled in the TopBar UI — no window.confirm)
  const recentSpacesRef = useRef([]);
  recentSpacesRef.current = recentSpaces;
  const handleDeleteSpace = useCallback(async (spaceId) => {
    const spaces = recentSpacesRef.current;
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    const isActive = spaceId === activeSpaceIdRef.current;
    // Remove from IDB
    await deleteDirHandle(spaceId).catch(() => {});
    // Remove from recent list
    setRecentSpaces(prev => removeRecentSpace(prev, spaceId));
    // If it was the active space, clear everything
    if (isActive) {
      rootHandleRef.current = null;
      serverRootRef.current = null;
      setRootName(null);
      setFileTree([]);
      setSidebarFolderPath(null);
      sidebarFolderRef.current = null;
      setCurrentFile(null);
      currentFileIdRef.current = null;
      setActiveSpaceId(null);
      activeSpaceIdRef.current = null;
      saveLastSpaceId(null);
    }
  }, []);

  // ── L2 folder hover → update sidebar (lazy-load if needed) ──
  const handleLevel2Hover = useCallback(async (folderNode) => {
    setSidebarFolderPath(folderNode.path);
    sidebarFolderRef.current = folderNode.path;
    await loadChildrenForNode(folderNode);
  }, [loadChildrenForNode]);

  // ── Hover a search match → open file + scroll to line + reveal in sidebar ──
  const handleSearchResultHover = useCallback((result, match) => {
    if (dirtyRef.current) return;

    clearTimeout(searchFileHoverTimerRef.current);
    searchFileHoverTimerRef.current = setTimeout(() => {
      // Only reload the file if it's different from what's currently open
      if (currentFileIdRef.current !== result.path) {
        const fileNode = {
          id: result.path,
          name: result.name,
          kind: 'file',
          path: result.path,
          handle: result.handle,
        };
        const type = getFileType(result.name);
        setCurrentFile({ node: fileNode, name: result.name, path: result.path, type });
        currentFileIdRef.current = result.path;

        // Reveal in sidebar: set the L2 ancestor as sidebar folder
        // (top-left mode), then set revealPath for NavMenu auto-expansion.
        const segments = result.path.split('/');
        if (segments.length >= 2) {
          const l2Path = segments[0];
          const l2Node = fileTreeRef.current.find(n => n.path === l2Path);
          if (l2Node && layoutMode === 'top-left') {
            handleLevel2Hover(l2Node);
          }
        }
        setRevealPath(result.path);
      }

      // Always set scroll target — triggers scroll-to-line in CodeViewer
      setScrollTarget({ line: match.lineNum, path: result.path });
    }, 200);
  }, [layoutMode, handleLevel2Hover]);


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
      {layoutMode === 'top-left' && (
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
        onDeleteSpace={handleDeleteSpace}
        onCloneGithub={openClone}
          onLoadChildren={loadChildrenForNode}
          layoutMode={layoutMode}
          onToggleLayout={toggleLayout}
        />
      )}
      <div className="app-body">
        <Sidebar
          items={layoutMode === 'top-left' ? sidebarItems : fileTree}
          folder={layoutMode === 'top-left' ? sidebarFolder : null}
          width={sidebarWidth}
          currentFileId={currentFileId}
          layoutMode={layoutMode}
          onToggleLayout={toggleLayout}
          rootName={rootName}
          loading={loading}
          recentSpaces={recentSpaces}
          activeSpaceId={activeSpaceId}
          onSelectDirectory={handleSelectDirectory}
          onSwitchSpace={handleSwitchSpace}
          onDeleteSpace={handleDeleteSpace}
          onCloneGithub={openClone}
          onFileHover={handleFileHover}
          onFileLeave={handleFileLeave}
          onDeleteEntry={handleDeleteEntry}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onRenameEntry={handleRenameEntry}
          onLoadChildren={loadChildrenForNode}
          onOpenAsWorkspace={handleOpenAsWorkspace}
          revealPath={revealPath}
        />
        <div
          className="resizer sidebar-resizer"
          style={{ left: sidebarWidth }}
          onMouseDown={onSidebarResizeStart}
          title="拖动调整侧边栏宽度"
        />
        <ContentArea
          file={currentFile}
          contentMaxWidth={contentMaxWidth}
          setContentMaxWidth={setContentMaxWidth}
          onDirtyChange={handleDirtyChange}
          scrollTarget={scrollTarget}
        />
        {/* Search trigger — hover to open, click to close */}
        <div
          className={`search-trigger ${searchOpen ? 'open' : ''}`}
          onMouseEnter={handleSearchIconEnter}
          onMouseLeave={handleSearchIconLeave}
          onClick={handleSearchIconClick}
          title={searchOpen ? '点击收起搜索' : '悬浮打开搜索'}
        >
          <SearchIcon size={16} className="search-trigger-icon" />
        </div>
        {searchOpen && (
          <SearchPanel
            rootHandle={rootHandleRef.current}
            onHoverResult={handleSearchResultHover}
            onLeaveResult={handleSearchResultLeave}
          />
        )}
      </div>
      {showClone && <CloneModal onClose={closeClone} onOpenAsSpace={handleOpenClonedSpace} />}
    </div>
  );
}
