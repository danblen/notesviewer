import { LayoutIcon, SearchIcon } from './components/Icons';
import { useState, useRef, useCallback, useEffect, memo, Component } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ContentArea from './components/ContentArea';
import CloneModal from './components/CloneModal';
import SearchPanel from './components/SearchPanel';
import GitDiffPanel from './components/GitDiffPanel';
import { useDropdownGroup } from './hooks/useDropdownGroup';
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
  refreshTree,
} from './utils/fileSystem';
import {
  isGitRepoFsa,
  isGitRepoServer,
  getGitStatusFsa,
  getGitStatusServer,
  getFileDiffFsa,
  getFileDiffServer,
} from './utils/gitUtils';

const LS_SIDEBAR_W = 'nv_sidebar_width';
const LS_CONTENT_W = 'nv_content_width';
const LS_LAYOUT = 'nv_layout';
const LS_RIGHT_PANEL_W = 'nv_right_panel_width';
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 520;
const CONTENT_MIN = 400, CONTENT_MAX = 1800;
const RIGHT_PANEL_MIN = 320, RIGHT_PANEL_MAX = 700;

function loadNum(key, fallback, min, max) {
  const v = Number(localStorage.getItem(key));
  if (!v || isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function loadLayout() {
  const v = localStorage.getItem(LS_LAYOUT);
  const valid = ['top-left', 'left-only', 'auto-hide'];
  return valid.includes(v) ? v : 'left-only';
}

// ── Error boundary: prevents GitDiffPanel (or any child) render errors ──
// from crashing the entire app. Shows a fallback message instead.
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[GitDiffPanel] render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontSize: 13, color: '#888', textAlign: 'center' }}>
          Git 面板渲染出错
          <br />
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8, cursor: 'pointer', color: '#007aff', background: 'none', border: 'none', fontSize: 13 }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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

  // ── Git diff panel state ─────────────────────────────────
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [activeRightPanel, setActiveRightPanel] = useState(null);
  const [gitChanges, setGitChanges] = useState([]);
  const [gitBranch, setGitBranch] = useState('HEAD');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState(null);
  const [selectedGitFile, setSelectedGitFile] = useState(null);
  const [gitDiffData, setGitDiffData] = useState(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffError, setGitDiffError] = useState(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    loadNum(LS_RIGHT_PANEL_W, 440, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));

  // Refs for caching git data between status call and diff calls
  const gitHeadTreeMapRef = useRef(null);
  const gitFsRef = useRef(null);
  const gitClickLockRef = useRef(false);

  // Refs mirroring git state, for use inside event listeners / quiet refresh
  const isGitRepoRef = useRef(false);
  isGitRepoRef.current = isGitRepo;
  const selectedGitFileRef = useRef(null);
  selectedGitFileRef.current = selectedGitFile;
  const gitRefreshRunningRef = useRef(false);
  const gitLastRefreshRef = useRef(0);

  const changeLayoutMode = useCallback((mode) => {
    setLayoutMode(mode);
    localStorage.setItem(LS_LAYOUT, mode);
  }, []);

  // ── Auto-hide sidebar state ─────────────────────────────
  // Only relevant when layoutMode === 'auto-hide'.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarHideTimer = useRef(null);
  const HIDE_DELAY = 250;

  // Shared store so layout dropdown and spaces dropdown are mutually exclusive
  const dropdownGroup = useDropdownGroup();

  const openSidebar = useCallback(() => {
    clearTimeout(sidebarHideTimer.current);
    setSidebarOpen(true);
  }, []);
  const scheduleHide = useCallback(() => {
    clearTimeout(sidebarHideTimer.current);
    sidebarHideTimer.current = setTimeout(() => setSidebarOpen(false), HIDE_DELAY);
  }, []);

  useEffect(() => {
    clearTimeout(sidebarHideTimer.current);
    if (layoutMode === 'auto-hide') {
      setSidebarOpen(false);
    } else {
      setSidebarOpen(true);
    }
  }, [layoutMode]);

  const fileOpenTimerRef = useRef(null);
  const currentFileIdRef = useRef(null);

  // True while the open file has unsaved edits — blocks hover-switching
  const dirtyRef = useRef(false);
  const handleDirtyChange = useCallback((d) => { dirtyRef.current = d; }, []);

  // Clone GitHub modal
  const [showClone, setShowClone] = useState(false);
  const openClone = useCallback(() => setShowClone(true), []);
  const closeClone = useCallback(() => setShowClone(false), []);

  // Unified right panel state
  const [revealPath, setRevealPath] = useState(null);
  const [scrollTarget, setScrollTarget] = useState(null); // { line, path }
  const rightPanelTimerRef = useRef(null);
  const searchFileHoverTimerRef = useRef(null);

  const openRightPanel = useCallback((panel) => {
    clearTimeout(rightPanelTimerRef.current);
    rightPanelTimerRef.current = setTimeout(() => setActiveRightPanel(panel), 80);
  }, []);

  const closeRightPanel = useCallback(() => {
    clearTimeout(rightPanelTimerRef.current);
    setActiveRightPanel(null);
  }, []);

  const handleSearchResultLeave = useCallback(() => {
    clearTimeout(searchFileHoverTimerRef.current);
  }, []);

  const currentFileId = currentFile?.node?.id || null;

  // Persist widths
  useEffect(() => { localStorage.setItem(LS_SIDEBAR_W, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem(LS_CONTENT_W, String(contentMaxWidth)); }, [contentMaxWidth]);
  useEffect(() => { localStorage.setItem(LS_RIGHT_PANEL_W, String(rightPanelWidth)); }, [rightPanelWidth]);

  // ── Git: load status (changed files + branch) ────────────
  const loadGitStatus = useCallback(async () => {
    setGitLoading(true);
    setGitError(null);
    setSelectedGitFile(null);
    setGitDiffData(null);
    try {
      if (rootHandleRef.current) {
        const result = await getGitStatusFsa(rootHandleRef.current);
        gitHeadTreeMapRef.current = result.headTreeMap;
        gitFsRef.current = result.fs;
        setGitChanges(result.changes);
        setGitBranch(result.branch);
      } else if (serverRootRef.current) {
        const result = await getGitStatusServer(serverRootRef.current);
        gitHeadTreeMapRef.current = null;
        gitFsRef.current = null;
        setGitChanges(result.changes);
        setGitBranch(result.branch);
      } else {
        // No handle and no server root — can't load git status
        setGitChanges([]);
        setGitBranch('HEAD');
      }
    } catch (err) {
      setGitError(err.message || String(err));
    } finally {
      setGitLoading(false);
    }
  }, []);

  // ── Git: detect repo when space changes ──────────────────
  useEffect(() => {
    let cancelled = false;
    async function detectGit() {
      // Reset git state
      setIsGitRepo(false);
      if (activeRightPanel === 'git') setActiveRightPanel(null);
      setGitChanges([]);
      setSelectedGitFile(null);
      setGitDiffData(null);
      gitHeadTreeMapRef.current = null;
      gitFsRef.current = null;

      const handle = rootHandleRef.current;
      const serverRoot = serverRootRef.current;
      const tree = fileTreeRef.current;

      // Fallback: check file tree for .git entry (works even without a handle)
      const hasGitInTree = Array.isArray(tree) && tree.some(n => n.name === '.git');

      if (handle) {
        let isGit = await isGitRepoFsa(handle);
        // If handle check fails, fall back to tree inspection
        if (!isGit && hasGitInTree) isGit = true;
        if (!cancelled && isGit) {
          setIsGitRepo(true);
          loadGitStatus();
        }
      } else if (serverRoot) {
        const isGit = await isGitRepoServer(serverRoot);
        if (!cancelled && isGit) {
          setIsGitRepo(true);
          loadGitStatus();
        }
      } else if (hasGitInTree) {
        // webkitdirectory fallback — no handle, but .git exists in tree.
        // We can't run isomorphic-git without an FSA handle, but we CAN
        // try the server backend if the tree nodes carry serverPath.
        // Otherwise, show the panel with an informative message.
        const hasServerPath = Array.isArray(tree) && tree.some(n => n.serverPath);
        if (hasServerPath) {
          // Server-backed tree — extract serverRoot from first node's serverPath
          const firstNode = tree.find(n => n.serverPath);
          if (firstNode) {
            const root = firstNode.serverPath.replace(/\/[^/]+$/, '');
            serverRootRef.current = root;
            const isGit = await isGitRepoServer(root);
            if (!cancelled && isGit) {
              setIsGitRepo(true);
              loadGitStatus();
            }
          }
        } else {
          // Pure webkitdirectory — no server backend, no FSA handle.
          // Show panel with a message that git diff needs Chrome/Edge.
          setIsGitRepo(true);
          setGitError('当前浏览器不支持 Git diff 功能，请使用 Chrome 或 Edge 浏览器以获取完整体验。');
          setGitLoading(false);
        }
      }
    }
    detectGit();
    return () => { cancelled = true; };
  }, [rootName, loadGitStatus]);

  // ── Git: hover a file in the change tree → load diff ─────
   const handleCloseDiff = useCallback(() => {
    setSelectedGitFile(null);
    setGitDiffData(null);
  }, []);

  // Fetch and display the diff for a single changed file.
  const fetchGitDiff = useCallback(async (fileNode) => {
    setGitDiffLoading(true);
    setGitDiffError(null);
    try {
      let result;
      if (rootHandleRef.current) {
        result = await getFileDiffFsa(
          rootHandleRef.current,
          fileNode.path,
          gitHeadTreeMapRef.current,
          gitFsRef.current,
          fileNode.status
        );
      } else if (serverRootRef.current) {
        result = await getFileDiffServer(
          serverRootRef.current, fileNode.path, fileNode.status
        );
      }
      if (result) setGitDiffData(result);
    } catch (err) {
      setGitDiffError(err.message || String(err));
    } finally {
      setGitDiffLoading(false);
    }
  }, []);

  const handleGitFileClick = useCallback((fileNode) => {
    if (selectedGitFile?.path === fileNode.path) {
      // Re-click keeps the current selection
      return;
    }
    setSelectedGitFile(fileNode);
    fetchGitDiff(fileNode);
  }, [selectedGitFile, fetchGitDiff]);

  // ── Git: quiet auto-refresh ──────────────────────────────
  // Reloads the change list WITHOUT the loading spinner or clearing the
  // open diff. If a file's diff is currently shown, its latest content is
  // re-fetched; if the file is clean again, the diff is closed.
  // Triggered on git-panel open and on window focus (see effects below).
  const refreshGitStatusQuiet = useCallback(async () => {
    if (!isGitRepoRef.current) return;
    if (gitRefreshRunningRef.current) return;
    // Throttle bursts (focus + panel-open can fire nearly together)
    const now = Date.now();
    if (now - gitLastRefreshRef.current < 800) return;
    gitLastRefreshRef.current = now;
    gitRefreshRunningRef.current = true;
    try {
      let result;
      if (rootHandleRef.current) {
        result = await getGitStatusFsa(rootHandleRef.current);
        gitHeadTreeMapRef.current = result.headTreeMap;
        gitFsRef.current = result.fs;
      } else if (serverRootRef.current) {
        result = await getGitStatusServer(serverRootRef.current);
        gitHeadTreeMapRef.current = null;
        gitFsRef.current = null;
      } else {
        return;
      }
      setGitChanges(result.changes);
      setGitBranch(result.branch);

      // Re-sync the currently open diff (if any)
      const sel = selectedGitFileRef.current;
      if (sel) {
        const still = result.changes.find(c => c.path === sel.path);
        if (!still) {
          // File is clean again → close the diff
          setSelectedGitFile(null);
          setGitDiffData(null);
        } else {
          // Status may have shifted (e.g. added → modified) — refresh both
          const updated = still.status === sel.status ? sel : { ...sel, status: still.status };
          if (updated !== sel) setSelectedGitFile(updated);
          fetchGitDiff(updated);
        }
      }
    } catch { /* quiet — keep existing data on failure */ }
    finally {
      gitRefreshRunningRef.current = false;
    }
  }, [fetchGitDiff]);

  // ── File tree: quiet auto-refresh ────────────────────────
  // Re-reads the tree from disk (preserving expanded folders) so newly
  // added / removed / renamed files show up without a manual refresh.
  const treeRefreshRunningRef = useRef(false);
  const treeLastRefreshRef = useRef(0);
  const refreshFileTree = useCallback(async () => {
    if (treeRefreshRunningRef.current) return;
    let rootRef = null;
    if (rootHandleRef.current) rootRef = { handle: rootHandleRef.current };
    else if (serverRootRef.current) rootRef = { serverPath: serverRootRef.current };
    else return;
    // Throttle bursts (focus + visibilitychange can fire together)
    const now = Date.now();
    if (now - treeLastRefreshRef.current < 800) return;
    treeLastRefreshRef.current = now;
    treeRefreshRunningRef.current = true;
    try {
      const fresh = await refreshTree(fileTreeRef.current, rootRef);
      setFileTree(fresh);
    } catch { /* quiet — keep existing tree on failure */ }
    finally {
      treeRefreshRunningRef.current = false;
    }
  }, []);

  // Auto-refresh when the git panel is opened
  useEffect(() => {
    if (activeRightPanel === 'git' && isGitRepo) {
      refreshGitStatusQuiet();
    }
  }, [activeRightPanel, isGitRepo, refreshGitStatusQuiet]);

  // Auto-refresh git status + file tree when the window/tab regains focus
  // (catches edits made in external editors/IDEs)
  useEffect(() => {
    const onFocus = () => { refreshGitStatusQuiet(); refreshFileTree(); };
    const onVisible = () => {
      if (!document.hidden) { refreshGitStatusQuiet(); refreshFileTree(); }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshGitStatusQuiet, refreshFileTree]);

  // ── Right panel resize (drag left = wider) ────────────────
  const onRightPanelResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightPanelWidth;
    const onMove = (ev) => {
      const w = Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, startW - (ev.clientX - startX)));
      setRightPanelWidth(w);
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
  }, [rightPanelWidth]);

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
    // Safety net: handleFileHover already blocks while dirty, but guard anyway
    if (dirtyRef.current) return;

    // Hovering a sidebar file dismisses the Git diff overlay so the file's own
    // content is shown instead of being covered by the diff view. Done before
    // the same-file early return so re-hovering the underlying file also works.
    setSelectedGitFile(null);
    setGitDiffData(null);

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
  // Grace timer: when the mouse leaves a file row, wait briefly before
  // clearing the open-timer.  This lets the next file row's onMouseEnter
  // "take over" the pending open without the user seeing a flicker.
  // If relatedTarget is another .file-row, skip clearing entirely — the
  // new row's enter handler will reset the timer for the new file.
  const fileLeaveTimerRef = useRef(null);
  const handleFileHover = useCallback((fileNode) => {
    clearTimeout(fileOpenTimerRef.current);
    clearTimeout(fileLeaveTimerRef.current);
    // Block opening another file while the current one has unsaved edits
    if (dirtyRef.current) return;
    fileOpenTimerRef.current = setTimeout(() => openFile(fileNode), 200);
  }, [openFile]);

  const handleFileLeave = useCallback((e) => {
    // If mouse moved directly to another file row, let its onMouseEnter
    // handle the switch — don't clear the timer here.
    const related = e?.relatedTarget;
    if (related?.closest?.('.file-row')) return;
    // Grace period: clear the open-timer after a short delay so that
    // rapid cross-panel movements (content → sidebar) don't lose the
    // pending file-open.
    clearTimeout(fileLeaveTimerRef.current);
    fileLeaveTimerRef.current = setTimeout(() => {
      clearTimeout(fileOpenTimerRef.current);
    }, 50);
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
    if (!dirNode) return [];
    // Support both FSA nodes (handle) and server-backed nodes (serverPath)
    if (!dirNode.handle && !dirNode.serverPath) return [];
    const children = await loadChildren(dirNode);
    // Preserve parentHandle on children for file operations (delete/create/rename)
    if (dirNode.handle) {
      children.forEach(ch => { ch.parentHandle = dirNode.handle; });
    }
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
      // Preserve parentHandle on children for file operations
      if (node.handle) {
        children.forEach(ch => { ch.parentHandle = node.handle; });
      }
      const preloaded = await Promise.all(children.map(async (ch) => {
        if (ch.kind === 'directory') {
          const sub = await loadChildren(ch).catch(() => []);
          // Preserve parentHandle on grandchildren too
          if (ch.handle) {
            sub.forEach(gch => { gch.parentHandle = ch.handle; });
          }
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
  const isAutoHide = layoutMode === 'auto-hide';
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
          onChangeLayout={changeLayoutMode}
          dropdownGroup={dropdownGroup}
        />
      )}
      <div className="app-body">
        <div
          className={`sidebar-hover-group ${isAutoHide ? 'auto-hide' : ''} ${isAutoHide && sidebarOpen ? 'is-open' : ''}`}
          style={isAutoHide ? { '--sidebar-width': `${sidebarWidth}px` } : undefined}
          onMouseEnter={isAutoHide ? openSidebar : undefined}
          onMouseLeave={isAutoHide ? scheduleHide : undefined}
        >
          {isAutoHide && <div className="sidebar-hover-zone" aria-hidden />}
          <Sidebar
            items={layoutMode === 'top-left' ? sidebarItems : fileTree}
            folder={layoutMode === 'top-left' ? sidebarFolder : null}
            width={sidebarWidth}
            currentFileId={currentFileId}
            layoutMode={layoutMode}
            onChangeLayout={changeLayoutMode}
            isOpen={sidebarOpen}
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
            dropdownGroup={dropdownGroup}
          />
        </div>
        {!isAutoHide && (
          <div
            className="resizer sidebar-resizer"
            style={{ left: sidebarWidth }}
            onMouseDown={onSidebarResizeStart}
            title="拖动调整侧边栏宽度"
          />
        )}
        <ContentArea
          file={currentFile}
          gitFile={selectedGitFile}
          gitDiffData={gitDiffData}
          gitDiffLoading={gitDiffLoading}
          gitDiffError={gitDiffError}
          onCloseDiff={handleCloseDiff}
          contentMaxWidth={contentMaxWidth}
          setContentMaxWidth={setContentMaxWidth}
          onDirtyChange={handleDirtyChange}
          scrollTarget={scrollTarget}
        />
        {/* ── Collapsed trigger strip (visible when panel closed) ── */}
        <div className="right-panel-triggers">
          <div className={`right-panel-trigger-icon${activeRightPanel === 'search' ? ' active' : ''}`} onMouseEnter={() => openRightPanel('search')} title="搜索">
            <SearchIcon size={16} className="trigger-icon" />
          </div>
          {isGitRepo && (
            <div className={`right-panel-trigger-icon git${activeRightPanel === 'git' ? ' active' : ''}`} onMouseEnter={() => openRightPanel('git')} title="Git 更改">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="trigger-icon">
                <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                <path d="M4 5v6M4 8c0-2 8-2 8-4.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
              </svg>
              {gitChanges.length > 0 && (
                <span className="git-trigger-badge">{gitChanges.length}</span>
              )}
            </div>
          )}
        </div>

        {/* ── Expanded right panel (always rendered, width animates) ── */}
        <div
          className={`right-panel-slot${!activeRightPanel ? ' collapsed' : ''}`}
          style={{ width: activeRightPanel ? rightPanelWidth : 0 }}
        >
          <div
            className="resizer right-panel-resizer"
            onMouseDown={onRightPanelResizeStart}
            title="拖动调整面板宽度"
          />
          {/* Content area */}
          <div className="right-panel-content" style={{ flex: 1, minWidth: 0 }}>
            {activeRightPanel === 'search' && (
              <SearchPanel
                rootHandle={rootHandleRef.current}
                onHoverResult={handleSearchResultHover}
                onLeaveResult={handleSearchResultLeave}
              />
            )}
            {activeRightPanel === 'git' && (
              <PanelErrorBoundary>
                <GitDiffPanel
                  changes={gitChanges}
                  branch={gitBranch}
                  loading={gitLoading}
                  error={gitError}
                  onRefresh={loadGitStatus}
                  onFileClick={handleGitFileClick}
                  selectedFile={selectedGitFile}
                  onClose={closeRightPanel}
                />
              </PanelErrorBoundary>
            )}
          </div>
        </div>
      </div>
      {showClone && <CloneModal onClose={closeClone} onOpenAsSpace={handleOpenClonedSpace} />}
    </div>
  );
}
