// 截图：调用 ZTools 截图，打开标注 / 贴图窗口，并与剪贴板历史联动
// 截图窗口只负责界面，复制、保存、写入历史、跳转都在插件主页面完成
const SHOT_WINDOW_OPS = new Set(['setBounds', 'setOpacity', 'setAlwaysOnTop', 'focus'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function imageSize(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const Shot = {
  windows: new Map(), // webContents.id → { win, init }
  pendingFocus: null, // 跳转剪贴板后要选中的条目 { id, ocr }

  init() {
    services.onShotMessage((id, msg) => {
      try {
        this.onMessage(id, msg)
      } catch (e) {
        console.error('[screenshot]', e)
      }
    })
  },

  // after: edit 进入标注；pin 直接贴图；ocr 直接识别文字
  async capture(after = 'edit') {
    const zt = window.ztools
    if (!document.hidden) {
      // 从搜索框启动时先隐藏主窗口，等窗口完全消失再截图
      await zt.hideMainWindow()
      await sleep(250)
    }
    const { image, bounds } = await new Promise((resolve) => zt.screenCapture((image, bounds) => resolve({ image, bounds })))
    if (!image) return
    if (after === 'ocr') return this.gotoClipboard(image, true)
    const size = await imageSize(image)
    if (!size) return
    const rect = this.captureRect(size, bounds) || this.centerRect(size).rect
    this.open(image, rect, after === 'pin' ? 'pin' : 'edit', { width: rect.width, height: rect.height })
  },

  // 从剪贴板历史中的图片打开贴图 / 标注
  async openItem(item, mode) {
    const image = services.imageUrl(item)
    const { rect, base } = this.centerRect({ width: item.width, height: item.height })
    await window.ztools.hideMainWindow()
    this.open(image, rect, mode, base)
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

  open(image, rect, mode, baseSize) {
    const win = window.ztools.createBrowserWindow('capture.html', {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
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
      title: mode === 'pin' ? '贴图' : '截图',
      webPreferences: { preload: 'capture-preload.js' }
    })
    this.windows.set(win.webContents.id, { win, init: { image, rect, mode, baseSize } })
  },

  close(id) {
    const entry = this.windows.get(id)
    if (!entry) return
    this.windows.delete(id)
    try { entry.win.close() } catch {}
  },

  onMessage(id, msg) {
    const entry = this.windows.get(id)
    if (!entry) return
    const { win } = entry
    switch (msg.type) {
      case 'ready':
        win.webContents.send('shot', { type: 'init', ...entry.init })
        return
      case 'win':
        if (msg.op === 'show') {
          win.show()
          win.focus()
        } else if (msg.op === 'close') {
          this.close(id)
        } else if (SHOT_WINDOW_OPS.has(msg.op)) {
          win[msg.op](...(msg.args || []))
        }
        return
      case 'copy':
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
    }
  },

  // 写入历史并打开剪贴板选中该图片；ocr 为 true 时接着打开 OCR 分词
  gotoClipboard(png, ocr) {
    const item = services.addImageData(png)
    if (!item) return
    this.pendingFocus = { id: item.id, ocr }
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
