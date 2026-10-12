// 生成 README 截图：用无头 Chrome 打开预览页的演示场景（dev/scenes.js），输出到 docs/screenshots/
// 用法：node dev/readme-shots.js（需要 Node 22+ 与 Google Chrome，可用 CHROME 环境变量指定路径）
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs/screenshots')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9333

const SHOTS = [
  ['history.png', 800, 540, 'dev/preview.html?demo=1&scene=history'],
  ['dark.png', 800, 540, 'dev/preview.html?demo=1&scene=dark'],
  ['favorites.png', 800, 540, 'dev/preview.html?demo=1&scene=fav'],
  ['ocr.png', 800, 540, 'dev/preview.html?demo=1&scene=ocr'],
  ['settings.png', 800, 540, 'dev/preview.html?demo=1&scene=settings'],
  ['screenshot-select.png', 900, 560, 'dev/capture-preview.html?mode=select&demo=1&scene=select'],
  ['screenshot-annotate.png', 900, 560, 'dev/capture-preview.html?mode=select&demo=1&scene=annotate']
]

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 静态文件服务
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// 极简的 Chrome 调试协议客户端
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) {
      listeners.forEach((l) => l(msg))
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  const once = (method) => new Promise((resolve) => listeners.push((m) => m.method === method && resolve(m.params)))
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, once, close: () => ws.close() })
    ws.onerror = reject
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const server = await serve()
  const base = `http://127.0.0.1:${server.address().port}/`
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-shots-'))
  const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  try {
    let version
    for (let i = 0; i < 50 && !version; i++) {
      await sleep(200)
      version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()).catch(() => null)
    }
    if (!version) throw new Error('无法连接 Chrome')
    for (const [name, width, height, url] of SHOTS) {
      const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
      const page = await connect(target.webSocketDebuggerUrl)
      await page.send('Page.enable')
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
      const loaded = page.once('Page.loadEventFired')
      await page.send('Page.navigate', { url: base + url })
      await loaded
      const { result } = await page.send('Runtime.evaluate', { expression: 'window.__sceneDone', awaitPromise: true, returnByValue: true })
      if (result.value !== true) throw new Error(`${name} 场景失败：${result.value}`)
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
      console.log(`已生成 docs/screenshots/${name}`)
      page.close()
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`).catch(() => {})
    }
  } finally {
    chrome.kill()
    server.close()
    await sleep(300)
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
