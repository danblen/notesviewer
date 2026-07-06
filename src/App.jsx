import { useState, useRef, useCallback } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ContentArea from './components/ContentArea';
import { selectAndBuildTree, getFileType } from './utils/fileSystem';

export default function App() {
  const [rootName, setRootName] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [sidebarItems, setSidebarItems] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [loading, setLoading] = useState(false);

  // Debounce timer for hover-to-open
  const fileOpenTimerRef = useRef(null);
  const currentFileIdRef = useRef(null);

  // ── Directory selection (the ONLY click action) ──────────
  const handleSelectDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const { tree, name } = await selectAndBuildTree();
      setRootName(name);
      setFileTree(tree);
      setSidebarItems(null);
      setCurrentFile(null);
      currentFileIdRef.current = null;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to select directory:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Open file ────────────────────────────────────────────
  const openFile = useCallback((fileNode) => {
    if (!fileNode || fileNode.kind !== 'file') return;
    if (currentFileIdRef.current === fileNode.id) return; // already open

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

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="app">
      <TopBar
        rootName={rootName}
        level1Items={fileTree}
        loading={loading}
        onSelectDirectory={handleSelectDirectory}
        onFileHover={handleFileHover}
        onFileLeave={handleFileLeave}
        onLevel2Hover={handleLevel2Hover}
      />
      <div className="app-body">
        <Sidebar
          items={sidebarItems}
          onFileHover={handleFileHover}
          onFileLeave={handleFileLeave}
        />
        <ContentArea file={currentFile} />
      </div>
    </div>
  );
}
