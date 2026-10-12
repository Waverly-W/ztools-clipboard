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
  // ?demo=1：README 截图用的演示数据
  const DEMO = new URLSearchParams(location.search).has('demo')
  const demoSvg = {
    chart: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f8fafc"/><text x="32" y="48" font-size="22" font-family="sans-serif" fill="#1f2329">月度访问量</text>${[120, 180, 150, 240, 210, 300, 280].map((h, i) => `<rect x="${48 + i * 80}" y="${360 - h}" width="48" height="${h}" rx="6" fill="#3b82f6"/>`).join('')}</svg>`,
    ui: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#fff"/><rect width="640" height="44" fill="#f1f5f9"/><circle cx="24" cy="22" r="6" fill="#ef4444"/><circle cx="44" cy="22" r="6" fill="#f59e0b"/><circle cx="64" cy="22" r="6" fill="#22c55e"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="32" y="${76 + i * 56}" width="${520 - i * 60}" height="18" rx="9" fill="#e2e8f0"/>`).join('')}</svg>`,
    photo: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="480" cy="110" r="46" fill="#fbbf24"/><path d="M0 330 L160 200 L300 300 L420 220 L640 340 L640 400 L0 400Z" fill="#10b981"/><path d="M0 360 L200 280 L380 360 L640 300 L640 400 L0 400Z" fill="#047857"/></svg>`
  }
  const svgUrl = (k) => 'data:image/svg+xml,' + encodeURIComponent(demoSvg[k])
  if (DEMO) {
    const m = 60e3, h = 3600e3
    const t = (text, ago, extra = {}) => ({ type: 'text', text, time: now - ago, ...extra })
    items = [
      t('https://github.com/Waverly-W/ztools-clipboard', 8e3),
      { type: 'image', time: now - 2 * m, demo: 'chart', width: 640, height: 400 },
      t('周会纪要：1. 截图支持定格全屏选区与标注；2. OCR 结果可直接分词复制；3. 下周发布 1.3 版本。', 9 * m),
      t('#3B82F6', 23 * m),
      { type: 'file', time: now - 47 * m, files: [{ path: '/Users/demo/Documents/季度报告.pdf', name: '季度报告.pdf' }, { path: '/Users/demo/Pictures/设计稿', name: '设计稿', isDir: true }] },
      t('{\n  "name": "super-clipboard",\n  "version": "1.3.0"\n}', 1.3 * h),
      { type: 'image', time: now - 2.2 * h, demo: 'ui', width: 640, height: 400 },
      t('hello@example.com', 3.5 * h),
      t('git tag v1.3.0 && git push origin v1.3.0', 5 * h, { fav: true, favTime: now - 10 * m, tags: ['命令'] }),
      t('上海市浦东新区世纪大道 100 号', 26 * h, { fav: true, favTime: now - 20 * m, tags: ['常用'] }),
      { type: 'image', time: now - 28 * h, demo: 'photo', width: 640, height: 400, fav: true, favTime: now - 30 * m, tags: [] },
      t('const debounce = (fn, ms) => {\n  let timer\n  return (...args) => {\n    clearTimeout(timer)\n    timer = setTimeout(() => fn(...args), ms)\n  }\n}', 30 * h, { fav: true, favTime: now - 40 * m, tags: ['代码', '常用'] }),
      t('The quick brown fox jumps over the lazy dog.', 50 * h),
      t('npm install --save-dev vite', 52 * h, { fav: true, favTime: now - 50 * m, tags: ['命令'] }),
      t('订单号：2024-1012-8848，联系电话 138-1234-5678', 75 * h)
    ].map((it, i) => ({ id: 'd' + i, hash: 'd' + i, image: it.type === 'image' ? 'd' + i + '.png' : undefined, ...it }))
  }
  const listeners = new Set()
  const emit = () => listeners.forEach((f) => f())
  let config = {
    dataDir: '/Users/demo/.ztools-clipboard/data', maxCount: 800, maxDays: 14,
    toolbar: ['copy', 'view', 'fav', 'editFav', 'delete'],
    screenshot: { mode: 'freeze' },
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
    // window.__captureMode = 'bilinear'：返回把已知 1× 图片双线性放大 2 倍的截图（模拟 ZTools），原图存于 window.__source
    screenCapture: async (cb) => {
      if (window.__captureFail) throw new Error(window.__captureFail)
      await new Promise((r) => setTimeout(r, window.__captureDelay || 10))
      if (window.__captureEmpty) return cb('', undefined)
      const W = 400, H = 200, c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const g = c.getContext('2d')
      const d = g.createImageData(W * 2, H * 2)
      if (window.__captureMode === 'bilinear') {
        const S = new Uint8ClampedArray(W * H * 3); for (let i = 0; i < S.length; i++) S[i] = (i * 2654435761 >>> 24) & 255
        window.__source = S
        const at = (x, y, ch) => S[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3 + ch]
        for (let Y = 0; Y < H * 2; Y++) for (let X = 0; X < W * 2; X++) { const sx = (X + 0.5) / 2 - 0.5, sy = (Y + 0.5) / 2 - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0; for (let ch = 0; ch < 3; ch++) d.data[(Y * W * 2 + X) * 4 + ch] = Math.round((at(x0, y0, ch) * (1 - fx) + at(x0 + 1, y0, ch) * fx) * (1 - fy) + (at(x0, y0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, ch) * fx) * fy); d.data[(Y * W * 2 + X) * 4 + 3] = 255 }
      } else {
        // 每个 2×2 块的四个像素红色通道为 0、255、100、50（不符合双线性模型）
        for (let y = 0; y < H * 2; y++) for (let x = 0; x < W * 2; x++) { const o = (y * W * 2 + x) * 4; d.data[o] = [[0, 255], [100, 50]][y % 2][x % 2]; d.data[o + 1] = 128; d.data[o + 2] = (x >> 1) % 256; d.data[o + 3] = 255 }
      }
      g.putImageData(d, 0, 0); cb(c.toDataURL(), { x: 100, y: 50, width: W, height: H })
    },
    showNotification: (m) => log('showNotification', m), isMacOS: () => true,
    // 两块屏幕：id 1（光标所在，900×560，2 倍）和 id 2；thumbnail 模拟 NativeImage（BGRA 位图）
    desktopCaptureSources: async (opts) => {
      log('desktopCaptureSources', opts.thumbnailSize)
      if (window.__grabFail) throw new Error('grab failed')
      const make = (w, h, b, g, r) => { const buf = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { buf[i * 4] = b; buf[i * 4 + 1] = g; buf[i * 4 + 2] = r; buf[i * 4 + 3] = 255 } return { isEmpty: () => false, getSize: () => ({ width: w, height: h }), toBitmap: () => buf } }
      const { width, height } = opts.thumbnailSize
      return [{ id: 'screen:2', display_id: '2', thumbnail: make(width, height, 9, 9, 9) }, { id: 'screen:1', display_id: '1', thumbnail: make(width, height, 30, 60, 200) }]
    },
    getDisplayNearestPoint: () => ({ id: 1, scaleFactor: window.__sf || 2, bounds: { x: 0, y: 0, width: 900, height: 560 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getCursorScreenPoint: () => ({ x: 10, y: 10 }), screenToDipPoint: (p) => p,
    copyImage: (img) => (log('copyImage', img.slice(0, 22)), true),
    redirectHotKeySetting: (l) => log('redirectHotKeySetting', l),
    createBrowserWindow(url, options) {
      window.__wins = window.__wins || []
      const id = 100 + window.__wins.length
      const w = { url, options, calls: [], received: [] }
      window.__wins.push(w)
      const method = (name) => (...args) => w.calls.push([name, ...args])
      return { id, show: method('show'), focus: method('focus'), hide: method('hide'), close: method('close'), setBounds: method('setBounds'), setOpacity: method('setOpacity'), setAlwaysOnTop: method('setAlwaysOnTop'), webContents: { id, send: (ch, msg) => { w.received.push([ch, msg.type, msg.mode, msg.rect]); w.messages = (w.messages || []).concat([msg]); if (msg.type === 'init') w.lastInit = msg } } }
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
    imagePath: () => '/tmp/c.png', imageUrl: (i) => (i && i.demo ? svgUrl(i.demo) : svg('#f59e0b')), thumbUrl: (i) => (i && i.demo ? svgUrl(i.demo) : svg('#f59e0b')),
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
    replaceImageData: (oldPng, newPng, time) => { log('replaceImageData', time); window.__sharp = newPng; return window.services.addImageData(newPng) },
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
