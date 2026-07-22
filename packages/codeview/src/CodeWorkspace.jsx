import { useState, useRef, useCallback, useEffect, Component } from 'react';
import { SearchIcon } from './components/Icons';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ContentArea from './components/ContentArea';
import SearchPanel from './components/SearchPanel';
import GitDiffPanel from './components/GitDiffPanel';
import { useDropdownGroup } from './hooks/useDropdownGroup';
import { getFileType, toTreeNode, setChildrenInTree, findNodeByPath } from './provider/shared';
import './codeview.css';

const LS_SIDEBAR_W = 'cv_sidebar_width';
const LS_CONTENT_W = 'cv_content_width';
const LS_LAYOUT = 'cv_layout';
const LS_RIGHT_PANEL_W = 'cv_right_panel_width';
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

// Re-list every already-loaded directory so external changes surface
// without losing the expanded state.
async function refreshLevel(provider, dirPath, oldNodes) {
  const entries = await provider.listDir(dirPath);
  const oldByPath = new Map((oldNodes || []).map((n) => [n.path, n]));
  const result = [];
  for (const e of entries) {
    const node = toTreeNode(e);
    const old = oldByPath.get(e.path);
    if (e.kind === 'directory' && old && old.children != null) {
      node.children = await refreshLevel(provider, e.path, old.children);
    }
    result.push(node);
  }
  return result;
}

// ── Error boundary: keeps a panel render error from crashing the app ──
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('[codeview] panel render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontSize: 13, color: '#888', textAlign: 'center' }}>
          面板渲染出错
          <br />
          <button
            onClick={() => this.setState({ hasError: false })}
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

/**
 * CodeWorkspace — the reusable browse + view experience.
 *
 * All file access goes through `provider` (a FileProvider). Space
 * management, cloning and layout persistence live in the host and are
 * passed in via props / callbacks.
 *
 * Props:
 *  - provider            FileProvider (required once a space is open)
 *  - providerKey         Opaque key; changing it reloads the tree + git.
 *  - rootName            Display name of the current root.
 *  - spaces, activeSpaceId, onSwitchSpace, onSelectDirectory,
 *    onDeleteSpace, onCloneGithub, onOpenAsWorkspace  (all optional)
 *  - layoutMode / onChangeLayout  Controlled layout; falls back to
 *    internal localStorage-backed state when omitted.
 *  - panels = { search, git }     Toggle built-in right panels.
 *  - extraPanels = [{ id, title, icon, badge?, render({ revealFile }) }]
 *    Host-supplied right panels (e.g. RAG) rendered alongside the
 *    built-ins.
 */
export default function CodeWorkspace({
  provider,
  providerKey,
  rootName = null,
  spaces = [],
  activeSpaceId = null,
  onSwitchSpace,
  onSelectDirectory,
  onDeleteSpace,
  onCloneGithub,
  onOpenAsWorkspace,
  layoutMode: layoutModeProp,
  onChangeLayout,
  layoutSwitcher = true,
  panels = { search: true, git: true },
  extraPanels = [],
  loading = false,
  onDirtyChange,
  fullWidth = false,
}) {
  const key = providerKey ?? rootName ?? '';
  const fileOps = Boolean(provider?.capabilities?.fileOps);
  // Space management chrome only appears when the host actually provides it.
  const hasSpaceControls = Boolean(onSelectDirectory || onCloneGithub || (spaces && spaces.length > 0));
  const hasGit = Boolean(provider?.capabilities?.git && provider?.git);
  const hasSearch = Boolean(panels?.search && provider?.capabilities?.search);

  const [fileTree, setFileTree] = useState([]);
  const [sidebarFolderPath, setSidebarFolderPath] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);

  const fileTreeRef = useRef([]);
  fileTreeRef.current = fileTree;

  const sidebarFolder = sidebarFolderPath ? findNodeByPath(fileTree, sidebarFolderPath) : null;
  const sidebarItems = sidebarFolder?.children ?? null;

  // ── Layout mode (controlled or internal) ─────────────────
  const [internalLayout, setInternalLayout] = useState(loadLayout);
  const layoutMode = layoutModeProp ?? internalLayout;
  const changeLayoutMode = useCallback((mode) => {
    if (onChangeLayout) onChangeLayout(mode);
    else {
      setInternalLayout(mode);
      localStorage.setItem(LS_LAYOUT, mode);
    }
  }, [onChangeLayout]);

  // ── Resizable widths (persisted) ─────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(() => loadNum(LS_SIDEBAR_W, 260, SIDEBAR_MIN, SIDEBAR_MAX));
  const [contentMaxWidth, setContentMaxWidth] = useState(() => loadNum(LS_CONTENT_W, 860, CONTENT_MIN, CONTENT_MAX));
  const [rightPanelWidth, setRightPanelWidth] = useState(() => loadNum(LS_RIGHT_PANEL_W, 440, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));
  useEffect(() => { localStorage.setItem(LS_SIDEBAR_W, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem(LS_CONTENT_W, String(contentMaxWidth)); }, [contentMaxWidth]);
  useEffect(() => { localStorage.setItem(LS_RIGHT_PANEL_W, String(rightPanelWidth)); }, [rightPanelWidth]);

  // ── Right panel + git state ──────────────────────────────
  const [activeRightPanel, setActiveRightPanel] = useState(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [gitChanges, setGitChanges] = useState([]);
  const [gitBranch, setGitBranch] = useState('HEAD');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState(null);
  const [selectedGitFile, setSelectedGitFile] = useState(null);
  const [gitDiffData, setGitDiffData] = useState(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffError, setGitDiffError] = useState(null);

  const [revealPath, setRevealPath] = useState(null);
  const [scrollTarget, setScrollTarget] = useState(null); // { line, path }

  const dropdownGroup = useDropdownGroup();

  // Refs
  const currentFileIdRef = useRef(null);
  const dirtyRef = useRef(false);
  const sidebarFolderRef = useRef(null);
  const fileOpenTimerRef = useRef(null);
  const fileLeaveTimerRef = useRef(null);
  const rightPanelTimerRef = useRef(null);
  const searchFileHoverTimerRef = useRef(null);
  const isGitRepoRef = useRef(false);
  isGitRepoRef.current = isGitRepo;
  const selectedGitFileRef = useRef(null);
  selectedGitFileRef.current = selectedGitFile;
  const gitRefreshRunningRef = useRef(false);
  const gitLastRefreshRef = useRef(0);
  const treeRefreshRunningRef = useRef(false);
  const treeLastRefreshRef = useRef(0);

  const currentFileId = currentFile?.node?.id || null;

  const handleDirtyChange = useCallback((d) => { dirtyRef.current = d; onDirtyChange?.(d); }, [onDirtyChange]);

  // ── Auto-hide sidebar ────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarHideTimer = useRef(null);
  const HIDE_DELAY = 250;
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
    setSidebarOpen(layoutMode !== 'auto-hide');
  }, [layoutMode]);

  // ── Right panel open/close (debounced open) ──────────────
  const openRightPanel = useCallback((panel) => {
    clearTimeout(rightPanelTimerRef.current);
    rightPanelTimerRef.current = setTimeout(() => setActiveRightPanel(panel), 80);
  }, []);
  const closeRightPanel = useCallback(() => {
    clearTimeout(rightPanelTimerRef.current);
    setActiveRightPanel(null);
  }, []);

  // ── Git: status + diff (delegated to provider.git) ───────
  const loadGitStatus = useCallback(async () => {
    if (!provider?.git) return;
    setGitLoading(true);
    setGitError(null);
    setSelectedGitFile(null);
    setGitDiffData(null);
    try {
      const r = await provider.git.status();
      setGitChanges(r.changes || []);
      setGitBranch(r.branch || 'HEAD');
    } catch (err) {
      setGitError(err.message || String(err));
    } finally {
      setGitLoading(false);
    }
  }, [provider]);

  const handleCloseDiff = useCallback(() => {
    setSelectedGitFile(null);
    setGitDiffData(null);
  }, []);

  const fetchGitDiff = useCallback(async (fileNode) => {
    if (!provider?.git) return;
    setGitDiffLoading(true);
    setGitDiffError(null);
    try {
      const d = await provider.git.diff(fileNode.path, fileNode.status);
      if (d) setGitDiffData(d);
    } catch (err) {
      setGitDiffError(err.message || String(err));
    } finally {
      setGitDiffLoading(false);
    }
  }, [provider]);

  const handleGitFileClick = useCallback((fileNode) => {
    if (selectedGitFile?.path === fileNode.path) return;
    setSelectedGitFile(fileNode);
    fetchGitDiff(fileNode);
  }, [selectedGitFile, fetchGitDiff]);

  const refreshGitStatusQuiet = useCallback(async () => {
    if (!isGitRepoRef.current || !provider?.git) return;
    if (gitRefreshRunningRef.current) return;
    const now = Date.now();
    if (now - gitLastRefreshRef.current < 800) return;
    gitLastRefreshRef.current = now;
    gitRefreshRunningRef.current = true;
    try {
      const result = await provider.git.status();
      setGitChanges(result.changes || []);
      setGitBranch(result.branch || 'HEAD');
      const sel = selectedGitFileRef.current;
      if (sel) {
        const still = (result.changes || []).find((c) => c.path === sel.path);
        if (!still) {
          setSelectedGitFile(null);
          setGitDiffData(null);
        } else {
          const updated = still.status === sel.status ? sel : { ...sel, status: still.status };
          if (updated !== sel) setSelectedGitFile(updated);
          fetchGitDiff(updated);
        }
      }
    } catch { /* quiet */ }
    finally {
      gitRefreshRunningRef.current = false;
    }
  }, [provider, fetchGitDiff]);

  // ── Tree loading ─────────────────────────────────────────
  const reloadDirectory = useCallback(async (dirPath) => {
    if (!provider) return [];
    const entries = await provider.listDir(dirPath || '');
    const nodes = entries.map(toTreeNode);
    if (!dirPath) {
      setFileTree(nodes);
      return nodes;
    }
    setFileTree((prev) => setChildrenInTree(prev, dirPath, nodes));
    return nodes;
  }, [provider]);

  const loadChildrenForNode = useCallback(async (node) => {
    if (node.kind !== 'directory' || node.children !== null || !provider) return;
    try {
      const entries = await provider.listDir(node.path);
      const children = entries.map(toTreeNode);
      const preloaded = await Promise.all(children.map(async (ch) => {
        if (ch.kind === 'directory') {
          const sub = await provider.listDir(ch.path).catch(() => []);
          return { ...ch, children: sub.map(toTreeNode) };
        }
        return ch;
      }));
      setFileTree((prev) => (findNodeByPath(prev, node.path) ? setChildrenInTree(prev, node.path, preloaded) : prev));
    } catch (err) {
      console.error('Failed to load children:', err);
      setFileTree((prev) => setChildrenInTree(prev, node.path, []));
    }
  }, [provider]);

  const refreshFileTree = useCallback(async () => {
    if (!provider || treeRefreshRunningRef.current) return;
    const now = Date.now();
    if (now - treeLastRefreshRef.current < 800) return;
    treeLastRefreshRef.current = now;
    treeRefreshRunningRef.current = true;
    try {
      const fresh = await refreshLevel(provider, '', fileTreeRef.current);
      setFileTree(fresh);
    } catch { /* quiet */ }
    finally {
      treeRefreshRunningRef.current = false;
    }
  }, [provider]);

  // ── Open file ────────────────────────────────────────────
  const openFileNode = useCallback((fileNode) => {
    if (!fileNode || fileNode.kind !== 'file') return;
    if (dirtyRef.current) return;
    setSelectedGitFile(null);
    setGitDiffData(null);
    if (currentFileIdRef.current === fileNode.id) return;
    setCurrentFile({ node: fileNode, name: fileNode.name, path: fileNode.path, type: getFileType(fileNode.name) });
    currentFileIdRef.current = fileNode.id;
  }, []);

  const handleFileHover = useCallback((fileNode) => {
    clearTimeout(fileOpenTimerRef.current);
    clearTimeout(fileLeaveTimerRef.current);
    if (dirtyRef.current) return;
    fileOpenTimerRef.current = setTimeout(() => openFileNode(fileNode), 200);
  }, [openFileNode]);

  const handleFileLeave = useCallback((e) => {
    const related = e?.relatedTarget;
    if (related?.closest?.('.file-row')) return;
    clearTimeout(fileLeaveTimerRef.current);
    fileLeaveTimerRef.current = setTimeout(() => {
      clearTimeout(fileOpenTimerRef.current);
    }, 50);
  }, []);

  // ── Sidebar (L2) hover ───────────────────────────────────
  const handleLevel2Hover = useCallback(async (folderNode) => {
    setSidebarFolderPath(folderNode.path);
    sidebarFolderRef.current = folderNode.path;
    await loadChildrenForNode(folderNode);
  }, [loadChildrenForNode]);

  // ── Reveal a file (search hover, host citations) ─────────
  const revealFile = useCallback((target) => {
    if (!target || dirtyRef.current) return;
    const { path, name, line } = target;
    if (currentFileIdRef.current !== path) {
      const node = { id: path, name: name || path.split('/').pop(), kind: 'file', path };
      setCurrentFile({ node, name: node.name, path, type: getFileType(node.name) });
      currentFileIdRef.current = path;
      const segments = path.split('/');
      if (segments.length >= 2 && layoutMode === 'top-left') {
        const l2 = fileTreeRef.current.find((n) => n.path === segments[0]);
        if (l2) handleLevel2Hover(l2);
      }
      setRevealPath(path);
    }
    if (line) setScrollTarget({ line, path });
  }, [layoutMode, handleLevel2Hover]);

  const handleSearchResultHover = useCallback((result, match) => {
    if (dirtyRef.current) return;
    clearTimeout(searchFileHoverTimerRef.current);
    searchFileHoverTimerRef.current = setTimeout(() => {
      revealFile({ path: result.path, name: result.name, line: match.lineNum });
    }, 200);
  }, [revealFile]);

  const handleSearchResultLeave = useCallback(() => {
    clearTimeout(searchFileHoverTimerRef.current);
  }, []);

  // ── File operations (via provider, when supported) ───────
  const handleDeleteEntry = useCallback(async (node) => {
    if (!node || !provider?.deleteEntry) return;
    try {
      await provider.deleteEntry(node.path, node.kind);
      if (node.kind === 'file' && currentFileIdRef.current === node.id) {
        setCurrentFile(null);
        currentFileIdRef.current = null;
        dirtyRef.current = false;
      }
      const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
      await reloadDirectory(parentPath);
    } catch (err) {
      alert(`删除失败：\n${err.message}`);
    }
  }, [provider, reloadDirectory]);

  const handleCreateFile = useCallback(async (dirNode, name) => {
    if (!dirNode || dirNode.kind !== 'directory' || !name || !provider?.createFile) return;
    if (/[\\/]/.test(name)) { alert('文件名不能包含路径分隔符'); return; }
    if (dirNode.children?.some((c) => c.name === name)) { alert(`文件「${name}」已存在`); return; }
    try {
      const parentPath = dirNode.path ?? '';
      await provider.createFile(parentPath, name);
      const filePath = parentPath ? `${parentPath}/${name}` : name;
      const children = await reloadDirectory(parentPath);
      const newNode = children.find((c) => c.path === filePath);
      if (newNode && newNode.kind === 'file') openFileNode(newNode);
    } catch (err) {
      alert(`创建失败：\n${err.message}`);
    }
  }, [provider, reloadDirectory, openFileNode]);

  const handleCreateFolder = useCallback(async (dirNode, name) => {
    if (!dirNode || dirNode.kind !== 'directory' || !name || !provider?.createDir) return;
    if (/[\\/]/.test(name)) { alert('文件夹名不能包含路径分隔符'); return; }
    if (dirNode.children?.some((c) => c.name === name)) { alert(`文件夹「${name}」已存在`); return; }
    try {
      await provider.createDir(dirNode.path ?? '', name);
      await reloadDirectory(dirNode.path ?? '');
    } catch (err) {
      alert(`创建失败：\n${err.message}`);
    }
  }, [provider, reloadDirectory]);

  const handleRenameEntry = useCallback(async (node, newName) => {
    if (!node || !newName || newName === node.name || !provider?.renameEntry) return;
    if (/[\\/]/.test(newName)) { alert('名称不能包含路径分隔符'); return; }
    try {
      await provider.renameEntry(node.path, newName, node.kind);
      const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      const children = await reloadDirectory(parentPath);
      if (node.kind === 'file' && currentFileIdRef.current === node.id) {
        const newNode = children.find((c) => c.path === newPath);
        if (newNode && newNode.kind === 'file') openFileNode(newNode);
      }
    } catch (err) {
      alert(`重命名失败：\n${err.message}`);
    }
  }, [provider, reloadDirectory, openFileNode]);

  // ── Load tree + detect git whenever the provider/space changes ──
  useEffect(() => {
    let cancelled = false;
    setCurrentFile(null);
    currentFileIdRef.current = null;
    setSidebarFolderPath(null);
    sidebarFolderRef.current = null;
    dirtyRef.current = false;
    setFileTree([]);
    setRevealPath(null);
    setScrollTarget(null);
    // Reset git
    setIsGitRepo(false);
    setGitChanges([]);
    setSelectedGitFile(null);
    setGitDiffData(null);
    setActiveRightPanel((p) => (p === 'git' ? null : p));

    if (!provider) return;
    (async () => {
      try {
        const entries = await provider.listDir('');
        if (!cancelled) setFileTree(entries.map(toTreeNode));
      } catch {
        if (!cancelled) setFileTree([]);
      }
      if (!cancelled && provider.capabilities?.git && provider.git) {
        setIsGitRepo(true);
        loadGitStatus();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, key]);

  // Auto-refresh git when the git panel opens
  useEffect(() => {
    if (activeRightPanel === 'git' && isGitRepo) refreshGitStatusQuiet();
  }, [activeRightPanel, isGitRepo, refreshGitStatusQuiet]);

  // Auto-refresh git + tree on window/tab focus
  useEffect(() => {
    const onFocus = () => { refreshGitStatusQuiet(); refreshFileTree(); };
    const onVisible = () => { if (!document.hidden) { refreshGitStatusQuiet(); refreshFileTree(); } };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshGitStatusQuiet, refreshFileTree]);

  // ── Resizers ─────────────────────────────────────────────
  const onSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX))));
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

  const onRightPanelResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightPanelWidth;
    const onMove = (ev) => setRightPanelWidth(Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, startW - (ev.clientX - startX))));
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

  // ── Render ───────────────────────────────────────────────
  const isAutoHide = layoutMode === 'auto-hide';
  const showGitTrigger = Boolean(panels?.git) && isGitRepo;
  const hasAnyRightPanel = hasSearch || (extraPanels && extraPanels.length > 0) || showGitTrigger;

  return (
    <div className="cv-root app">
      {layoutMode === 'top-left' && (
        <TopBar
          rootName={rootName}
          level1Items={fileTree}
          loading={loading}
          currentFileId={currentFileId}
          recentSpaces={spaces}
          activeSpaceId={activeSpaceId}
          onSelectDirectory={onSelectDirectory}
          onFileHover={handleFileHover}
          onFileLeave={handleFileLeave}
          onLevel2Hover={handleLevel2Hover}
          onSwitchSpace={onSwitchSpace}
          onDeleteSpace={onDeleteSpace}
          onCloneGithub={onCloneGithub}
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
            recentSpaces={spaces}
            activeSpaceId={activeSpaceId}
            onSelectDirectory={onSelectDirectory}
            onSwitchSpace={onSwitchSpace}
            onDeleteSpace={onDeleteSpace}
            onCloneGithub={onCloneGithub}
            onFileHover={handleFileHover}
            onFileLeave={handleFileLeave}
            onDeleteEntry={fileOps ? handleDeleteEntry : undefined}
            onCreateFile={fileOps ? handleCreateFile : undefined}
            onCreateFolder={fileOps ? handleCreateFolder : undefined}
            onRenameEntry={fileOps ? handleRenameEntry : undefined}
            onLoadChildren={loadChildrenForNode}
            onOpenAsWorkspace={onOpenAsWorkspace}
            revealPath={revealPath}
            dropdownGroup={dropdownGroup}
            showActions={fileOps}
            showLayoutToggle={layoutSwitcher}
            showSpaceSelector={hasSpaceControls}
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
          provider={provider}
          gitFile={selectedGitFile}
          gitDiffData={gitDiffData}
          gitDiffLoading={gitDiffLoading}
          gitDiffError={gitDiffError}
          onCloseDiff={handleCloseDiff}
          contentMaxWidth={contentMaxWidth}
          setContentMaxWidth={setContentMaxWidth}
          onDirtyChange={handleDirtyChange}
          scrollTarget={scrollTarget}
          fullWidth={fullWidth}
        />

        {hasAnyRightPanel && (
          <>
            <div className="right-panel-triggers">
              {hasSearch && (
                <div
                  className={`right-panel-trigger-icon${activeRightPanel === 'search' ? ' active' : ''}`}
                  onMouseEnter={() => openRightPanel('search')}
                  title="搜索"
                >
                  <SearchIcon size={16} className="trigger-icon" />
                </div>
              )}
              {extraPanels.map((p) => (
                <div
                  key={p.id}
                  className={`right-panel-trigger-icon${activeRightPanel === p.id ? ' active' : ''}`}
                  onMouseEnter={() => openRightPanel(p.id)}
                  title={p.title}
                >
                  <span className="trigger-icon">{p.icon}</span>
                </div>
              ))}
              {showGitTrigger && (
                <div
                  className={`right-panel-trigger-icon git${activeRightPanel === 'git' ? ' active' : ''}`}
                  onMouseEnter={() => openRightPanel('git')}
                  title="Git 更改"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="trigger-icon">
                    <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                    <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                    <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.1" />
                    <path d="M4 5v6M4 8c0-2 8-2 8-4.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
                  </svg>
                  {gitChanges.length > 0 && <span className="git-trigger-badge">{gitChanges.length}</span>}
                </div>
              )}
            </div>

            <div
              className={`right-panel-slot${!activeRightPanel ? ' collapsed' : ''}`}
              style={{ width: activeRightPanel ? rightPanelWidth : 0 }}
            >
              <div
                className="resizer right-panel-resizer"
                onMouseDown={onRightPanelResizeStart}
                title="拖动调整面板宽度"
              />
              <div className="right-panel-content" style={{ flex: 1, minWidth: 0 }}>
                {activeRightPanel === 'search' && hasSearch && (
                  <SearchPanel
                    provider={provider}
                    onHoverResult={handleSearchResultHover}
                    onLeaveResult={handleSearchResultLeave}
                  />
                )}
                {extraPanels.map((p) => (
                  activeRightPanel === p.id ? (
                    <PanelErrorBoundary key={p.id}>
                      {p.render({ revealFile })}
                    </PanelErrorBoundary>
                  ) : null
                ))}
                {activeRightPanel === 'git' && showGitTrigger && (
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
          </>
        )}
      </div>
    </div>
  );
}
