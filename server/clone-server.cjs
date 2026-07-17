/**
 * clone-server.cjs — lightweight HTTP server for git clone operations.
 *
 * Endpoints:
 *   GET  /api/health       — check git installation
 *   GET  /api/clone        — SSE stream: clone a repo with live progress
 *        query: repo=<owner/name or url>  dest=<absolute path>
 *   POST /api/pick-folder  — native folder picker (macOS osascript), returns { path }
 *
 * No external dependencies — pure Node.js built-ins.
 * Designed to be started automatically by the Vite dev plugin.
 */

const http = require('http');
const https = require('https');
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const rag = require('./rag-engine.cjs');

// ── Constants ─────────────────────────────────────────────

const PORT = 5181;
const CLONE_TIMEOUT = 10 * 60 * 1000;
const MAX_BUFFER = 10 * 1024 * 1024;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Allow a public HTTPS page (e.g. GitHub Pages / siplgo.xyz) to reach this
  // loopback server. Chrome's Private Network Access blocks public→local
  // requests unless the preflight response carries this header.
  'Access-Control-Allow-Private-Network': 'true',
};

// Error patterns — shared logic with client-side parseErrorFromLog in src/utils/clone.js
const ERROR_PATTERNS = [
  [/repository not found|not found$/i, '仓库不存在或无访问权限', '请检查仓库名称，私有仓库需使用 Token 认证'],
  [/permission denied \(publickey\)/i, 'SSH 密钥认证失败', '请配置 SSH Key，或改用 HTTPS + Token 方式克隆'],
  [/could not read username|authentication failed|terminal prompts disabled/i, '需要身份认证', '私有仓库请使用 Token：https://<token>@github.com/owner/repo.git'],
  [/already exists and is not an empty directory/i, '目标目录已存在且非空', '请选择一个空目录或更换路径'],
  [/could not resolve host|unable to access/i, '无法连接到 GitHub', '请检查网络连接或代理设置'],
  [/eacces|permission denied/i, '没有目标目录的写入权限', '请选择一个有权限的目录，或更换克隆位置'],
  [/operation not permitted/i, '系统拒绝了操作（macOS 权限限制）', '请在系统设置 → 隐私与安全性 → 完全磁盘访问权限 中添加终端/Node'],
  [/could not create leading directories/i, '无法创建目标目录', '路径无效或没有写入权限，请重新选择'],
];

function matchError(text) {
  for (const [re, message, suggestion] of ERROR_PATTERNS) {
    if (re.test(text)) return { message, suggestion };
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

function normaliseRepo(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (s.startsWith('git@')) return s;
  if (/^https?:\/\//.test(s)) return s.endsWith('.git') ? s : s + '.git';
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}.git`;
  return s;
}

function resolveDestPath(raw) {
  let dest = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
  dest = path.resolve(dest);
  const parent = path.dirname(dest);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    try { fs.mkdirSync(parent, { recursive: true }); }
    catch { return null; }
  }
  return dest;
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Route handlers ────────────────────────────────────────

function handleHealth(res) {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf-8', timeout: 3000 });
    sendJSON(res, 200, { ok: true, git: out.trim() });
  } catch {
    sendJSON(res, 200, { ok: false, error: 'git 未安装或不在 PATH 中' });
  }
}

/** Throttled SseWriteHelper: debounce percentage progress lines to 1 per 200ms. */
function createProgressSender(res) {
  let lastPct = '';
  let pending = null;
  let timer = null;
  return function sendProgress(text) {
    // Percentage lines like "Receiving objects:  45% (123/456)" — throttle
    const m = text.match(/^(\w+ objects?:\s+\d+%)/);
    if (m) {
      if (m[1] === lastPct) return; // same percentage, skip
      if (timer) return; // still waiting for next throttle window
      pending = text;
      timer = setTimeout(() => {
        lastPct = m[1];
        sseWrite(res, 'progress', { text: pending + '\n' });
        pending = null;
        timer = null;
      }, 200);
      return;
    }
    // Non-percentage line — flush immediately
    sseWrite(res, 'progress', { text: text + '\n' });
  };
}

function handleClone(req, res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const repo = normaliseRepo(params.get('repo'));
  const destRaw = params.get('dest');

  if (!repo || !destRaw) {
    sendJSON(res, 400, { error: '缺少 repo 或 dest 参数' });
    return;
  }

  const dest = resolveDestPath(destRaw);
  if (!dest) {
    sendJSON(res, 400, { error: '目标路径无效或不可写', suggestion: '请选择一个有效的目录' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...CORS_HEADERS,
  });

  sseWrite(res, 'progress', { text: `正在克隆 ${repo} → ${dest}\n` });
  const sendProgress = createProgressSender(res);

  let stderrBuf = '';

  const child = spawn('git', ['clone', '--progress', repo, dest], {
    timeout: CLONE_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });

  child.stderr.on('data', (d) => {
    const text = d.toString();
    stderrBuf += text;
    const lines = text.split(/[\r\n]/).filter((l) => l.trim());
    for (const line of lines) sendProgress(line);
  });

  child.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) sendProgress(text);
  });

  child.on('error', (err) => {
    sseWrite(res, 'error', err.code === 'ENOENT'
      ? { message: '未安装 git', suggestion: '请先安装 Git：https://git-scm.com/downloads' }
      : { message: '克隆失败', suggestion: err.message });
    res.end();
  });

  child.on('close', (code) => {
    if (code === 0) {
      sseWrite(res, 'done', { path: dest });
    } else {
      const parsed = matchError(stderrBuf);
      if (parsed) {
        sseWrite(res, 'error', parsed);
      } else {
        const lastLine = stderrBuf.split(/[\r\n]/).filter(l => l.trim()).pop() || '';
        sseWrite(res, 'error', {
          message: `克隆失败（退出码 ${code}）`,
          suggestion: lastLine.trim() || '请查看上方日志了解详情',
        });
      }
    }
    res.end();
  });

  req.on('close', () => child.kill('SIGTERM'));
}

async function handlePickFolder(res) {
  const p = os.platform();
  const opts = { timeout: 60_000 };

  if (p === 'darwin') {
    // Default to /Volumes/z for folder picker
    const script = 'POSIX path of (choose folder default location (POSIX file "/Volumes/z"))';
    execFile('osascript', ['-e', script], opts, (err, stdout, stderr) => {
      if (err) {
        sendJSON(res, 200, (err.code === 1 || /cancel/i.test(stderr)) ? { cancelled: true } : { error: '无法打开文件夹选择器' });
        return;
      }
      sendJSON(res, 200, { path: stdout.trim().replace(/\/$/, '') });
    });
    return;
  }

  if (p === 'win32') {
    const ps = 'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }';
    execFile('powershell', ['-NoProfile', '-Command', ps], opts, (err, stdout) => {
      if (err) { sendJSON(res, 500, { error: '无法打开文件夹选择器' }); return; }
      const out = stdout.trim();
      sendJSON(res, 200, out ? { path: out } : { cancelled: true });
    });
    return;
  }

  // Linux
  execFile('zenity', ['--file-selection', '--directory'], opts, (_err, stdout) => {
    const out = stdout.trim();
    sendJSON(res, 200, out ? { path: out } : { cancelled: true });
  });
}

// ── Server ────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = req.url || '/';

  try {
    if (url.startsWith('/api/health') && req.method === 'GET') return handleHealth(res);
    if (url.startsWith('/api/clone') && req.method === 'GET') return handleClone(req, res, url);
    if (url.startsWith('/api/pick-folder') && req.method === 'POST') return handlePickFolder(res);
    if (url.startsWith('/api/search-github') && req.method === 'GET') return handleSearchGithub(req, res, url);
    if (url.startsWith('/api/read-tree') && req.method === 'GET') return handleReadTree(res, url);
    if (url.startsWith('/api/read-file') && req.method === 'GET') return handleReadFile(res, url);
    if (url.startsWith('/api/git-status') && req.method === 'GET') return handleGitStatus(res, url);
    if (url.startsWith('/api/git-diff') && req.method === 'GET') return handleGitDiff(res, url);
    if (url.startsWith('/api/rag/index') && req.method === 'POST') return rag.handleIndex(req, res);
    if (url.startsWith('/api/rag/query') && req.method === 'POST') return rag.handleQuery(req, res);
    if (url.startsWith('/api/rag/status') && req.method === 'GET') return rag.handleStatus(res, url);
    if (url.startsWith('/api/rag/clear') && req.method === 'POST') return rag.handleClear(req, res);
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[clone-server] unhandled:', err);
    sendJSON(res, 500, { error: '服务器内部错误' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[clone-server] port ${PORT} in use — assuming another instance`);
  } else {
    console.error('[clone-server] error:', err.message);
  }
});

function shutdown() { server.close(); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`[clone-server] http://localhost:${PORT}`));
/** GET /api/search-github?q=<query> — proxy GitHub repository search. */
function handleSearchGithub(req, res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const q = (params.get('q') || '').trim();
  if (!q || q.length < 2) {
    sendJSON(res, 200, { items: [] });
    return;
  }

  // GitHub Search API — public rate limit: 10 req/min, authenticated: 30 req/min
  const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=8`;
  const ghReq = https.get(apiUrl, {
    headers: { 'User-Agent': 'notesview', 'Accept': 'application/vnd.github.v3+json' },
    timeout: 8000,
  }, (ghRes) => {
    let body = '';
    ghRes.on('data', (d) => body += d);
    ghRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        const items = (data.items || []).map((item) => ({
          full_name: item.full_name,
          description: item.description,
          stars: item.stargazers_count,
          language: item.language,
          url: item.html_url,
        }));
        sendJSON(res, 200, { items });
      } catch {
        sendJSON(res, 200, { items: [] });
      }
    });
  });

  ghReq.on('error', () => sendJSON(res, 200, { items: [] }));
  ghReq.on('timeout', () => { ghReq.destroy(); sendJSON(res, 200, { items: [] }); });
}

/** GET /api/read-tree?path=<absPath> — read one level of a directory.
 *  Returns { name, children: [{ name, kind, path }] }.
 *  Used by the "open cloned repo as space" feature to bypass the
 *  File System Access API folder picker.
 */
function handleReadTree(res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const dirPath = params.get('path');
  if (!dirPath) {
    sendJSON(res, 400, { error: '缺少 path 参数' });
    return;
  }

  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      sendJSON(res, 400, { error: '路径不是目录' });
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const children = entries
      .filter((e) => !(e.isDirectory() && e.name === '.git'))
      .map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? 'directory' : 'file',
        path: path.join(dirPath, e.name),
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      });

    sendJSON(res, 200, { name: path.basename(dirPath), children });
  } catch (err) {
    sendJSON(res, 400, { error: `无法读取目录: ${err.message}` });
  }
}

/** GET /api/read-file?path=<absPath> — stream a file's raw bytes.
 *  Used by getFileObject() for server-backed spaces (cloned repos).
 */
function handleReadFile(res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const filePath = params.get('path');
  if (!filePath) {
    sendJSON(res, 400, { error: '缺少 path 参数' });
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      sendJSON(res, 400, { error: '路径不是文件' });
      return;
    }
    if (stat.size > 50 * 1024 * 1024) {
      sendJSON(res, 400, { error: '文件过大（超过 50MB）' });
      return;
    }

    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
      ...CORS_HEADERS,
    });
    res.end(data);
  } catch (err) {
    sendJSON(res, 400, { error: `无法读取文件: ${err.message}` });
  }
}

// ============================================================
// Git endpoints — used by server-backed (cloned repo) spaces
// ============================================================

/** Run a git command in `repoPath` and return { stdout, stderr, code }. */
function runGit(repoPath, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ stdout: stdout || '', stderr: stderr || err.message, code: err.code || 1 });
      } else {
        resolve({ stdout, stderr, code: 0 });
      }
    });
  });
}

/** GET /api/git-status?path=<absPath>
 *  Returns { isRepo, branch, changes: [{ path, status }] }
 *  Uses `git status --porcelain=v1` for the change list.
 */
async function handleGitStatus(res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const repoPath = params.get('path');
  if (!repoPath) { sendJSON(res, 400, { error: '缺少 path 参数' }); return; }

  // Verify it's a directory
  try {
    if (!fs.statSync(repoPath).isDirectory()) {
      sendJSON(res, 400, { error: '路径不是目录' });
      return;
    }
  } catch {
    sendJSON(res, 400, { error: '路径不存在' });
    return;
  }

  // Check if it's a git repo
  const revParse = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (revParse.code !== 0 || revParse.stdout.trim() !== 'true') {
    sendJSON(res, 200, { isRepo: false, branch: null, changes: [] });
    return;
  }

  // Get branch name
  const branchRes = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : 'HEAD';

  // Get porcelain status (--no-renames avoids -z rename parsing complexity)
  const statusRes = await runGit(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  if (statusRes.code !== 0) {
    sendJSON(res, 200, { isRepo: true, branch, changes: [] });
    return;
  }

  // Parse porcelain -z output (null-separated entries)
  // Each entry: "XY filename" — with --no-renames, renames show as D + A pairs
  const changes = [];
  const entries = statusRes.stdout.split('\0').filter((e) => e.length > 0);
  for (let entry of entries) {
    if (entry.length < 3) continue;
    const x = entry[0]; // staged status
    const y = entry[1]; // workdir status
    let filename = entry.slice(3);

    // Strip surrounding quotes (git quotes filenames with special chars)
    if (filename.startsWith('"') && filename.endsWith('"')) {
      filename = filename.slice(1, -1);
    }

    // Determine status
    let status;
    const combined = x + y;
    if (y === '?' || combined === '??') status = 'added';
    else if (y === 'D' || x === 'D') status = 'deleted';
    else if (x === 'A' || x === '?') status = 'added';
    else status = 'modified';

    changes.push({ path: filename, status });
  }

  sendJSON(res, 200, { isRepo: true, branch, changes });
}

/** GET /api/git-diff?path=<absPath>&file=<relPath>
 *  Returns { oldText, newText } for a single file.
 *  - oldText: the HEAD version (via `git show HEAD:file`)
 *  - newText: the working-tree version (read from disk)
 */
async function handleGitDiff(res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const repoPath = params.get('path');
  const file = params.get('file');
  if (!repoPath || !file) {
    sendJSON(res, 400, { error: '缺少 path 或 file 参数' });
    return;
  }

  // Security: prevent path traversal outside the repo
  const absFile = path.resolve(repoPath, file);
  if (!absFile.startsWith(path.resolve(repoPath))) {
    sendJSON(res, 400, { error: '路径越界' });
    return;
  }

  let oldText = '';
  let newText = '';

  // Read HEAD version (may fail for new/untracked files)
  const showRes = await runGit(repoPath, ['show', `HEAD:${file}`]);
  if (showRes.code === 0) {
    oldText = showRes.stdout;
  }

  // Read working-tree version (may not exist for deleted files)
  try {
    const stat = fs.statSync(absFile);
    if (stat.isFile() && stat.size <= 512 * 1024) {
      newText = fs.readFileSync(absFile, 'utf-8');
    } else if (stat.size > 512 * 1024) {
      newText = '(文件过大，已跳过)';
    }
  } catch {
    // File doesn't exist (deleted) — newText stays empty
  }

  sendJSON(res, 200, { oldText, newText });
}
