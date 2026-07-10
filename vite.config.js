import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vite plugin: auto-start the clone-server.cjs alongside the dev server,
 * and tear it down when Vite exits.
 */
function cloneServerPlugin() {
  let proc = null
  return {
    name: 'clone-server',
    configureServer(server) {
      const serverScript = path.resolve(__dirname, 'server/clone-server.cjs')
      proc = spawn('node', [serverScript], { stdio: 'pipe', cwd: __dirname })
      proc.on('error', (err) => console.error('[clone-server] spawn error:', err.message))
      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) console.error(`[clone-server] exited code ${code}`)
      })
      proc.stdout.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) console.log(`  ${msg}`)
      })
      proc.stderr.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) console.error(`  ${msg}`)
      })
      proc.on('error', (err) => {
        console.error('[clone-server] failed to start:', err.message)
      })
      // Clean up on exit
      const kill = () => { if (proc) proc.kill('SIGTERM') }
      server.httpServer.on('close', kill)
      process.on('exit', kill)
      process.on('SIGINT', () => { kill(); process.exit() })
      process.on('SIGTERM', () => { kill(); process.exit() })
    },
  }
}

export default defineConfig({
  plugins: [react(), cloneServerPlugin()],
  base: '/notesviewer/',
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:5181',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['buffer', 'diff'],
  },
})
