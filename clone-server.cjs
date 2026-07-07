/**
 * clone-server.cjs — lightweight HTTP server for git clone operations.
 *
 * Endpoints:
 *   GET  /api/health        — check git installation
 *   GET  /api/clone         — SSE stream: clone a repo with live progress
 *        query: repo=<owner/name or url>  dest=<absolute path>
 *   POST /api/pick-folder   — native folder picker (macOS osascript), returns { path }
 *
 * No external dependencies — pure Node.js built-ins.
 * Designed to be started automatically by the Vite dev plugin.
 */

const http = require('http');
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 5181;

// ── Helpers ───────────────────────────────────────────────

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { resolve({}); }
    });
  });
}

/** Normalise user input into a full git clone URL. */
function normaliseRepo(input) {
  const s = (input || '').trim();
  if (!s) return null;
  // Already a full SSH URL
  if (s.startsWith('git@')) return s;
  // Already a full HTTP(S) URL
  if (/^https?:\/\//.test(s)) return s.endsWith('.git') ? s : s + '.git';
  // "owner/name" shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}.git`;
  // Anything else — return as-is and let git decide
  return s;
}

/**
 * Parse git clone stderr/stdout into a friendly error object.
 * Returns { message, suggestion } or null if not a recognised pattern.
 */
function parseCloneError(text) {
  const t = text.toLowerCase();
  if (/repository not found|not found/i.test(text))
    return { message: '仓库不存在或无访问权限', suggestion: '请检查仓库名称，私有仓库需使用 Token 认证' };
  if (/permission denied \(publickey\)/i.test(text))
    return { message: 'SSH 密钥认证失败', suggestion: '请配置 SSH Key，或改用 HTTPS + Token 方式克隆' };
  if (/could not read username|authentication failed|terminal prompts disabled/i.test(text))
    return { message: '需要身份认证', suggestion: '私有仓库请使用 Token：https://<token>@github.com/owner/repo.git' };
  if (/already exists and is not an empty directory/i.test(text))
    return { message: '目标目录已存在且非空', suggestion: '请选择一个空目录或更换路径' };
  if (/could not resolve host|unable to access/i.test(text))
    return { message: '无法连接到 GitHub', suggestion: '请检查网络连接或代理设置' };
  if (/eacces|permission denied/i.test(text) && !/publickey/.test(t))
    return { message: '没有目标目录的写入权限', suggestion: '请选择一个有权限的目录，或更换克隆位置' };
  if (/operation not permitted/i.test(text))
    return { message: '系统拒绝了操作（macOS 权限限制）', suggestion: '请在系统设置 → 隐私与安全性 → 完全磁盘访问权限 中添加终端/Node，或在终端中手动运行 git clone' };
  if (/could not create leading directories/i.test(text))
    return { message: '无法创建目标目录', suggestion: '路径无效或没有写入权限，请重新选择' };
  return null;
}

// ── Route handlers ────────────────────────────────────────

/** GET /api/health — verify git is available. */
function handleHealth(res) {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf-8', timeout: 3000 });
    sendJSON(res, 200, { ok: true, git: out.trim() });
  } catch {
    sendJSON(res, 200, { ok: false, error: 'git 未安装或不在 PATH 中' });
  }
}

/**
 * GET /api/clone — SSE stream that runs `git clone --progress`.
 * Events:
 *   { type: 'progress', text }
 *   { type: 'done', path }
 *   { type: 'error', message, suggestion }
 */
function handleClone(req, res, url) {
  const params = new URL(url, 'http://localhost').searchParams;
  const repoRaw = params.get('repo');
  const dest = params.get('dest');

  const repo = normaliseRepo(repoRaw);

  if (!repo || !dest) {
    sendJSON(res, 400, { error: '缺少 repo 或 dest 参数' });
    return;
  }

  // Basic dest validation — must be an absolute-ish path and parent must exist
  const destResolved = path.resolve(dest);
  const parent = path.dirname(destResolved);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    sendJSON(res, 400, {
      error: '目标路径的父目录不存在或不可写',
      suggestion: '请选择一个有效的目录',
    });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  send({ type: 'progress', text: `正在克隆 ${repo} → ${destResolved}\n` });

  // Buffer stderr so we can parse a friendly error on failure
  let stderrBuf = '';

  const child = execFile('git', [
    'clone', '--progress', repo, destResolved,
  ], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10 * 60 * 1000, // 10 min hard cap
  });

  child.stderr.on('data', (d) => {
    const text = d.toString();
    stderrBuf += text;
    // Split on \r and \n, filter out noisy percentage progress lines
    const lines = text.split(/[\r\n]/).filter((l) => {
      const t = l.trim();
      if (!t) return false;
      // Skip pure percentage updates like "Receiving objects: 45% (6/13)"
      if (/^(Receiving objects|Resolving deltas|Compressing objects|Counting objects):\s+\d+%/.test(t)) return false;
      // Skip empty percentage-only lines
      if (/^\d+%\s*$/.test(t)) return false;
      return true;
    });
    if (lines.length) send({ type: 'progress', text: lines.join('\n') + '\n' });
  });

  child.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) send({ type: 'progress', text: text + '\n' });
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      send({ type: 'error', message: '未安装 git', suggestion: '请先安装 Git：https://git-scm.com/downloads' });
    } else {
      send({ type: 'error', message: '克隆失败', suggestion: err.message });
    }
    res.end();
  });

  child.on('close', (code) => {
    if (code === 0) {
      send({ type: 'done', path: destResolved });
    } else {
      // Parse the buffered stderr for a friendly error message
      const parsed = parseCloneError(stderrBuf);
      if (parsed) {
        send({ type: 'error', message: parsed.message, suggestion: parsed.suggestion });
      } else {
        // Extract the last meaningful line from stderr as a fallback
        const lastLine = stderrBuf.split(/[\r\n]/).filter(l => l.trim()).pop() || '';
        send({
          type: 'error',
          message: `克隆失败（退出码 ${code}）`,
          suggestion: lastLine.trim() || '请查看上方日志了解详情',
        });
      }
    }
    res.end();
  });

  // Clean up if client disconnects
  req.on('close', () => {
    child.kill('SIGTERM');
  });
}

/**
 * POST /api/pick-folder — open native folder picker.
 * macOS: osascript. Returns { path } or { error }.
 */
async function handlePickFolder(res) {
  const platform = os.platform();

  if (platform === 'darwin') {
    execFile('osascript', ['-e', 'POSIX path of (choose folder)'], (err, stdout, stderr) => {
      if (err) {
        // User cancelled (exit code 1) or other error
        if (err.code === 1 || /user canceled|cancelled/i.test(stderr)) {
          sendJSON(res, 200, { cancelled: true });
        } else {
          sendJSON(res, 500, { error: '无法打开文件夹选择器' });
        }
        return;
      }
      const folderPath = stdout.trim().replace(/\/$/, '');
      sendJSON(res, 200, { path: folderPath });
    });
  } else if (platform === 'win32') {
    // PowerShell FolderBrowserDialog
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }`;
    execFile('powershell', ['-NoProfile', '-Command', ps], (err, stdout) => {
      if (err) { sendJSON(res, 500, { error: '无法打开文件夹选择器' }); return; }
      const p = stdout.trim();
      if (p) sendJSON(res, 200, { path: p });
      else sendJSON(res, 200, { cancelled: true });
    });
  } else {
    // Linux: try zenity, fall back to error
    execFile('zenity', ['--file-selection', '--directory'], (err, stdout) => {
      if (err) {
        sendJSON(res, 200, { cancelled: true });
        return;
      }
      const p = stdout.trim();
      if (p) sendJSON(res, 200, { path: p });
      else sendJSON(res, 200, { cancelled: true });
    });
  }
}

// ── Server ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (url.startsWith('/api/health') && req.method === 'GET') {
      handleHealth(res);
    } else if (url.startsWith('/api/clone') && req.method === 'GET') {
      handleClone(req, res, url);
    } else if (url.startsWith('/api/pick-folder') && req.method === 'POST') {
      await handlePickFolder(res);
    } else {
      sendJSON(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    console.error('[clone-server] Unhandled error:', err);
    sendJSON(res, 500, { error: '服务器内部错误' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[clone-server] port ${PORT} already in use — assuming another instance is running`);
  } else {
    console.error('[clone-server] server error:', err.message);
  }
});

server.listen(PORT, () => {
  console.log(`[clone-server] running on http://localhost:${PORT}`);
});
