// 截图：调用 ZTools 截图，打开标注 / 贴图窗口，并与剪贴板历史联动
// 截图窗口只负责界面，复制、保存、写入历史、跳转都在插件主页面完成
const SHOT_WINDOW_OPS = new Set(['setBounds', 'setOpacity', 'setAlwaysOnTop', 'focus'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function imageSize(src) {
  const img = await loadImg(src)
  return img && { width: img.naturalWidth, height: img.naturalHeight }
}

// 高质量缩小。整数倍（如 2:1）时每个目标像素正好取源图 r×r 区域的平均值，与面积平均一致
async function downscaleImage(src, w, h) {
  const img = await loadImg(src)
  if (!img) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

const Shot = {
  windows: new Map(), // webContents.id → { win, init }
  pendingFocus: null, // 跳转剪贴板后要选中的条目 { id, ocr }

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
  async capture(after = 'edit') {
    const log = services.debugLog
    const zt = window.ztools
    try {
      log('capture:start', { after, hidden: document.hidden, hasApi: typeof zt.screenCapture })
      if (!document.hidden) {
        // 从搜索框启动时先隐藏主窗口，等窗口完全消失再截图
        await zt.hideMainWindow()
        await sleep(250)
      }
      const started = Date.now()
      let result = null
      // screenCapture 内部出错时 await 会抛出，避免流程静默卡住
      await zt.screenCapture((image, bounds) => {
        result = { image, bounds }
      })
      const ms = Date.now() - started
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
      if (after === 'ocr') return this.gotoClipboard((target && (await this.sharpen(image, size, target))) || image, true)
      log('capture:open', { size, rect, target })
      // 截图窗口自己按 target 缩小显示，先打开窗口；剪贴板和历史中的清晰版随后生成
      this.open(image, rect, after === 'pin' ? 'pin' : 'edit', { width: rect.width, height: rect.height }, target)
      if (target) await this.sharpen(image, size, target)
    } catch (e) {
      log('capture:error', String((e && e.stack) || e))
      this.notifyFailure('截图失败：' + ((e && e.message) || e))
    }
  },

  // 混合缩放比例的多屏环境下，ZTools 可能按高倍率放大低倍率屏幕的截图，导致发虚。
  // 图片像素密度高于所在屏幕时返回屏幕实际像素尺寸，否则返回 null
  sharpTarget(size, rect) {
    const center = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
    const scale = window.ztools.getDisplayNearestPoint(center).scaleFactor || 1
    const target = { width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }
    return size.width > target.width * 1.05 ? target : null
  },

  // 生成清晰版并替换剪贴板与历史中的原始截图
  async sharpen(image, size, target) {
    const started = Date.now()
    const sharp = await downscaleImage(image, target.width, target.height)
    if (!sharp) return null
    window.ztools.copyImage(sharp)
    services.replaceImageData(image, sharp)
    services.debugLog('capture:sharpen', { from: size, to: target, ms: Date.now() - started })
    return sharp
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

  // target：显示用的像素尺寸，图片更大时截图窗口会先高质量缩小
  open(image, rect, mode, baseSize, target = null) {
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
    this.windows.set(win.webContents.id, { win, init: { image, rect, mode, baseSize, target, winId: win.id } })
    services.debugLog('window:created', { id: win.webContents.id, mode })
  },

  close(id) {
    const entry = this.windows.get(id)
    if (!entry) return
    this.windows.delete(id)
    try { entry.win.close() } catch {}
  },

  onMessage(id, msg) {
    const entry = this.windows.get(id)
    if (msg.type !== 'win' || msg.op !== 'setBounds') services.debugLog('window:message', { id, type: msg.type, op: msg.op, message: msg.message, known: !!entry })
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
