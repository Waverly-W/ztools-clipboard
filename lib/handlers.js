// 内置操作的本地实现：系统 OCR、二维码识别、图床上传、查找其他插件的指令
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const http = require('http')
const https = require('https')
const { execFile } = require('child_process')

const platform = process.platform
const TMP_DIR = path.join(os.tmpdir(), 'ztools-clipboard')

function electron() {
  return require('electron')
}

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()))
      else resolve(stdout)
    })
  })
}

function writeTemp(name, content) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const file = path.join(TMP_DIR, name)
  fs.writeFileSync(file, content)
  return file
}

// ---------- 系统 OCR ----------
// macOS：通过 JXA 调用 Vision 框架（10.15+，无需额外安装）
const MAC_OCR_SCRIPT = `ObjC.import('Foundation')
ObjC.import('Vision')
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary)
  const request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = 0
  request.usesLanguageCorrection = true
  request.recognitionLanguages = $(['zh-Hans', 'zh-Hant', 'en-US'])
  if (!handler.performRequestsError($([request]), Ref())) throw new Error('识别失败')
  const results = request.results
  const lines = []
  for (let i = 0; i < results.count; i++) {
    const top = results.objectAtIndex(i).topCandidates(1)
    if (top.count) lines.push(top.objectAtIndex(0).string.js)
  }
  return lines.join('\\n')
}
`

// Windows：通过 PowerShell 调用 Windows.Media.Ocr（Windows 10+，使用系统已安装的语言包）
const WIN_OCR_SCRIPT = `param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No OCR language installed' }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Lines | ForEach-Object { $_.Text }
`

const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef'

async function systemOcr(imagePath) {
  if (platform === 'darwin') {
    const script = writeTemp('ocr.js', MAC_OCR_SCRIPT)
    return (await run('osascript', ['-l', 'JavaScript', script, imagePath])).trim()
  }
  if (platform === 'win32') {
    const script = writeTemp('ocr.ps1', WIN_OCR_SCRIPT)
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, imagePath])
    // Windows OCR 会在中文字符之间插入空格
    return out.replace(new RegExp(`(?<=[${CJK}]) (?=[${CJK}])`, 'g'), '').trim()
  }
  let langs = 'eng'
  try {
    const list = await run('tesseract', ['--list-langs'])
    langs = ['chi_sim', 'chi_tra', 'eng'].filter((l) => list.includes(l)).join('+') || 'eng'
  } catch {
    throw new Error('未安装 tesseract，请先安装（如 sudo apt install tesseract-ocr tesseract-ocr-chi-sim）')
  }
  return (await run('tesseract', [imagePath, 'stdout', '-l', langs])).trim()
}

function systemOcrName() {
  if (platform === 'darwin') return 'macOS 系统文字识别'
  if (platform === 'win32') return 'Windows 系统文字识别'
  return 'Tesseract'
}

// 生成一张带文字的测试图片（预加载脚本可以访问 DOM）
function makeTestImage(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 360
  canvas.height = 100
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  ctx.font = '40px Arial, sans-serif'
  ctx.fillText(text, 20, 64)
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  return writeTemp('ocr-test.png', Buffer.from(base64, 'base64'))
}

async function detectSystemOcr() {
  try {
    const text = await systemOcr(makeTestImage('ZTools 2048'))
    if (text.includes('2048')) return { ok: true, message: `${systemOcrName()}可用` }
    return { ok: false, message: `${systemOcrName()}运行了但未识别出测试文字（结果：${text || '空'}）` }
  } catch (e) {
    const hint = platform === 'win32' ? '（需要 Windows 10 及以上，并安装 OCR 语言包）' : platform === 'darwin' ? '（需要 macOS 10.15 及以上）' : ''
    return { ok: false, message: `${systemOcrName()}不可用：${e.message}${hint}` }
  }
}

// ---------- 二维码 ----------
function decodeQr(imagePath) {
  const jsQR = require('./vendor/jsQR.js')
  const { nativeImage } = electron()
  const source = nativeImage.createFromPath(imagePath)
  if (source.isEmpty()) throw new Error('无法读取图片')
  const { width, height } = source.getSize()
  // 先按原图（过大时缩到 2000px）识别，失败再缩到 800px 重试
  const longest = Math.max(width, height)
  const sizes = longest > 800 ? [Math.min(longest, 2000), 800] : [longest]
  for (const max of sizes) {
    const scale = max / longest
    const img = scale < 1 ? source.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : source
    const { width: w, height: h } = img.getSize()
    const bgra = img.toBitmap()
    const rgba = new Uint8ClampedArray(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2]
      rgba[i + 1] = bgra[i + 1]
      rgba[i + 2] = bgra[i]
      rgba[i + 3] = bgra[i + 3]
    }
    const code = jsQR(rgba, w, h, { inversionAttempts: 'attemptBoth' })
    if (code && code.data) return code.data
  }
  return null
}

// ---------- HTTP ----------
function request(url, { method = 'GET', headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let target
    try { target = new URL(url) } catch { return reject(new Error('地址格式不正确')) }
    const lib = target.protocol === 'https:' ? https : http
    const req = lib.request(target, { method, headers, timeout }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function multipart(fields, file) {
  const boundary = '----ztools' + Date.now().toString(16)
  const parts = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`))
  parts.push(file.buffer, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

function canConnect(url, timeout = 2000) {
  return new Promise((resolve) => {
    let target
    try { target = new URL(url) } catch { return resolve(false) }
    const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)
    const socket = net.connect({ host: target.hostname, port, timeout })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

function getByPath(obj, keyPath) {
  return String(keyPath || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

// ---------- 图床 ----------
// picgo：PicGo / PicList 的本地服务，POST { list: [本地路径] }，返回 { success, result: [url] }
// custom：multipart 上传到自定义接口，从返回的 JSON 中按 urlPath 取图片地址
async function uploadImage(imagePath, cfg) {
  if (cfg.mode === 'picgo') {
    const res = await request(cfg.picgoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: [imagePath] })
    })
    const json = parseJson(res.body)
    if (!json || !json.success || !json.result || !json.result[0]) {
      throw new Error((json && (json.message || json.msg)) || `PicGo 返回异常：${res.body.slice(0, 200)}`)
    }
    return json.result[0]
  }
  if (!cfg.url) throw new Error('请先填写上传接口地址')
  let headers = {}
  if (cfg.headers && cfg.headers.trim()) {
    headers = parseJson(cfg.headers)
    if (!headers || typeof headers !== 'object') throw new Error('请求头必须是 JSON 对象')
  }
  const { body, contentType } = multipart({}, {
    field: cfg.fileField || 'file',
    name: path.basename(imagePath),
    type: 'image/png',
    buffer: fs.readFileSync(imagePath)
  })
  const res = await request(cfg.url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': contentType, 'Content-Length': body.length },
    body
  })
  const url = getByPath(parseJson(res.body), cfg.urlPath)
  if (typeof url !== 'string' || !url) throw new Error(`响应中未找到图片地址（HTTP ${res.status}）：${res.body.slice(0, 200)}`)
  return url
}

const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function detectImageHost(cfg) {
  if (cfg.mode === 'picgo') {
    if (await canConnect(cfg.picgoUrl)) return { ok: true, message: 'PicGo / PicList 服务已运行' }
    return { ok: false, message: `无法连接 ${cfg.picgoUrl}，请启动 PicGo / PicList 并在其设置中开启 Server` }
  }
  try {
    const url = await uploadImage(writeTemp('upload-test.png', Buffer.from(TEST_PNG, 'base64')), cfg)
    return { ok: true, message: `测试图片上传成功：${url}` }
  } catch (e) {
    return { ok: false, message: e.message }
  }
}

// ---------- 百度识图 ----------
const IMAGE_SEARCH_URL = 'https://graph.baidu.com/pcpage/index?tpl_from=pc'
const IMAGE_SEARCH_INPUT = 'input.general-upload-file'

// 在 ZTools 内置浏览器中打开百度识图页面并自动选择图片，由页面自己完成上传
async function imageSearch(imagePath) {
  const zt = window.ztools
  if (!zt.zbrowser) throw new Error('当前 ZTools 版本不支持内置浏览器')
  await zt.zbrowser
    .goto(IMAGE_SEARCH_URL)
    .wait(IMAGE_SEARCH_INPUT)
    .file(IMAGE_SEARCH_INPUT, imagePath)
    .run({ show: true, width: 1200, height: 800 })
}

async function detectImageSearch() {
  if (!window.ztools.zbrowser) return { ok: false, message: '当前 ZTools 版本不支持内置浏览器，请升级 ZTools' }
  try {
    const res = await request(IMAGE_SEARCH_URL, { timeout: 8000 })
    if (res.status >= 400) return { ok: false, message: `百度识图访问异常（HTTP ${res.status}）` }
    return { ok: true, message: '百度识图可以访问，使用时会在 ZTools 内置浏览器中打开' }
  } catch (e) {
    return { ok: false, message: `无法访问百度识图：${e.message}` }
  }
}

// ---------- 其他插件的指令 ----------
const PLUGINS_DIR = path.join(process.env.ZTOOLS_DATA_ROOT || path.join(os.homedir(), '.ztools'), 'plugins')

// 读取 asar 包内的文件（.zpx 安装的插件以 asar 形式存放）
function readFromAsar(file, inner) {
  let rawFs = fs
  try { rawFs = require('original-fs') } catch {}
  const fd = rawFs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    rawFs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonSize = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    rawFs.readSync(fd, json, 0, jsonSize, 16)
    let node = JSON.parse(json.toString('utf8'))
    for (const part of inner.split('/')) node = node && node.files && node.files[part]
    if (!node || node.offset === undefined) throw new Error('not found')
    const data = Buffer.alloc(node.size)
    rawFs.readSync(fd, data, 0, node.size, 8 + headerSize + Number(node.offset))
    return data.toString('utf8')
  } finally {
    rawFs.closeSync(fd)
  }
}

let pluginCache = null
function listPlugins() {
  if (pluginCache && Date.now() - pluginCache.time < 10000) return pluginCache.list
  const byName = new Map()
  let entries = []
  try { entries = fs.readdirSync(PLUGINS_DIR) } catch {}
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = path.join(PLUGINS_DIR, entry)
    let config
    try {
      const text = entry.endsWith('.asar') ? readFromAsar(full, 'plugin.json') : fs.readFileSync(path.join(full, 'plugin.json'), 'utf8')
      config = JSON.parse(text)
    } catch {
      continue
    }
    let mtime = 0
    try { mtime = fs.statSync(full).mtimeMs } catch {}
    const prev = byName.get(config.name)
    if (!prev || prev.mtime < mtime) {
      byName.set(config.name, { name: config.name, title: config.title || config.name, features: config.features || [], mtime })
    }
  }
  const list = [...byName.values()]
  pluginCache = { time: Date.now(), list }
  return list
}

// 按 ZTools 的跳转规则查找指令：带内容跳转只能命中 regex / over 指令，不带内容只能命中文字指令
function findCommand(label) {
  const [pluginTitle, cmdName] = Array.isArray(label) ? label : [null, label]
  const found = { withPayload: null, plain: null }
  for (const plugin of listPlugins()) {
    if (pluginTitle && plugin.title !== pluginTitle) continue
    for (const feature of plugin.features) {
      for (const cmd of feature.cmds || []) {
        const name = typeof cmd === 'string' ? cmd : cmd.label
        if (name !== cmdName) continue
        if (typeof cmd === 'string') found.plain = found.plain || plugin.title
        else if (cmd.type === 'regex' || cmd.type === 'over') found.withPayload = found.withPayload || { plugin: plugin.title, cmd }
      }
    }
  }
  return found
}

function listCommands() {
  const plugins = listPlugins()
  const commands = new Set()
  for (const p of plugins) {
    for (const f of p.features) {
      for (const c of f.cmds || []) {
        if (typeof c === 'string') commands.add(c)
        else if (c.type === 'regex' || c.type === 'over') commands.add(c.label)
      }
    }
  }
  return { plugins: plugins.map((p) => p.title), commands: [...commands] }
}

module.exports = {
  systemOcr,
  systemOcrName,
  detectSystemOcr,
  decodeQr,
  uploadImage,
  detectImageHost,
  imageSearch,
  detectImageSearch,
  findCommand,
  listCommands,
  PLUGINS_DIR
}
