// 读取系统剪贴板，并在内容变化时通知。
// 监听方式按优先级：外部监听程序（标准输出每打印一行代表一次变化）> ZTools 剪贴板事件 + 轮询
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { clipboard } = require('electron')
const { md5 } = require('./store')

const platform = process.platform
const MAX_TEXT = 1000000
// 密码管理器等应用标记的敏感内容，不记录
const IGNORED_FORMATS = ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType']

function ztools() {
  return window.ztools || {}
}

function readFilesRaw() {
  try {
    if (platform === 'darwin') return clipboard.read('NSFilenamesPboardType') || clipboard.read('public.file-url') || ''
    if (platform === 'win32') return clipboard.readBuffer('FileNameW').toString('hex')
    return clipboard.read('text/uri-list') || ''
  } catch {
    return ''
  }
}

function readFiles() {
  const zt = ztools()
  if (typeof zt.getCopyedFiles === 'function') {
    try {
      const list = zt.getCopyedFiles() || []
      return list.map((f) => ({ path: f.path, name: f.name || path.basename(f.path), isDir: !!f.isDirectory }))
    } catch {}
  }
  // 兜底：直接解析各平台的剪贴板格式
  let paths = []
  try {
    if (platform === 'darwin') {
      const plist = clipboard.read('NSFilenamesPboardType') || ''
      paths = [...plist.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1])
      if (!paths.length) {
        const url = clipboard.read('public.file-url')
        if (url) paths = [decodeURI(url.replace(/^file:\/\//, ''))]
      }
    } else if (platform === 'win32') {
      const raw = clipboard.readBuffer('FileNameW').toString('ucs2').replace(/\0+$/, '')
      if (raw) paths = [raw]
    } else {
      const list = clipboard.read('text/uri-list') || ''
      paths = list.split(/\r?\n/).filter((l) => l.startsWith('file://')).map((l) => decodeURI(l.slice(7)))
    }
  } catch {}
  return paths.filter(Boolean).map((p) => {
    let isDir = false
    try { isDir = fs.statSync(p).isDirectory() } catch {}
    return { path: p, name: path.basename(p), isDir }
  })
}

// 抽样指纹：比完整哈希便宜得多，只用于判断剪贴板是否变化
function sampleBuffer(buf) {
  const step = Math.max(1, Math.floor(buf.length / 4096))
  const sample = Buffer.alloc(Math.ceil(buf.length / step))
  for (let i = 0, j = 0; i < buf.length; i += step, j++) sample[j] = buf[i]
  return buf.length + ':' + md5(sample)
}

// 各平台剪贴板中图片的原始数据格式；读取原始数据不需要解码，比 readImage 便宜得多
const RAW_IMAGE_FORMATS = { darwin: ['public.png', 'public.tiff'], win32: ['PNG'], linux: ['image/png'] }

function imageSignature() {
  for (const format of RAW_IMAGE_FORMATS[platform] || []) {
    try {
      const buf = clipboard.readBuffer(format)
      if (buf && buf.length) return format + ':' + sampleBuffer(buf)
    } catch {}
  }
  // 没有可直接读取的原始数据时才解码图片
  const img = clipboard.readImage()
  if (img.isEmpty()) return ''
  const { width, height } = img.getSize()
  return `${width}x${height}:${sampleBuffer(img.toBitmap())}`
}

function signature() {
  const formats = clipboard.availableFormats()
  let sig = formats.join(',') + '|' + md5(clipboard.readText()) + '|' + md5(readFilesRaw())
  if (formats.some((f) => f.startsWith('image/'))) sig += '|' + imageSignature()
  return sig
}

// 读取当前剪贴板内容：文件 > 文字 > 图片
function readEntry() {
  const formats = clipboard.availableFormats()
  if (formats.some((f) => IGNORED_FORMATS.includes(f))) return null

  if (readFilesRaw()) {
    const files = readFiles()
    if (files.length) return { type: 'file', files }
  }
  const text = clipboard.readText()
  if (text && text.trim() && text.length <= MAX_TEXT) return { type: 'text', text }

  const img = clipboard.readImage()
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    return { type: 'image', png: img.toPNG(), bitmapHash: md5(img.toBitmap()), width, height }
  }
  return null
}

class Watcher {
  constructor(onEntry) {
    this.onEntry = onEntry
    this.lastSig = ''
    this.mode = 'none'
    this.timer = null
    this.proc = null
  }

  check() {
    let sig
    try { sig = signature() } catch { return }
    if (sig === this.lastSig) return
    this.lastSig = sig
    let entry = null
    try { entry = readEntry() } catch (e) { console.error('[clipboard] read failed', e) }
    if (entry) this.onEntry(entry)
  }

  start(listenerPath) {
    this.stop()
    // 启动时当前剪贴板内容不重复记录
    try { this.lastSig = signature() } catch {}

    if (listenerPath && fs.existsSync(listenerPath)) {
      try {
        this.proc = spawn(listenerPath, [], { stdio: ['ignore', 'pipe', 'ignore'] })
        this.proc.stdout.on('data', () => this.check())
        this.proc.on('exit', () => {
          if (this.mode === 'native') this.startPolling()
        })
        this.proc.on('error', () => this.startPolling())
        this.mode = 'native'
        return
      } catch (e) {
        console.error('[clipboard] listener failed', e)
      }
    }
    this.startPolling()
  }

  startPolling() {
    this.proc = null
    this.mode = 'polling'
    const zt = ztools()
    if (zt.clipboard && typeof zt.clipboard.onChange === 'function') {
      try { zt.clipboard.onChange(() => this.check()) } catch {}
    }
    clearInterval(this.timer)
    this.timer = setInterval(() => this.check(), 800)
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
    if (this.proc) {
      const proc = this.proc
      this.proc = null
      this.mode = 'none'
      try { proc.kill() } catch {}
    }
  }
}

module.exports = { Watcher }
