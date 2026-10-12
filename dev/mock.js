// 浏览器预览用：模拟 window.ztools 与 window.services（不会打包进插件）
;(function () {
  const now = Date.now()
  const svg = (c) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${c}"/></svg>`)
  let items = [
    { id: '1', type: 'text', hash: 'a', time: now - 5e3, text: 'Hello ZTools 超级剪贴板，这是一段用于测试分词的中文文本。' },
    { id: '2', type: 'text', hash: 'b', time: now - 90e3, text: '#3b82f6' },
    { id: '3', type: 'image', hash: 'c', time: now - 4e6, image: 'c.png', width: 320, height: 200 },
    { id: '4', type: 'file', hash: 'd', time: now - 9e7, files: [{ path: '/Users/me/Documents/report.pdf', name: 'report.pdf' }, { path: '/Users/me/Pictures', name: 'Pictures', isDir: true }] },
    { id: '5', type: 'text', hash: 'e', time: now - 2e8, text: 'function hello() {\n  return "world"\n}', fav: true, favTime: now - 1e3, tags: ['代码'] },
    { id: '6', type: 'text', hash: 'f', time: now - 3e8, text: '收藏的地址 上海市', fav: true, favTime: now - 2e3, tags: [] }
  ]
  for (let i = 0; i < 30; i++) items.push({ id: 'g' + i, type: 'text', hash: 'g' + i, time: now - 4e8 - i * 1e6, text: '历史记录 ' + i })
  const listeners = new Set()
  const emit = () => listeners.forEach((f) => f())
  let config = {
    dataDir: '/Users/me/.ztools-clipboard/data', maxCount: 800, maxDays: 14,
    toolbar: ['copy', 'view', 'fav', 'editFav', 'delete'],
    ocr: { engine: 'auto' },
    imageHost: { mode: 'picgo', picgoUrl: 'http://127.0.0.1:36677/upload', url: '', fileField: 'file', headers: '', urlPath: 'data.url', format: 'url' },
    customActions: [
      { id: 'translate', name: '翻译', types: ['text'], handler: 'provider', provider: 'translation', url: 'https://cn.bing.com/translator?text={text}' },
      { id: 'baidu', name: '百度搜索', types: ['text'], handler: 'url', url: 'https://www.baidu.com/s?wd={text}' },
      { id: 'wordCount', name: '统计字数', types: ['text'], handler: 'builtin', builtin: 'wordCount' },
      { id: 'color', name: '识别颜色值', types: ['text'], match: '^\\s*(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(rgb|hsl)a?\\([^)]*\\))\\s*$', handler: 'builtin', builtin: 'color' },
      { id: 'ocr', name: 'OCR 文字识别', types: ['image'], handler: 'builtin', builtin: 'ocr' },
      { id: 'imageHost', name: '上传图床', types: ['image'], handler: 'builtin', builtin: 'imageHost' },
      { id: 'baiduImage', name: '百度识图', types: ['image'], handler: 'builtin', builtin: 'imageSearch' },
      { id: 'qrcode', name: '识别二维码', types: ['image'], handler: 'builtin', builtin: 'qrcode' },
      { id: 'memo', name: '收藏到备忘快贴', types: ['text', 'image'], handler: 'redirect', redirect: '备忘快贴' }
    ]
  }
  const defaults = JSON.parse(JSON.stringify(config))
  const store = {}
  window.__log = []
  const log = (...a) => { window.__log.push(a); console.log('[mock]', ...a) }
  window.ztools = {
    isDarkColors: () => matchMedia('(prefers-color-scheme: dark)').matches,
    onThemeChange() {}, onPluginEnter(fn) { window.__enter = fn; setTimeout(() => fn({ code: 'clipboard' }), 0) },
    // 截图相关（window.__wins 记录创建的窗口及收到的消息）
    hideMainWindow: async () => log('hideMainWindow'), showMainWindow: async () => log('showMainWindow'),
    screenCapture: async (cb) => { if (window.__captureFail) throw new Error(window.__captureFail); await new Promise((r) => setTimeout(r, 10)); if (window.__captureEmpty) return cb('', undefined); const c = document.createElement('canvas'); c.width = 800; c.height = 400; const g = c.getContext('2d')
      // 每个 2×2 块的四个像素红色通道为 0、255、100、50，平均值应为 101
      const d = g.createImageData(800, 400); for (let y = 0; y < 400; y++) for (let x = 0; x < 800; x++) { const o = (y * 800 + x) * 4; d.data[o] = [[0, 255], [100, 50]][y % 2][x % 2]; d.data[o + 1] = 128; d.data[o + 2] = (x >> 1) % 256; d.data[o + 3] = 255 }
      g.putImageData(d, 0, 0); cb(c.toDataURL(), { x: 100, y: 50, width: 400, height: 200 }) },
    showNotification: (m) => log('showNotification', m), isMacOS: () => true,
    getDisplayNearestPoint: () => ({ scaleFactor: window.__sf || 2, workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getCursorScreenPoint: () => ({ x: 10, y: 10 }), screenToDipPoint: (p) => p,
    copyImage: (img) => (log('copyImage', img.slice(0, 22)), true),
    redirectHotKeySetting: (l) => log('redirectHotKeySetting', l),
    createBrowserWindow(url, options) {
      window.__wins = window.__wins || []
      const id = 100 + window.__wins.length
      const w = { url, options, calls: [], received: [] }
      window.__wins.push(w)
      const method = (name) => (...args) => w.calls.push([name, ...args])
      return { id, show: method('show'), focus: method('focus'), hide: method('hide'), close: method('close'), setBounds: method('setBounds'), setOpacity: method('setOpacity'), setAlwaysOnTop: method('setAlwaysOnTop'), webContents: { id, send: (ch, msg) => w.received.push([ch, msg.type, msg.mode, msg.rect]) } }
    },
    removeSubInput() {}, subInputBlur() {},
    dbStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
    shellOpenExternal: (u) => log('openExternal', u), shellShowItemInFolder: (p) => log('showInFolder', p),
    redirect: (l, p) => { log('redirect', l, p); if (Array.isArray(l) && l[0] === '超级剪贴板') setTimeout(() => window.__enter({ code: 'clipboard' }), 20); return true },
    // window.__noProvider = true 模拟未启用任何 OCR / 翻译服务
    // window.__provider = true 模拟已启用 OCR / 翻译服务
    providers: { getDefaultProvider: async (t) => (window.__provider ? { id: 'mock:' + t, label: '模拟' + t } : null) },
    zbrowser: {},
    ocr: async (image) => (log('ocr', image.slice(0, 22)), { text: '识别出的文字\nOCR result' }),
    translate: async (text) => (log('translate', text), { text: '[译] ' + text })
  }
  window.services = {
    getItems: () => items, getItem: (id) => items.find((i) => i.id === id), onChange: (f) => listeners.add(f), sync() {},
    remove: (ids) => { items = items.filter((i) => !ids.includes(i.id)); emit() },
    clearAll: () => { items = []; emit() },
    favorite: (ids) => { ids.forEach((id) => Object.assign(items.find((i) => i.id === id), { fav: true, favTime: Date.now(), tags: [] })); emit() },
    unfavorite: (ids) => { ids.forEach((id) => Object.assign(items.find((i) => i.id === id), { fav: false, tags: [] })); emit() },
    editFavorite: (id, { text, tags }) => { const it = items.find((i) => i.id === id); if (text) { it.text = text; it.hash += 'x' } it.tags = tags; it.fav = true; emit() },
    imagePath: () => '/tmp/c.png', imageUrl: () => svg('#f59e0b'), thumbUrl: () => svg('#f59e0b'),
    fileExists: (p) => !p.endsWith('.pdf'), openFolder: (i) => log('openFolder', i.id), openPath: (p) => log('openPath', p),
    saveAsFile: (i) => (log('saveAsFile', i.id), '/tmp/x'),
    copy: (its) => (log('copy', its.map((i) => i.id)), true), paste: (its) => log('paste', its.map((i) => i.id)),
    pasteText: (t) => log('pasteText', t), copyText: (t) => log('copyText', t),
    getConfig: () => JSON.parse(JSON.stringify(config)), getDefaultConfig: () => defaults,
    setConfig: (p) => (config = { ...config, ...p }), resetConfig: () => (config = { ...defaults, dataDir: config.dataDir }),
    chooseDataDir: () => null, openDataDir: () => log('openDataDir'),
    listenerStatus: () => ({ path: '/Users/me/.ztools-clipboard/bin/clipboard-listener', installed: false, mode: 'polling' }),
    restartListener: () => 'polling', openListenerDir: () => log('openListenerDir'),
    onShotMessage: (fn) => { window.__shotMsg = fn },
    debugLog: (...a) => (window.__debug = window.__debug || []).push(a),
    addImageData: (png) => { log('addImageData', png.slice(0, 22)); let it = items.find((i) => i.id === 'shot'); if (!it) { it = { id: 'shot', type: 'image', hash: 'shot', image: 'shot.png', width: 800, height: 400 }; items.unshift(it) } it.time = Date.now(); items.sort((a, b) => b.time - a.time); emit(); return it },
    saveImageData: (png) => (log('saveImageData', png.slice(0, 22)), '/tmp/shot.png'),
    replaceImageData: (oldPng, newPng) => { log('replaceImageData'); window.__sharp = newPng; return window.services.addImageData(newPng) },
    systemOcr: async (i) => (log('systemOcr', i.id), '订单号：2024-1012-8848 下单时间 2024/10/12 15:30\n联系电话 138-1234-5678 邮箱 test@example.com\n官网 https://ztools.example/doc?id=1 实付 1,299.00 元'), systemOcrName: () => 'macOS 系统文字识别',
    detectSystemOcr: async () => ({ ok: true, message: 'macOS 系统文字识别可用' }),
    decodeQr: (i) => (log('decodeQr', i.id), 'https://example.com/qr'),
    uploadImage: async (i) => (log('uploadImage', i.id, config.imageHost.mode), 'https://img.example/c.png'),
    detectImageHost: async () => (config.imageHost.mode === 'picgo' ? { ok: false, message: '无法连接 ' + config.imageHost.picgoUrl + '，请启动 PicGo / PicList 并在其设置中开启 Server' } : { ok: true, message: '测试图片上传成功：https://img.example/t.png' }),
    imageSearch: async (i) => log('imageSearch', i.id), detectImageSearch: async () => ({ ok: true, message: '百度识图可以访问，使用时会在 ZTools 内置浏览器中打开' }),
    findCommand: (label) => {
      const l = Array.isArray(label) ? label[1] : label
      if (l === '文字识别') return { withPayload: null, plain: 'Native OCR' }
      if (l === 'JSON 格式化') return { withPayload: { plugin: 'json-format' }, plain: null }
      return { withPayload: null, plain: null }
    },
    listCommands: () => ({ plugins: ['Native OCR', 'json-format'], commands: ['文字识别', 'ocr', 'JSON 格式化'] })
  }
})()
