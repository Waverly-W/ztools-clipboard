const fs = require('fs')
const os = require('os')
const path = require('path')
const { Store, md5 } = require('./lib/store')
const { Watcher } = require('./lib/clipboard')
const handlers = require('./lib/handlers')

const BASE_DIR = path.join(os.homedir(), '.ztools-clipboard')
const LISTENER_PATH = path.join(BASE_DIR, 'bin', process.platform === 'win32' ? 'clipboard-listener.exe' : 'clipboard-listener')
const CONFIG_KEY = 'config'

const DEFAULT_CONFIG = {
  dataDir: path.join(BASE_DIR, 'data'),
  maxCount: 800,
  maxDays: 14,
  toolbar: ['copy', 'view', 'fav', 'editFav', 'delete'],
  // 截图方式：freeze 先定格全屏画面再在插件窗口中选区（流畅、原始分辨率）；native 使用 ZTools 原生截图
  screenshot: { mode: 'freeze' },
  // OCR 引擎：auto 优先使用 ZTools 中已启用的 OCR 服务，没有时使用系统文字识别
  ocr: { engine: 'auto' },
  // 图床：picgo 使用 PicGo / PicList 本地服务；custom 上传到自定义接口
  imageHost: {
    mode: 'picgo',
    picgoUrl: 'http://127.0.0.1:36677/upload',
    url: '',
    fileField: 'file',
    headers: '',
    urlPath: 'data.url',
    format: 'url'
  },
  // 自定义操作。handler 决定处理方式：
  //   builtin  内置功能，builtin 为 wordCount / color / qrcode / ocr / imageHost / imageSearch
  //   provider ZTools 中已启用的服务，provider 为 translation / ocr；翻译没有服务时打开 url
  //   redirect 转给其他插件的指令，redirect 为 "指令名" 或 ["插件名", "指令名"]
  //   url      打开网址，{text} 会被替换为内容
  // types: 适用的内容类型；match: 文字需匹配的正则（可选）
  customActions: [
    { id: 'translate', name: '翻译', types: ['text'], handler: 'provider', provider: 'translation', url: 'https://cn.bing.com/translator?text={text}' },
    { id: 'baidu', name: '百度搜索', types: ['text'], handler: 'url', url: 'https://www.baidu.com/s?wd={text}' },
    { id: 'wordCount', name: '统计字数', types: ['text'], handler: 'builtin', builtin: 'wordCount' },
    {
      id: 'color',
      name: '识别颜色值',
      types: ['text'],
      match: '^\\s*(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(rgb|hsl)a?\\([^)]*\\))\\s*$',
      handler: 'builtin',
      builtin: 'color'
    },
    { id: 'ocr', name: 'OCR 文字识别', types: ['image'], handler: 'builtin', builtin: 'ocr' },
    { id: 'imageHost', name: '上传图床', types: ['image'], handler: 'builtin', builtin: 'imageHost' },
    { id: 'baiduImage', name: '百度识图', types: ['image'], handler: 'builtin', builtin: 'imageSearch' },
    { id: 'qrcode', name: '识别二维码', types: ['image'], handler: 'builtin', builtin: 'qrcode' },
    { id: 'memo', name: '收藏到备忘快贴', types: ['text', 'image'], handler: 'redirect', redirect: '备忘快贴' }
  ]
}

// 1.0.0 / 1.0.1 的默认操作，读取旧配置时替换为新的默认操作
const LEGACY_DEFAULTS = {
  translate: ['redirect:翻译', 'provider:translation'],
  wordCount: ['redirect:统计字数'],
  color: ['redirect:颜色'],
  ocr: ['redirect:OCR', 'provider:ocr'],
  imageHost: ['redirect:上传到图床'],
  baiduImage: ['redirect:百度识图'],
  qrcode: ['redirect:识别二维码']
}

function inferHandler(action) {
  if (action.handler) return action
  const handler = action.builtin ? 'builtin' : action.provider ? 'provider' : action.url ? 'url' : 'redirect'
  return { ...action, handler }
}

function migrateActions(actions) {
  return actions.map((action) => {
    if (!action || action.handler) return action
    const legacy = LEGACY_DEFAULTS[action.id] || []
    const key = action.provider ? 'provider:' + action.provider : 'redirect:' + action.redirect
    const fresh = DEFAULT_CONFIG.customActions.find((a) => a.id === action.id)
    return fresh && legacy.includes(key) ? fresh : inferHandler(action)
  })
}

const zt = () => window.ztools

function loadConfig() {
  let saved = null
  try { saved = zt().dbStorage.getItem(CONFIG_KEY) } catch {}
  const merged = { ...DEFAULT_CONFIG, ...(saved || {}) }
  merged.screenshot = { ...DEFAULT_CONFIG.screenshot, ...merged.screenshot }
  merged.ocr = { ...DEFAULT_CONFIG.ocr, ...merged.ocr }
  merged.imageHost = { ...DEFAULT_CONFIG.imageHost, ...merged.imageHost }
  merged.customActions = migrateActions(merged.customActions || [])
  return merged
}

let config = loadConfig()
let store
try {
  store = new Store(config.dataDir)
} catch (e) {
  // 自定义目录不可用（如网盘未挂载）时退回默认目录
  console.error('[clipboard] data dir unavailable', e)
  store = new Store(DEFAULT_CONFIG.dataDir)
}

function cleanup() {
  store.cleanup({ maxCount: config.maxCount, maxDays: config.maxDays })
}

const watcher = new Watcher((entry) => {
  store.add(entry)
  cleanup()
})
watcher.start(LISTENER_PATH)
cleanup()
setInterval(cleanup, 60 * 60 * 1000)
window.addEventListener('beforeunload', () => {
  watcher.stop()
  store.flush()
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const thumbCache = new Map()

function itemPaths(item) {
  if (item.type === 'file') return item.files.map((f) => f.path)
  if (item.type === 'image') return [store.imagePath(item)]
  return []
}

window.services = {
  // ---------- 记录 ----------
  getItems: () => store.items,
  getItem: (id) => store.get(id),
  onChange: (fn) => store.onChange(fn),
  sync: () => {
    store.syncFromDisk()
    cleanup()
  },
  remove: (ids) => store.remove(ids),
  clearAll: () => store.clear(),
  favorite: (ids, tags = []) => {
    for (const id of ids) {
      const item = store.get(id)
      if (item && !item.fav) store.update(id, { fav: true, favTime: Date.now(), tags: item.tags || tags })
    }
  },
  unfavorite: (ids) => {
    for (const id of ids) store.update(id, { fav: false, tags: [] })
    cleanup()
  },
  editFavorite: (id, { text, tags }) => {
    const item = store.get(id)
    if (!item) return
    const patch = { fav: true, favTime: item.favTime || Date.now(), tags }
    if (item.type === 'text' && typeof text === 'string' && text.trim()) patch.text = text
    store.update(id, patch)
  },

  // ---------- 图片 / 文件 ----------
  imagePath: (item) => store.imagePath(item),
  imageUrl: (item) => {
    const { nativeImage } = require('electron')
    return nativeImage.createFromPath(store.imagePath(item)).toDataURL()
  },
  thumbUrl: (item) => {
    if (thumbCache.has(item.image)) return thumbCache.get(item.image)
    const { nativeImage } = require('electron')
    let img = nativeImage.createFromPath(store.imagePath(item))
    if (img.isEmpty()) return ''
    const { width, height } = img.getSize()
    if (width > 160 || height > 160) {
      img = width >= height ? img.resize({ width: 160 }) : img.resize({ height: 160 })
    }
    const url = img.toDataURL()
    thumbCache.set(item.image, url)
    return url
  },
  fileExists: (p) => fs.existsSync(p),
  openFolder: (item) => {
    const p = itemPaths(item)[0]
    if (p) zt().shellShowItemInFolder(p)
  },
  openPath: (p) => zt().shellOpenPath(p),
  saveAsFile: (item) => {
    const isImage = item.type === 'image'
    const target = zt().showSaveDialog({
      title: '保存为文件',
      defaultPath: path.join(zt().getPath('downloads'), `clipboard-${Date.now()}.${isImage ? 'png' : 'txt'}`),
      filters: isImage ? [{ name: '图片', extensions: ['png'] }] : [{ name: '文本', extensions: ['txt', 'md'] }]
    })
    if (!target) return false
    if (isImage) fs.copyFileSync(store.imagePath(item), target)
    else fs.writeFileSync(target, item.text, 'utf8')
    return target
  },

  // ---------- 复制 / 粘贴 ----------
  // 多条内容：全是文字则换行拼接；没有文字则合并为文件（图片以图片文件形式）
  copy: (items) => {
    const texts = items.filter((i) => i.type === 'text')
    if (texts.length === items.length) return zt().copyText(texts.map((i) => i.text).join('\n'))
    if (items.length === 1 && items[0].type === 'image') return zt().copyImage(store.imagePath(items[0]))
    if (!texts.length) return zt().copyFile(items.flatMap(itemPaths))
    zt().copyText(texts.map((i) => i.text).join('\n'))
    return 'partial'
  },
  paste: async (items) => {
    const texts = items.filter((i) => i.type === 'text')
    if (texts.length === items.length) return zt().hideMainWindowPasteText(texts.map((i) => i.text).join('\n'))
    if (items.length === 1 && items[0].type === 'image') return zt().hideMainWindowPasteImage(store.imagePath(items[0]))
    if (!texts.length) return zt().hideMainWindowPasteFile(items.flatMap(itemPaths))
    // 文字和图片/文件混合时逐条粘贴
    for (const item of items) {
      if (item.type === 'text') zt().hideMainWindowPasteText(item.text)
      else if (item.type === 'image') zt().hideMainWindowPasteImage(store.imagePath(item))
      else zt().hideMainWindowPasteFile(itemPaths(item))
      await sleep(300)
    }
    return true
  },
  pasteText: (text) => zt().hideMainWindowPasteText(text),
  copyText: (text) => zt().copyText(text),

  // ---------- 设置 ----------
  getConfig: () => JSON.parse(JSON.stringify(config)),
  getDefaultConfig: () => JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  setConfig: (patch) => {
    config = { ...config, ...patch }
    zt().dbStorage.setItem(CONFIG_KEY, config)
    cleanup()
    return config
  },
  // 恢复默认设置，保留记录存放位置
  resetConfig: () => {
    config = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), dataDir: config.dataDir }
    zt().dbStorage.setItem(CONFIG_KEY, config)
    cleanup()
    return config
  },
  chooseDataDir: () => {
    const dirs = zt().showOpenDialog({
      title: '选择记录存放位置',
      defaultPath: config.dataDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (!dirs || !dirs[0]) return null
    store.moveTo(dirs[0])
    window.services.setConfig({ dataDir: dirs[0] })
    return dirs[0]
  },
  openDataDir: () => zt().shellOpenPath(config.dataDir),
  listenerStatus: () => ({
    path: LISTENER_PATH,
    installed: fs.existsSync(LISTENER_PATH),
    mode: watcher.mode
  }),
  restartListener: () => {
    watcher.start(LISTENER_PATH)
    return watcher.mode
  },
  openListenerDir: () => {
    fs.mkdirSync(path.dirname(LISTENER_PATH), { recursive: true })
    zt().shellOpenPath(path.dirname(LISTENER_PATH))
  },

  // ---------- 截图 ----------
  // 截图流程的诊断日志：~/.ztools-clipboard/debug.log，超过 200KB 时清空重写
  debugLog: (...args) => {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
    try {
      const file = path.join(BASE_DIR, 'debug.log')
      fs.mkdirSync(BASE_DIR, { recursive: true })
      let size = 0
      try { size = fs.statSync(file).size } catch {}
      if (size > 200 * 1024) fs.writeFileSync(file, line)
      else fs.appendFileSync(file, line)
    } catch {}
    console.log('[screenshot]', ...args)
  },
  // 截图窗口通过 ztools.sendToParent('shot', msg) 发来的消息，senderId 为窗口的 webContents.id
  onShotMessage: (fn) => {
    require('electron').ipcRenderer.on('shot', (event, msg) => fn(event.senderId, msg))
  },
  // 把图片（Data URL）写入历史，已存在时挪到最前面；time 指定记录时间
  addImageData: (dataUrl, time) => {
    const { nativeImage } = require('electron')
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const item = store.add({ type: 'image', png: img.toPNG(), bitmapHash: md5(img.toBitmap()), width, height }, { time })
    cleanup()
    return item
  },
  // 用清晰版截图替换历史中 ZTools 原始截图（已收藏的保留）；time 为截图时间，保证历史顺序
  replaceImageData: (oldDataUrl, newDataUrl, time) => {
    const { nativeImage } = require('electron')
    const old = nativeImage.createFromDataURL(oldDataUrl)
    if (!old.isEmpty()) {
      const hash = 'img:' + md5(old.toBitmap())
      const stale = store.items.filter((i) => i.hash === hash && !i.fav).map((i) => i.id)
      if (stale.length) store.remove(stale)
    }
    return window.services.addImageData(newDataUrl, time)
  },
  saveImageData: (dataUrl) => {
    const now = new Date()
    const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join('')
    const target = zt().showSaveDialog({
      title: '保存截图',
      defaultPath: path.join(zt().getPath('pictures') || zt().getPath('downloads'), `截图-${stamp}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (!target) return false
    fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return target
  },

  // ---------- 内置操作 ----------
  systemOcr: (item) => handlers.systemOcr(store.imagePath(item)),
  systemOcrName: () => handlers.systemOcrName(),
  detectSystemOcr: () => handlers.detectSystemOcr(),
  decodeQr: (item) => handlers.decodeQr(store.imagePath(item)),
  uploadImage: (item) => handlers.uploadImage(store.imagePath(item), config.imageHost),
  detectImageHost: () => handlers.detectImageHost(config.imageHost),
  imageSearch: (item) => handlers.imageSearch(store.imagePath(item)),
  detectImageSearch: () => handlers.detectImageSearch(),
  findCommand: (label) => handlers.findCommand(label),
  listCommands: () => handlers.listCommands()
}
