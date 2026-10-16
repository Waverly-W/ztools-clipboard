// 截图：调用 ZTools 截图，打开标注 / 贴图窗口，并与剪贴板历史联动
// 截图窗口只负责界面，复制、保存、写入历史、跳转都在插件主页面完成
const SHOT_WINDOW_OPS = new Set(['setBounds', 'setOpacity', 'setAlwaysOnTop', 'setVisibleOnAllWorkspaces', 'focus'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// NativeImage（BGRA 位图）转为 RGBA 像素
function nativeImageToPixels(img) {
  const { width, height } = img.getSize()
  const data = new Uint8ClampedArray(img.toBitmap())
  const px = new Uint32Array(data.buffer, 0, width * height)
  // 小端序下每个像素读为 0xAARRGGBB，交换 R、B 得到 0xAABBGGRR（即 RGBA 字节序）
  for (let i = 0; i < px.length; i++) {
    const v = px[i]
    px[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff)
  }
  return { width, height, data }
}

async function imageSize(src) {
  const size = pngSize(src)
  if (size) return size
  const img = await loadImageElement(src)
  return img && { width: img.naturalWidth, height: img.naturalHeight }
}

const Shot = {
  windows: new Map(), // webContents.id → { win, ready, init, history }
  spare: null, // 预先加载好的隐藏截图窗口，截图完成后直接使用，省去创建窗口的时间
  pendingFocus: null, // 跳转剪贴板后要选中的条目 { id, ocr }
  copyEpoch: 0, // 截图窗口每次复制时加一，用于判断剪贴板是否已被用户的复制覆盖

  init() {
    services.onShotMessage((id, msg) => {
      try {
        this.onMessage(id, msg)
      } catch (e) {
        services.debugLog('window:error', String((e && e.stack) || e))
      }
    })
  },

  // after: edit 进入标注；pin 直接贴图；ocr 直接识别文字
  // param 为插件进入参数，用来判断是否从搜索框启动（主窗口可见）
  async capture(after = 'edit', param = {}) {
    const fromSearch = !!(param.payload || (param.inputState && param.inputState.searchQuery))
    // 抓屏还没完成时再次触发（连按快捷键）直接忽略，避免同时打开多个截图窗口；
    // 超过 15 秒视为上一次已失效，避免异常时之后的截图都被忽略
    if (this.capturing && Date.now() - this.capturing < 15000) return services.debugLog('capture:busy', { after })
    // 上一次截图的窗口还停在选区阶段（如抓屏较慢时多按了一次快捷键），不再叠加一个全屏截图窗口
    const selecting = [...this.windows.values()].find((e) => e.shown && e.mode === 'select')
    if (selecting) {
      try { selecting.win.focus() } catch {}
      return services.debugLog('capture:selecting', { after })
    }
    const started = Date.now()
    this.capturing = started
    try {
      return await this.captureWith(after, fromSearch)
    } finally {
      if (this.capturing === started) this.capturing = 0
    }
  },

  async captureWith(after, fromSearch) {
    this.mainHidden = false
    if (services.getConfig().screenshot.mode === 'freeze') {
      try {
        if (await this.captureFrozen(after, fromSearch)) return
      } catch (e) {
        services.debugLog('freeze:error', String((e && e.stack) || e))
      }
      services.debugLog('freeze:fallback-native')
    }
    // 定格截图已隐藏过主窗口时不再重复隐藏
    return this.captureNative(after, fromSearch && !this.mainHidden)
  },

  // 定格全屏：抓取光标所在屏幕的原始分辨率画面，在铺满该屏幕的截图窗口中选区、标注
  async captureFrozen(after, fromSearch) {
    const log = services.debugLog
    const zt = window.ztools
    if (typeof zt.desktopCaptureSources !== 'function') return false
    const started = Date.now()
    this.ensureSpare() // 抓屏的同时加载窗口
    if (fromSearch) {
      // 从搜索框启动时主窗口可见：先隐藏，避免被截进画面
      await zt.hideMainWindow()
      await sleep(250)
      this.mainHidden = true
    }
    const display = zt.getDisplayNearestPoint(zt.getCursorScreenPoint())
    const physical = {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    }
    // thumbnailSize 等于屏幕物理像素时得到原始画面，不会缩放
    const sources = await zt.desktopCaptureSources({ types: ['screen'], thumbnailSize: physical, fetchWindowIcons: false })
    const grabMs = Date.now() - started
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || (sources.length === 1 ? sources[0] : null)
    const img = source && source.thumbnail
    if (!img || typeof img.toBitmap !== 'function' || img.isEmpty()) {
      log('freeze:no-image', { sources: sources.length, displayId: display.id, ids: sources.map((s) => s.display_id) })
      return false
    }
    const frozen = nativeImageToPixels(img)
    log('freeze:grab', { after, display: { id: display.id, bounds: display.bounds, scale: display.scaleFactor }, size: [frozen.width, frozen.height], grabMs, totalMs: Date.now() - started })
    this.open({ mode: 'select', after, frozen, display: { bounds: display.bounds, scaleFactor: display.scaleFactor }, fromCapture: true })
    return true
  },

  // ZTools 原生截图
  async captureNative(after, fromSearch) {
    const log = services.debugLog
    const zt = window.ztools
    try {
      log('capture:start', { after, fromSearch })
      // 用户框选期间提前加载截图窗口
      if (after !== 'ocr') this.ensureSpare()
      if (fromSearch) {
        // 从搜索框启动时主窗口可见：先隐藏，等窗口完全消失再截图。快捷键启动时主窗口本就隐藏，无需等待
        await zt.hideMainWindow()
        await sleep(250)
      }
      const started = Date.now()
      let result = null
      // screenCapture 内部出错时 await 会抛出，避免流程静默卡住
      await zt.screenCapture((image, bounds) => {
        result = { image, bounds }
      })
      const captureTime = Date.now()
      const ms = captureTime - started
      const image = result && result.image
      log('capture:result', { ms, hasImage: !!image, length: image ? image.length : 0, bounds: result && result.bounds })
      if (!image) {
        // 几乎立即返回且没有图片，通常是截图没能启动（如缺少屏幕录制权限），用户取消时则不提示
        if (ms < 800) this.notifyFailure('截图没有启动')
        return
      }
      const size = await imageSize(image)
      if (!size) return log('capture:bad-image')
      const rect = this.captureRect(size, result.bounds) || this.centerRect(size).rect
      const target = this.sharpTarget(size, rect)
      const epoch = this.copyEpoch

      if (after === 'ocr') {
        const pixels = target ? await this.sharpenWithLog(image, size, target, captureTime) : null
        return this.gotoClipboard(pixels ? this.saveSharpened(image, pixels, captureTime, epoch) : image, true)
      }
      // 先打开窗口：窗口按 target 用 GPU 快速缩小显示；主页面随后反推出清晰像素再替换进去
      const id = this.open({ image, target, rect, mode: after === 'pin' ? 'pin' : 'edit', baseSize: { width: rect.width, height: rect.height }, fromCapture: true })
      if (!target) return
      const pixels = await this.sharpenWithLog(image, size, target, captureTime)
      const entry = this.windows.get(id)
      if (!entry) return this.saveSharpened(image, pixels, captureTime, epoch) // 窗口已关闭
      // 反推结果比快速缩放更清晰，替换窗口中的图片；快速缩放与窗口显示的一致，无需替换
      if (pixels.method === 'invert') this.updateBase(entry, pixels)
      // 清晰版写入剪贴板和历史放到窗口显示之后，避免拖慢窗口出现
      entry.history = { image, pixels, time: captureTime, epoch }
      if (entry.shown) this.flushHistory(entry)
    } catch (e) {
      log('capture:error', String((e && e.stack) || e))
      this.notifyFailure('截图失败：' + ((e && e.message) || e))
    }
  },

  async sharpenWithLog(image, size, target, captureTime) {
    const pixels = await sharpenScreenshot(image, size, target)
    services.debugLog('capture:sharpen', { from: size, to: target, method: pixels.method, residual: pixels.residual, ms: Date.now() - captureTime })
    return pixels
  },

  // 把清晰像素交给截图窗口：初始化消息还没发出时直接放进去，否则单独发送替换
  updateBase(entry, pixels) {
    if (entry.init) {
      entry.init.pixels = pixels
      entry.init.image = null
    } else {
      entry.win.webContents.send('shot', { type: 'base', pixels: { width: pixels.width, height: pixels.height, data: pixels.data } })
    }
  },

  // 图片像素密度高于所在屏幕时返回屏幕实际像素尺寸，否则返回 null
  sharpTarget(size, rect) {
    const center = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
    const scale = window.ztools.getDisplayNearestPoint(center).scaleFactor || 1
    const target = { width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }
    return size.width > target.width * 1.05 ? target : null
  },

  // 用清晰版替换历史中的 ZTools 原始截图，并放回截图时间对应的位置；
  // 期间用户已经复制了别的内容（如标注后的图）时，不再覆盖剪贴板
  saveSharpened(image, pixels, time, epoch) {
    const started = Date.now()
    const png = pixelsToDataUrl(pixels)
    if (epoch === this.copyEpoch) window.ztools.copyImage(png)
    services.replaceImageData(image, png, time)
    services.debugLog('capture:history', { ms: Date.now() - started, copied: epoch === this.copyEpoch })
    return png
  },

  // 截图存入历史后识别文字及位置。所用 OCR 服务不提供位置时关闭截图窗口，改在剪贴板的分词界面中打开
  async recognize(id, entry, png) {
    const send = (data) => this.windows.has(id) && entry.win.webContents.send('shot', { type: 'ocr', ...data })
    const item = services.addImageData(png)
    if (!item) return send({ error: '无法读取截图' })
    entry.ocrItemId = item.id
    const started = Date.now()
    try {
      const result = await Actions.recognizeLayout(item)
      services.debugLog('ocr:layout', { ms: Date.now() - started, lines: result.lines ? result.lines.length : null })
      if (!this.windows.has(id)) return
      if (!result.lines) {
        if (!result.text || !result.text.trim()) return send({ error: '未识别到文字' })
        this.close(id)
        return this.focusInClipboard({ id: item.id, text: result.text, notice: '当前 OCR 服务未提供文字位置，已在分词界面中打开' })
      }
      const layout = layoutTokens(result)
      if (!layout.tokens.length) return send({ error: '未识别到文字' })
      send(layout)
    } catch (e) {
      services.debugLog('ocr:error', String((e && e.stack) || e))
      send({ error: 'OCR 文字识别失败：' + ((e && e.message) || e) })
    }
  },

  // 截图窗口显示后退出插件（插件进程因截图窗口仍在而继续运行）。
  // ZTools 在插件仍是当前插件时会跳过同一指令的再次触发（日志「同文本指令重入，跳过 onPluginEnter」），
  // 不退出的话关掉截图窗口后再按同一个截图快捷键没有反应。
  // 退出时 ZTools 会把焦点交给主窗口，随后把焦点还给截图窗口
  leavePlugin(win) {
    const started = Date.now()
    Promise.resolve(window.ztools.outPlugin())
      .catch(() => {})
      .then(() => {
        try { win.focus() } catch {}
        services.debugLog('plugin:out', { ms: Date.now() - started })
      })
  },

  notifyFailure(title) {
    const hint = window.ztools.isMacOS()
      ? '请在「系统设置 → 隐私与安全性 → 屏幕录制」中允许 ZTools，然后重启 ZTools'
      : '请确认系统允许 ZTools 截取屏幕'
    window.ztools.showNotification(`${title}。${hint}`)
  },

  // 从剪贴板历史中的图片打开贴图 / 标注
  async openItem(item, mode) {
    const image = services.imageUrl(item)
    const { rect, base } = this.centerRect({ width: item.width, height: item.height })
    await window.ztools.hideMainWindow()
    this.open({ image, rect, mode, baseSize: base })
  },

  // 截图区域转为屏幕坐标（DIP）。Windows 高分屏下区域可能是物理像素，此时图片与区域等宽
  captureRect(size, bounds) {
    if (!bounds || !bounds.width || !bounds.height) return null
    const zt = window.ztools
    const display = zt.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) })
    const physical = Math.abs(size.width / bounds.width - 1) < 0.05 && display.scaleFactor > 1.05
    if (!physical) return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    const p = zt.screenToDipPoint({ x: bounds.x, y: bounds.y })
    const scale = zt.getDisplayNearestPoint(p).scaleFactor
    return { x: p.x, y: p.y, width: bounds.width / scale, height: bounds.height / scale }
  },

  // 在鼠标所在屏幕居中显示，过大时缩小到工作区的 80%
  centerRect(size) {
    const zt = window.ztools
    const display = zt.getDisplayNearestPoint(zt.getCursorScreenPoint())
    const wa = display.workArea
    const base = { width: size.width / display.scaleFactor, height: size.height / display.scaleFactor }
    const fit = Math.min(1, (wa.width * 0.8) / base.width, (wa.height * 0.8) / base.height)
    const width = base.width * fit
    const height = base.height * fit
    return { rect: { x: wa.x + (wa.width - width) / 2, y: wa.y + (wa.height - height) / 2, width, height }, base }
  },

  // 创建隐藏的截图窗口；初始位置不重要，窗口收到 init 后自行布局再显示
  createWindow() {
    const win = window.ztools.createBrowserWindow('capture.html', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // 允许窗口覆盖整块屏幕（包括 macOS 菜单栏），用于定格全屏选区
      enableLargerThanScreen: true,
      title: '截图',
      webPreferences: { preload: 'capture-preload.js' }
    })
    const id = win.webContents.id
    this.windows.set(id, { win, ready: false, init: null, history: null })
    services.debugLog('window:created', { id })
    return id
  },

  ensureSpare() {
    if (this.spare && this.windows.has(this.spare)) return
    this.spare = this.createWindow()
  },

  // init: { image, target, rect, mode, baseSize }，image 可由 pixels（已还原的清晰像素）代替
  open(init) {
    let id = this.spare
    this.spare = null
    if (!id || !this.windows.has(id)) id = this.createWindow()
    const entry = this.windows.get(id)
    const { fromCapture, ...rest } = init
    entry.fromCapture = !!fromCapture
    entry.mode = rest.mode
    entry.init = { ...rest, winId: entry.win.id }
    services.debugLog('window:open', { id, mode: init.mode, after: init.after, preloaded: entry.ready })
    if (entry.ready) this.sendInit(entry)
    return id
  },

  sendInit(entry) {
    const { pixels, frozen, ...rest } = entry.init
    const plain = (p) => p && { width: p.width, height: p.height, data: p.data }
    // 像素数据直接通过进程间通信传给截图窗口，不必先编码成 PNG
    entry.win.webContents.send('shot', { type: 'init', ...rest, pixels: plain(pixels), frozen: plain(frozen) })
    entry.init = null
  },

  close(id) {
    const entry = this.windows.get(id)
    if (!entry) return
    this.windows.delete(id)
    this.flushHistory(entry)
    try { entry.win.close() } catch {}
  },

  flushHistory(entry) {
    const job = entry.history
    if (!job) return
    entry.history = null
    this.saveSharpened(job.image, job.pixels, job.time, job.epoch)
  },

  onMessage(id, msg) {
    const entry = this.windows.get(id)
    if (msg.type !== 'win' || msg.op !== 'setBounds') services.debugLog('window:message', { id, type: msg.type, op: msg.op, message: msg.message, known: !!entry })
    if (!entry) return
    const { win } = entry
    switch (msg.type) {
      case 'ready':
        entry.ready = true
        if (entry.init) this.sendInit(entry)
        return
      case 'win':
        if (msg.op === 'show') {
          win.show()
          win.focus()
          entry.shown = true
          if (entry.fromCapture) this.leavePlugin(win)
          // 窗口显示后再生成清晰版写入剪贴板和历史；下一次截图的窗口也在此之后预先加载
          setTimeout(() => {
            this.flushHistory(entry)
            this.ensureSpare()
          }, 50)
        } else if (msg.op === 'close') {
          this.close(id)
        } else if (SHOT_WINDOW_OPS.has(msg.op)) {
          win[msg.op](...(msg.args || []))
        }
        return
      case 'mode':
        entry.mode = msg.mode
        return
      case 'copy':
        this.copyEpoch++
        window.ztools.copyImage(msg.png)
        services.addImageData(msg.png)
        if (msg.close) this.close(id)
        return
      case 'save': {
        // 截图窗口置顶，保存对话框可能被挡住，先隐藏
        win.hide()
        let saved = false
        try {
          saved = services.saveImageData(msg.png)
        } catch (e) {
          console.error('[screenshot] save failed', e)
        }
        if (saved && msg.close) this.close(id)
        else win.show()
        return
      }
      case 'goto':
        if (msg.close) this.close(id)
        this.gotoClipboard(msg.png, msg.ocr)
        return
      // 在截图上识别文字：结果（每个词的位置）发回截图窗口显示
      case 'ocr':
        this.recognize(id, entry, msg.png)
        return
      case 'ocr-copy':
        services.copyText(msg.text)
        return
      case 'ocr-paste':
        this.close(id)
        // 等截图窗口关闭、焦点回到之前的应用后再粘贴
        setTimeout(() => services.pasteText(msg.text), 150)
        return
      case 'ocr-split':
        this.close(id)
        this.focusInClipboard({ id: entry.ocrItemId, text: msg.text })
        return
    }
  },

  // 写入历史并打开剪贴板选中该图片；ocr 为 true 时接着打开 OCR 分词
  gotoClipboard(png, ocr) {
    const item = services.addImageData(png)
    if (item) this.focusInClipboard({ id: item.id, ocr })
  },

  // 打开剪贴板并选中条目。focus：{ id, ocr }（ocr 为 true 时进行 OCR），
  // 或 { id, text, notice }（直接用已识别的文字打开分词界面）
  focusInClipboard(focus) {
    this.pendingFocus = focus
    window.ztools.redirect(['超级剪贴板', '超级剪贴板'])
    // 跳转没有进入插件时直接显示主窗口
    setTimeout(() => {
      if (!this.pendingFocus) return
      window.ztools.showMainWindow()
      App.applyPendingFocus()
    }, 1000)
  },

  takePendingFocus() {
    const focus = this.pendingFocus
    this.pendingFocus = null
    return focus
  }
}
