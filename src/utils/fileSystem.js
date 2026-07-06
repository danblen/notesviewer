/**
 * File system utilities — supports File System Access API (Chrome/Edge)
 * with a webkitdirectory fallback for Safari/Firefox.
 */

// ── File type detection ──────────────────────────────────────────

export function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdx'].includes(ext)) return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (['txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'html', 'xml', 'yml', 'yaml', 'toml', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'sh', 'sql', 'log', 'csv'].includes(ext)) return 'text';
  return 'other';
}

// ── Sorting ──────────────────────────────────────────────────────

export function sortTreeNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });
}

// ── Tree node factory ────────────────────────────────────────────

function makeNode(name, kind, path, handle, file) {
  return {
    id: path,
    name,
    kind, // 'file' | 'directory'
    path,
    handle: handle ?? null,
    file: file ?? null,
    children: kind === 'directory' ? [] : null,
  };
}

// ── FSA API: verify permission ───────────────────────────────────

async function verifyPermission(dirHandle) {
  const opts = { mode: 'read' };
  // Check if we already have permission
  if ((await dirHandle.queryPermission(opts)) === 'granted') return true;
  // Request permission if not
  if ((await dirHandle.requestPermission(opts)) === 'granted') return true;
  return false;
}

// ── FSA API: recursive tree builder ──────────────────────────────

async function buildTreeFSA(dirHandle, basePath = '') {
  const children = [];
  for await (const entry of dirHandle.values()) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    const node = makeNode(entry.name, entry.kind, path, entry);
    if (entry.kind === 'directory') {
      node.children = await buildTreeFSA(entry, path);
    }
    children.push(node);
  }
  return sortTreeNodes(children);
}

// ── Fallback: build tree from FileList (webkitdirectory) ─────────

function buildTreeFromFiles(files, rootName) {
  const root = makeNode(rootName, 'directory', '', null);
  const dirMap = new Map();
  dirMap.set('', root);

  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    // parts[0] = rootName, skip it
    let currentPath = '';
    let currentDir = root;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = currentPath ? `${currentPath}/${part}` : part;

      if (i === parts.length - 1) {
        // file
        currentDir.children.push(makeNode(part, 'file', fullPath, null, file));
      } else {
        // directory
        if (!dirMap.has(fullPath)) {
          const dirNode = makeNode(part, 'directory', fullPath, null);
          dirMap.set(fullPath, dirNode);
          currentDir.children.push(dirNode);
        }
        currentDir = dirMap.get(fullPath);
        currentPath = fullPath;
      }
    }
  }

  // sort recursively
  (function sortRecursive(node) {
    if (node.children) {
      node.children = sortTreeNodes(node.children);
      node.children.forEach(sortRecursive);
    }
  })(root);

  return root.children;
}

// ── Public: select directory and build tree ─────────────────────

export function isFsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function selectAndBuildTree() {
  if (isFsaSupported()) {
    const handle = await window.showDirectoryPicker();
    // Verify read permission before building the tree
    const hasPermission = await verifyPermission(handle);
    if (!hasPermission) {
      throw new Error('未获得目录读取权限');
    }
    const tree = await buildTreeFSA(handle);
    return { handle, tree, name: handle.name };
  }

  // Fallback
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('multiple', '');

    input.onchange = (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        reject(new Error('No directory selected'));
        return;
      }
      const rootName = files[0].webkitRelativePath.split('/')[0];
      const tree = buildTreeFromFiles(files, rootName);
      resolve({ handle: null, tree, name: rootName });
    };

    // If user cancels, the onchange never fires — nothing we can do.
    input.click();
  });
}

// ── Public: get a File object from a tree node ───────────────────

export async function getFileObject(fileNode) {
  if (!fileNode) throw new Error('Invalid file node');

  // FSA API path: handle is a FileSystemFileHandle
  if (fileNode.handle) {
    // For FSA file handles, getFile() returns the File object
    const file = await fileNode.handle.getFile();
    return file;
  }

  // Fallback path: file is already a File object
  if (fileNode.file) {
    return fileNode.file;
  }

  throw new Error('File not accessible: no handle or file object');
}
