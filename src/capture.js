// 截图窗口：标注编辑（edit）与贴图（pin）两种模式共用一个窗口，切换时保留标注
// 坐标约定：rect / win 为屏幕坐标（DIP）；标注图形保存为图片像素坐标
const $ = (sel) => document.querySelector(sel)
const host = window.shotHost
const zt = () => window.ztools

const TOOLBAR_W = 588
const TOOLBAR_H = 76
const GAP = 6
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#000000', '#ffffff']
// 各尺寸档位（CSS 像素）：线宽、文字字号、序号半径、马赛克块大小
const SIZE_LEVELS = { line: [2, 4, 6], font: [14, 20, 28], radius: [10, 13, 17], block: [6, 10, 16] }
const TOOLS = [
  ['rect', '矩形', 'R'],
  ['ellipse', '椭圆', 'E'],
  ['arrow', '箭头', 'A'],
  ['pen', '画笔', 'P'],
  ['marker', '荧光笔', 'H'],
  ['mosaic', '马赛克', 'M'],
  ['text', '文字', 'T'],
  ['number', '序号', 'N']
]
const ACTIONS = [
  ['jump', 'clipboard', '跳转剪贴板', 'Ctrl+J'],
  ['ocr', 'ocr', 'OCR 分词', 'Ctrl+O'],
  ['save', 'save', '保存', 'Ctrl+S'],
  ['pin', 'pin', '贴图', 'Ctrl+T']
]

const S = {
  mode: 'edit',
  base: null,
  natW: 0,
  natH: 0,
  baseSize: null, // 100% 显示时的大小
  rect: null, // 图片在屏幕上的位置
  win: null, // 窗口在屏幕上的位置
  tool: null,
  color: COLORS[0],
  size: 1,
  shapes: [],
  redo: [],
  drawing: null,
  text: null, // 正在输入的文字 { x, y, fontSize, color }
  drag: null,
  opacity: 1,
  top: true,
  menuOpen: false
}

const canvas = $('#canvas')
const ctx = canvas.getContext('2d')
const overlay = $('#overlay')
const overlayCtx = overlay.getContext('2d')
const textInput = $('#text-input')

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) })
const union = (a, b) => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
// 图片像素 / CSS 像素
const k = () => S.natW / S.rect.width

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function workArea() {
  const center = { x: Math.round(S.rect.x + S.rect.width / 2), y: Math.round(S.rect.y + S.rect.height / 2) }
  return zt().getDisplayNearestPoint(center).workArea
}

let tipTimer = null
function tip(text) {
  const el = $('#tip')
  el.textContent = text
  el.classList.remove('hidden')
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => el.classList.add('hidden'), 1200)
}

// ---------- 窗口与布局 ----------
// 拖动、缩放时每帧最多调整一次窗口；窗口显示前 requestAnimationFrame 不会执行，此时直接调整
let windowFrame = 0
function applyWindow() {
  if (!S.shown) return host.windowOp('setBounds', S.win)
  if (windowFrame) return
  windowFrame = requestAnimationFrame(() => {
    windowFrame = 0
    host.windowOp('setBounds', S.win)
  })
}

function place(el, rect) {
  el.style.left = rect.x - S.win.x + 'px'
  el.style.top = rect.y - S.win.y + 'px'
  el.style.width = rect.width + 'px'
  el.style.height = rect.height + 'px'
}

function setWindow(bounds, toolbar) {
  S.rect = roundRect(S.rect)
  // 定格全屏时窗口始终铺满屏幕，选区外显示变暗的定格画面
  if (!S.overlay) S.win = roundRect(bounds)
  place($('#stage'), S.rect)
  const bar = $('#toolbar')
  bar.classList.toggle('hidden', !toolbar)
  if (toolbar) place(bar, toolbar)
  if (S.overlay) placeDim({ x: S.rect.x - S.win.x, y: S.rect.y - S.win.y, width: S.rect.width, height: S.rect.height })
  else applyWindow()
}

// 工具栏默认在图片下方右对齐；下方放不下时放到上方，都放不下时放在图片内
function layoutEdit() {
  let wa = workArea()
  // 定格全屏时工具栏还要限制在截图窗口（整块屏幕）内
  if (S.overlay) {
    const x = Math.max(wa.x, S.win.x)
    const y = Math.max(wa.y, S.win.y)
    wa = { x, y, width: Math.min(wa.x + wa.width, S.win.x + S.win.width) - x, height: Math.min(wa.y + wa.height, S.win.y + S.win.height) - y }
  }
  const r = S.rect
  const x = clamp(r.x + r.width - TOOLBAR_W, wa.x, wa.x + wa.width - TOOLBAR_W)
  let y
  if (r.y + r.height + GAP + TOOLBAR_H <= wa.y + wa.height) y = r.y + r.height + GAP
  else if (r.y - GAP - TOOLBAR_H >= wa.y) y = r.y - GAP - TOOLBAR_H
  else y = r.y + r.height - TOOLBAR_H - GAP
  const toolbar = { x, y, width: TOOLBAR_W, height: TOOLBAR_H }
  setWindow(union(r, toolbar), toolbar)
}

// 贴图窗口与图片同大；右键菜单超出图片时临时扩大窗口
function layoutPin(extra) {
  setWindow(extra ? union(S.rect, extra) : S.rect)
}

function setMode(mode) {
  if (mode === 'pin' && S.overlay) leaveOverlay()
  S.mode = mode
  host.send('mode', { mode })
  commitText()
  closeMenu(false)
  if (mode === 'pin') S.tool = null
  document.body.dataset.mode = mode
  if (mode === 'edit') {
    renderToolbar()
    layoutEdit()
  } else {
    layoutPin()
  }
  render()
  host.windowOp('setAlwaysOnTop', mode === 'edit' || S.top, mode === 'edit' ? 'screen-saver' : 'floating')
  host.windowOp('focus')
}

// ---------- 绘制 ----------
const pixelCanvas = document.createElement('canvas')

function pixelate(c, x, y, w, h, block) {
  if (w < 1 || h < 1) return
  const sw = Math.max(1, Math.round(w / block))
  const sh = Math.max(1, Math.round(h / block))
  pixelCanvas.width = sw
  pixelCanvas.height = sh
  pixelCanvas.getContext('2d').drawImage(S.base, x, y, w, h, 0, 0, sw, sh)
  c.imageSmoothingEnabled = false
  c.drawImage(pixelCanvas, 0, 0, sw, sh, x, y, w, h)
  c.imageSmoothingEnabled = true
}

function strokePath(c, points) {
  c.beginPath()
  c.moveTo(points[0].x, points[0].y)
  if (points.length === 1) c.lineTo(points[0].x + 0.1, points[0].y)
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    c.quadraticCurveTo(points[i].x, points[i].y, mx, my)
  }
  if (points.length > 1) c.lineTo(points[points.length - 1].x, points[points.length - 1].y)
  c.stroke()
}

function drawShape(c, s) {
  const x = Math.min(s.x1, s.x2)
  const y = Math.min(s.y1, s.y2)
  const w = Math.abs(s.x2 - s.x1)
  const h = Math.abs(s.y2 - s.y1)
  c.save()
  c.strokeStyle = c.fillStyle = s.color
  c.lineWidth = s.w
  c.lineCap = c.lineJoin = 'round'
  switch (s.type) {
    case 'rect':
      c.strokeRect(x, y, w, h)
      break
    case 'ellipse':
      c.beginPath()
      c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      c.stroke()
      break
    case 'arrow': {
      const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const head = s.w * 3 + 8 * s.k
      const bx = s.x2 - head * Math.cos(angle) * 0.8
      const by = s.y2 - head * Math.sin(angle) * 0.8
      c.beginPath()
      c.moveTo(s.x1, s.y1)
      c.lineTo(bx, by)
      c.stroke()
      c.beginPath()
      c.moveTo(s.x2, s.y2)
      c.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 7), s.y2 - head * Math.sin(angle - Math.PI / 7))
      c.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 7), s.y2 - head * Math.sin(angle + Math.PI / 7))
      c.closePath()
      c.fill()
      break
    }
    case 'pen':
      strokePath(c, s.points)
      break
    case 'marker':
      c.globalAlpha = 0.35
      c.lineWidth = s.w * 4
      c.lineCap = 'butt'
      strokePath(c, s.points)
      break
    case 'mosaic':
      pixelate(c, x, y, w, h, s.block)
      break
    case 'text':
      c.font = `${s.fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
      c.textBaseline = 'top'
      s.text.split('\n').forEach((line, i) => c.fillText(line, s.x, s.y + i * s.fontSize * 1.3))
      break
    case 'number':
      c.beginPath()
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = s.color === '#ffffff' || s.color === '#ffcc00' ? '#000' : '#fff'
      c.font = `bold ${s.r * 1.2}px -apple-system, Arial, sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(String(s.n), s.x, s.y + s.r * 0.06)
      break
  }
  c.restore()
}

// 两层画布：canvas 保存图片和已完成的标注，只在标注增删时更新；
// overlay 叠在上面，只画正在绘制的图形。移动鼠标时只需清空并重画 overlay
function rebuildLayer() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(S.base, 0, 0)
  for (const s of S.shapes) drawShape(ctx, s)
}

function render() {
  if (!S.base) return
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
  if (S.drawing) drawShape(overlayCtx, S.drawing)
}

// 鼠标移动时合并到下一帧绘制
let renderFrame = 0
function scheduleRender() {
  if (renderFrame) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0
    render()
  })
}

function exportPng() {
  commitText()
  return canvas.toDataURL('image/png')
}

function pushShape(shape) {
  S.shapes.push(shape)
  S.redo = []
  drawShape(ctx, shape)
  render()
  renderToolbar()
}

function undo() {
  if (!S.shapes.length) return
  S.redo.push(S.shapes.pop())
  rebuildLayer()
  render()
  renderToolbar()
}

function redo() {
  if (!S.redo.length) return
  const shape = S.redo.pop()
  S.shapes.push(shape)
  drawShape(ctx, shape)
  render()
  renderToolbar()
}

// ---------- 标注交互 ----------
function toImage(e) {
  const r = canvas.getBoundingClientRect()
  return { x: ((e.clientX - r.left) * S.natW) / r.width, y: ((e.clientY - r.top) * S.natH) / r.height }
}

// Shift：矩形 / 椭圆 / 马赛克取正方形，箭头按 45° 吸附
function constrain(s, shift) {
  if (!shift) return
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  if (s.type === 'arrow') {
    const len = Math.hypot(dx, dy)
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    s.x2 = s.x1 + len * Math.cos(angle)
    s.y2 = s.y1 + len * Math.sin(angle)
  } else if (['rect', 'ellipse', 'mosaic'].includes(s.type)) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    s.x2 = s.x1 + Math.sign(dx || 1) * size
    s.y2 = s.y1 + Math.sign(dy || 1) * size
  }
}

function openText(e) {
  commitText()
  const p = toImage(e)
  const css = SIZE_LEVELS.font[S.size]
  S.text = { x: p.x, y: p.y, fontSize: css * k(), color: S.color }
  const r = canvas.getBoundingClientRect()
  const stage = $('#stage').getBoundingClientRect()
  Object.assign(textInput.style, {
    left: e.clientX - stage.left + 'px',
    top: e.clientY - stage.top + 'px',
    fontSize: css + 'px',
    color: S.color,
    maxWidth: Math.max(60, r.right - e.clientX) + 'px'
  })
  textInput.value = ''
  textInput.classList.remove('hidden')
  autosizeText()
  textInput.focus()
  // 部分平台点击结束后焦点会回到页面，再聚焦一次
  setTimeout(() => S.text && textInput.focus())
}

function autosizeText() {
  textInput.style.height = 'auto'
  textInput.style.height = textInput.scrollHeight + 'px'
  textInput.style.width = 'auto'
  textInput.style.width = Math.max(40, textInput.scrollWidth + 4) + 'px'
}

// 关闭输入框时主动失焦，否则隐藏的输入框仍会吞掉后续快捷键
function hideTextInput() {
  textInput.blur()
  textInput.classList.add('hidden')
}

function commitText() {
  if (!S.text) return
  const text = textInput.value.replace(/\s+$/, '')
  const t = S.text
  S.text = null
  hideTextInput()
  if (text) pushShape({ type: 'text', x: t.x, y: t.y, fontSize: t.fontSize, color: t.color, text })
}

function cancelText() {
  S.text = null
  hideTextInput()
}

textInput.addEventListener('input', autosizeText)
textInput.addEventListener('blur', commitText)
textInput.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Escape') cancelText()
  else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    commitText()
  }
})

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (S.mode === 'pin') return startDrag(e)
  if (!S.tool) return
  if (S.tool === 'text') {
    e.preventDefault()
    return openText(e)
  }
  commitText()
  const p = toImage(e)
  const scale = k()
  if (S.tool === 'number') {
    const n = S.shapes.filter((s) => s.type === 'number').length + 1
    return pushShape({ type: 'number', x: p.x, y: p.y, r: SIZE_LEVELS.radius[S.size] * scale, color: S.color, n })
  }
  S.drawing = {
    type: S.tool,
    color: S.color,
    k: scale,
    w: SIZE_LEVELS.line[S.size] * scale,
    block: SIZE_LEVELS.block[S.size] * scale,
    x1: p.x,
    y1: p.y,
    x2: p.x,
    y2: p.y,
    points: [p]
  }
  canvas.setPointerCapture(e.pointerId)
})

canvas.addEventListener('pointermove', (e) => {
  if (S.drag) return moveDrag(e)
  if (!S.drawing) return
  const p = toImage(e)
  if (S.drawing.type === 'pen' || S.drawing.type === 'marker') S.drawing.points.push(p)
  else {
    S.drawing.x2 = p.x
    S.drawing.y2 = p.y
    constrain(S.drawing, e.shiftKey)
  }
  scheduleRender()
})

canvas.addEventListener('pointerup', () => {
  if (S.drag) {
    S.drag = null
    return
  }
  const s = S.drawing
  if (!s) return
  S.drawing = null
  const min = 3 * s.k
  const big = Math.abs(s.x2 - s.x1) > min || Math.abs(s.y2 - s.y1) > min
  const valid = s.type === 'pen' || s.type === 'marker' ? true : s.type === 'arrow' ? big : Math.abs(s.x2 - s.x1) > min && Math.abs(s.y2 - s.y1) > min
  if (valid) pushShape(s)
  else render()
})

// ---------- 贴图交互 ----------
function startDrag(e) {
  S.drag = { sx: e.screenX, sy: e.screenY, x: S.rect.x, y: S.rect.y }
  canvas.setPointerCapture(e.pointerId)
}

function moveDrag(e) {
  S.rect.x = S.drag.x + e.screenX - S.drag.sx
  S.rect.y = S.drag.y + e.screenY - S.drag.sy
  layoutPin()
}

function zoomTo(width, anchor) {
  const min = 24
  const max = S.baseSize.width * 5
  const newW = clamp(width, Math.min(min, S.rect.width), max)
  const ratio = newW / S.rect.width
  const ax = anchor ? anchor.x : S.rect.width / 2
  const ay = anchor ? anchor.y : S.rect.height / 2
  S.rect = { x: S.rect.x + ax - ax * ratio, y: S.rect.y + ay - ay * ratio, width: newW, height: S.rect.height * ratio }
  layoutPin()
  tip(Math.round((S.rect.width / S.baseSize.width) * 100) + '%')
}

canvas.addEventListener('dblclick', () => {
  if (S.mode === 'pin') close()
})

window.addEventListener('wheel', (e) => {
  if (S.mode !== 'pin' || S.menuOpen) return
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    setOpacity(S.opacity + (e.deltaY < 0 ? 0.1 : -0.1))
    return
  }
  const r = canvas.getBoundingClientRect()
  zoomTo(S.rect.width * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - r.left, y: e.clientY - r.top })
}, { passive: false })

function setOpacity(v) {
  S.opacity = Math.round(clamp(v, 0.2, 1) * 10) / 10
  host.windowOp('setOpacity', S.opacity)
  tip(`透明度 ${Math.round(S.opacity * 100)}%`)
}

function toggleTop() {
  S.top = !S.top
  host.windowOp('setAlwaysOnTop', S.top, 'floating')
  tip(S.top ? '已置顶' : '已取消置顶')
}

// ---------- 右键菜单（贴图） ----------
function menuItems() {
  return [
    ['copy', '复制', 'Ctrl+C'],
    ['save', '保存', 'Ctrl+S'],
    ['ocr', 'OCR 分词', 'Ctrl+O'],
    ['edit', '继续标注', 'Ctrl+E'],
    ['jump', '跳转剪贴板', 'Ctrl+J'],
    '-',
    ['top', (S.top ? '✓ ' : '') + '置顶', ''],
    ['reset', '原始大小', '1'],
    ['opacity', '', ''],
    '-',
    ['close', '关闭', 'Esc']
  ]
}

function openMenu(e) {
  const menu = $('#menu')
  menu.innerHTML = menuItems()
    .map((m) => {
      if (m === '-') return '<div class="sep"></div>'
      if (m[0] === 'opacity') {
        return `<label class="menu-range">透明度<input type="range" min="20" max="100" step="10" value="${Math.round(S.opacity * 100)}" /></label>`
      }
      return `<div class="menu-item" data-act="${m[0]}"><span>${m[1]}</span><kbd>${m[2]}</kbd></div>`
    })
    .join('')
  menu.classList.remove('hidden')
  const { width, height } = menu.getBoundingClientRect()
  const wa = workArea()
  const x = clamp(S.win.x + e.clientX, wa.x, wa.x + wa.width - width)
  const y = clamp(S.win.y + e.clientY, wa.y, wa.y + wa.height - height)
  const menuRect = { x, y, width: Math.ceil(width), height: Math.ceil(height) }
  S.menuOpen = true
  layoutPin(menuRect)
  menu.style.left = x - S.win.x + 'px'
  menu.style.top = y - S.win.y + 'px'
}

function closeMenu(relayout = true) {
  if (!S.menuOpen) return
  S.menuOpen = false
  $('#menu').classList.add('hidden')
  if (relayout && S.mode === 'pin') layoutPin()
}

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (S.mode === 'select') return close()
  if (S.mode === 'edit' && S.overlay && !S.shapes.length && !e.target.closest('#stage, #toolbar')) return enterSelect()
  if (S.mode === 'pin' && e.target.closest('#stage')) openMenu(e)
})

$('#menu').addEventListener('click', (e) => {
  const item = e.target.closest('[data-act]')
  if (!item) return
  closeMenu()
  run(item.dataset.act)
})

$('#menu').addEventListener('input', (e) => {
  if (e.target.type === 'range') setOpacity(e.target.value / 100)
})

window.addEventListener('pointerdown', (e) => {
  if (S.menuOpen && !e.target.closest('#menu')) closeMenu()
})

window.addEventListener('blur', () => closeMenu())

// ---------- 操作 ----------
function close() {
  host.send('win', { op: 'close' })
}

function run(act) {
  const editing = S.mode === 'edit'
  switch (act) {
    case 'copy':
      host.send('copy', { png: exportPng(), close: editing })
      if (!editing) tip('已复制')
      return
    case 'save':
      return host.send('save', { png: exportPng(), close: editing })
    case 'ocr':
      return host.send('goto', { png: exportPng(), ocr: true, close: editing })
    case 'jump':
      return host.send('goto', { png: exportPng(), ocr: false, close: editing })
    case 'pin':
      return setMode('pin')
    case 'edit':
      return setMode('edit')
    case 'top':
      return toggleTop()
    case 'reset':
      return zoomTo(S.baseSize.width)
    case 'undo':
      return undo()
    case 'redo':
      return redo()
    case 'close':
      return close()
  }
}

// ---------- 工具栏 ----------
function renderToolbar() {
  if (S.mode !== 'edit') return
  const btn = (attrs, iconName, title, cls = '') => `<button class="${cls}" ${attrs} title="${title}">${icon(iconName)}</button>`
  $('#bar-main').innerHTML =
    TOOLS.map(([t, name, key]) => btn(`data-tool="${t}"`, t === 'text' ? 'text' : t, `${name} (${key})`, S.tool === t ? 'active' : '')).join('') +
    '<i class="sep"></i>' +
    btn('data-act="undo"', 'undo', '撤销 (Ctrl+Z)', S.shapes.length ? '' : 'disabled') +
    btn('data-act="redo"', 'redo', '重做 (Ctrl+Shift+Z)', S.redo.length ? '' : 'disabled') +
    '<i class="sep"></i>' +
    ACTIONS.map(([a, ic, name, key]) => btn(`data-act="${a}"`, ic, `${name} (${key})`)).join('') +
    '<i class="sep"></i>' +
    btn('data-act="close"', 'close', '取消 (Esc)', 'danger') +
    btn('data-act="copy"', 'check', '复制 (Enter)', 'primary')

  const options = $('#bar-options')
  if (!S.tool) {
    options.innerHTML = '<span class="hint">选择工具标注 · Enter 复制 · Ctrl+T 贴图 · Ctrl+O 识别文字 · Esc 取消</span>'
    return
  }
  const colors = S.tool === 'mosaic' ? '' : COLORS.map((c) => `<button class="color ${S.color === c ? 'active' : ''}" data-color="${c}" style="--c:${c}"></button>`).join('') + '<i class="sep"></i>'
  const sizes = [0, 1, 2].map((i) => `<button class="size ${S.size === i ? 'active' : ''}" data-size="${i}" title="${['小', '中', '大'][i]}"><span style="--s:${4 + i * 4}px"></span></button>`).join('')
  options.innerHTML = colors + sizes + `<span class="hint">${S.tool === 'number' || S.tool === 'text' ? '点击放置' : '拖动绘制，按住 Shift 约束形状'}</span>`
}

function setTool(tool) {
  commitText()
  S.tool = S.tool === tool ? null : tool
  document.body.dataset.tool = S.tool || ''
  renderToolbar()
}

$('#toolbar').addEventListener('click', (e) => {
  const el = e.target.closest('button')
  if (!el || el.classList.contains('disabled')) return
  if (el.dataset.tool) return setTool(el.dataset.tool)
  if (el.dataset.color) S.color = el.dataset.color
  if (el.dataset.size) S.size = +el.dataset.size
  if (el.dataset.act) return run(el.dataset.act)
  renderToolbar()
})

$('#toolbar').addEventListener('mousedown', (e) => e.preventDefault())

// ---------- 快捷键 ----------
// ZTools 注入的脚本会在 window 上监听 Esc：按键未被阻止时，它会当作「插件按 Esc 退出」交给主进程，
// 隐藏插件主页面并返回搜索页（插件已在截图窗口显示时自行退出，不需要再退一次）。截图窗口自己处理 Esc，
// 所以在事件冒泡到 window 之前（document 上）阻止默认行为，ZTools 就不会接管
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') e.preventDefault()
})

window.addEventListener('keydown', (e) => {
  if (e.isComposing) return
  const ctrl = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (key === 'escape') {
    e.preventDefault()
    if (S.menuOpen) return closeMenu()
    return close()
  }
  if (S.mode === 'select') return
  const shortcuts = {
    c: 'copy',
    s: 'save',
    o: 'ocr',
    j: 'jump',
    t: S.mode === 'edit' ? 'pin' : null,
    e: S.mode === 'pin' ? 'edit' : null,
    z: e.shiftKey ? 'redo' : 'undo',
    y: 'redo'
  }
  if (ctrl && shortcuts[key]) {
    e.preventDefault()
    if ((key === 'z' || key === 'y') && S.mode !== 'edit') return
    return run(shortcuts[key])
  }
  if (ctrl) return
  if (S.mode === 'edit') {
    if (key === 'enter') {
      e.preventDefault()
      return run('copy')
    }
    if (key === 'f3') return run('pin')
    const tool = TOOLS.find(([, , k2]) => k2.toLowerCase() === key)
    if (tool && !e.altKey) setTool(tool[0])
  } else if (key === '1') {
    zoomTo(S.baseSize.width)
  }
})

// ---------- 定格全屏选区 ----------
const frozenCanvas = $('#frozen')
const magCanvas = $('#mag-canvas')
const magCtx = magCanvas.getContext('2d')
const MAG_PIXELS = 15 // 放大镜显示的像素范围（15×15，放大 8 倍）

// 选区外变暗：用四块矩形拼出选区周围，移动选区时只改位置，几乎没有绘制开销
function placeDim(sel) {
  const W = S.win.width
  const H = S.win.height
  const r = sel || { x: 0, y: 0, width: 0, height: 0 }
  const set = (id, x, y, w, h) => Object.assign($(id).style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' })
  if (!sel) {
    set('#dim-t', 0, 0, W, H)
    set('#dim-b', 0, 0, 0, 0)
    set('#dim-l', 0, 0, 0, 0)
    set('#dim-r', 0, 0, 0, 0)
    $('#selbox').style.display = 'none'
    return
  }
  set('#dim-t', 0, 0, W, r.y)
  set('#dim-b', 0, r.y + r.height, W, H - r.y - r.height)
  set('#dim-l', 0, r.y, r.x, r.height)
  set('#dim-r', r.x + r.width, r.y, W - r.x - r.width, r.height)
  const box = $('#selbox')
  box.style.display = ''
  set('#selbox', r.x, r.y, r.width, r.height)
  const sf = S.frozenW / S.win.width
  $('#sel-info').textContent = `${Math.round(r.width * sf)} × ${Math.round(r.height * sf)}`
  box.classList.toggle('info-inside', r.y < 24)
}

function startOverlay(msg) {
  const { width, height, data } = msg.frozen
  S.frozenData = new Uint8ClampedArray(data)
  S.frozenW = width
  S.frozenH = height
  frozenCanvas.width = width
  frozenCanvas.height = height
  frozenCanvas.getContext('2d').putImageData(new ImageData(S.frozenData, width, height), 0, 0)
  S.overlay = true
  S.after = msg.after || 'edit'
  S.win = roundRect(msg.display.bounds)
  document.body.dataset.overlay = '1'
  frozenCanvas.classList.remove('hidden')
  $('#dim').classList.remove('hidden')
  enterSelect()
  host.windowOp('setBounds', S.win)
  // macOS 上不带 skipTransformProcessType 时，Electron 会把整个 ZTools 进程在「无 Dock 图标」和
  // 「普通应用」之间来回切换；ZTools 是无 Dock 图标的应用，自己的窗口也都跳过了这一步
  host.windowOp('setVisibleOnAllWorkspaces', true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  host.windowOp('setAlwaysOnTop', true, 'screen-saver')
  host.send('win', { op: 'show' })
  S.shown = true
  host.windowOp('focus')
}

function enterSelect() {
  commitText()
  S.mode = 'select'
  host.send('mode', { mode: 'select' })
  S.tool = null
  S.sel = null
  S.selStart = null
  document.body.dataset.mode = 'select'
  $('#toolbar').classList.add('hidden')
  $('#select-hint').classList.remove('hidden')
  placeDim(null)
}

function leaveOverlay() {
  S.overlay = false
  delete document.body.dataset.overlay
  frozenCanvas.classList.add('hidden')
  $('#dim').classList.add('hidden')
  $('#magnifier').classList.add('hidden')
  host.windowOp('setVisibleOnAllWorkspaces', false, { skipTransformProcessType: true })
}

function selectionFrom(a, b) {
  const W = S.win.width
  const H = S.win.height
  const x1 = clamp(Math.min(a.x, b.x), 0, W)
  const y1 = clamp(Math.min(a.y, b.y), 0, H)
  const x2 = clamp(Math.max(a.x, b.x), 0, W)
  const y2 = clamp(Math.max(a.y, b.y), 0, H)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function drawMagnifier(p) {
  const mag = $('#magnifier')
  const sf = S.frozenW / S.win.width
  const px = clamp(Math.floor(p.x * sf), 0, S.frozenW - 1)
  const py = clamp(Math.floor(p.y * sf), 0, S.frozenH - 1)
  const half = (MAG_PIXELS - 1) / 2
  const cell = magCanvas.width / MAG_PIXELS
  magCtx.imageSmoothingEnabled = false
  magCtx.fillStyle = '#000'
  magCtx.fillRect(0, 0, magCanvas.width, magCanvas.height)
  magCtx.drawImage(frozenCanvas, px - half, py - half, MAG_PIXELS, MAG_PIXELS, 0, 0, magCanvas.width, magCanvas.height)
  magCtx.strokeStyle = 'rgba(59,130,246,0.9)'
  magCtx.lineWidth = 1
  magCtx.strokeRect(half * cell + 0.5, half * cell + 0.5, cell - 1, cell - 1)
  const i = (py * S.frozenW + px) * 4
  const d = S.frozenData
  const hex = '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  $('#mag-info').textContent = `${px}, ${py}  ${hex}`
  mag.classList.remove('hidden')
  // 放在光标右下方，靠近屏幕边缘时翻到另一侧
  const w = 122
  const h = 146
  const x = p.x + 20 + w > S.win.width ? p.x - 20 - w : p.x + 20
  const y = p.y + 20 + h > S.win.height ? p.y - 20 - h : p.y + 20
  mag.style.left = x + 'px'
  mag.style.top = y + 'px'
}

// 鼠标移动合并到每帧处理一次
let selectFrame = 0
function scheduleSelect() {
  if (selectFrame) return
  selectFrame = requestAnimationFrame(() => {
    selectFrame = 0
    if (S.mode !== 'select' || !S.pointer) return
    if (S.selStart) {
      S.sel = selectionFrom(S.selStart, S.pointer)
      placeDim(S.sel)
    }
    drawMagnifier(S.pointer)
  })
}

window.addEventListener('pointerdown', (e) => {
  if (S.mode !== 'select' || e.button !== 0) return
  S.selStart = { x: e.clientX, y: e.clientY }
  S.pointer = S.selStart
  $('#select-hint').classList.add('hidden')
  try { document.body.setPointerCapture(e.pointerId) } catch {}
  scheduleSelect()
})

window.addEventListener('pointermove', (e) => {
  if (S.mode !== 'select') return
  S.pointer = { x: e.clientX, y: e.clientY }
  scheduleSelect()
})

window.addEventListener('pointerup', (e) => {
  if (S.mode !== 'select' || !S.selStart) return
  const sel = selectionFrom(S.selStart, { x: e.clientX, y: e.clientY })
  S.selStart = null
  // 太小视为误点，继续选区
  if (sel.width < 4 || sel.height < 4) return placeDim(null)
  finishSelection(sel)
})

// 从定格画面裁出选区，原地进入标注（或按启动指令直接贴图 / 识别文字）
function finishSelection(sel) {
  const sfx = S.frozenW / S.win.width
  const sfy = S.frozenH / S.win.height
  const sx = Math.round(sel.x * sfx)
  const sy = Math.round(sel.y * sfy)
  const sw = Math.max(1, Math.round(sel.width * sfx))
  const sh = Math.max(1, Math.round(sel.height * sfy))
  const crop = document.createElement('canvas')
  crop.width = sw
  crop.height = sh
  crop.getContext('2d').drawImage(frozenCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
  S.base = crop
  S.natW = sw
  S.natH = sh
  canvas.width = overlay.width = sw
  canvas.height = overlay.height = sh
  S.shapes = []
  S.redo = []
  rebuildLayer()
  S.rect = { x: S.win.x + sel.x, y: S.win.y + sel.y, width: sel.width, height: sel.height }
  S.baseSize = { width: sel.width, height: sel.height }
  $('#magnifier').classList.add('hidden')
  $('#select-hint').classList.add('hidden')
  if (S.after === 'pin') return setMode('pin')
  setMode('edit')
  if (S.after === 'ocr') run('ocr')
}

// ---------- 初始化 ----------
// 页面错误回报给插件主页面写入诊断日志
window.addEventListener('error', (e) => host.send('error', { message: `${e.message} @${e.filename}:${e.lineno}` }))
window.addEventListener('unhandledrejection', (e) => host.send('error', { message: String((e.reason && e.reason.stack) || e.reason) }))

function pixelsCanvas({ width, height, data }) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
  return c
}

host.on(async (msg) => {
  // 主页面算出的清晰图片：尺寸相同，替换后重画已完成的标注
  if (msg.type === 'base') {
    if (!S.base || msg.pixels.width !== S.natW || msg.pixels.height !== S.natH) return
    S.base = pixelsCanvas(msg.pixels)
    rebuildLayer()
    render()
    return
  }
  if (msg.type !== 'init') return
  try {
    if (zt().isDarkColors()) document.body.dataset.theme = 'dark'
  } catch {}
  host.setWindowId(msg.winId)
  if (msg.mode === 'select') return startOverlay(msg)
  if (msg.pixels) {
    // 主页面已还原为屏幕实际像素的截图，直接以像素数据传入
    S.base = pixelsCanvas(msg.pixels)
    S.natW = msg.pixels.width
    S.natH = msg.pixels.height
  } else {
    S.base = await loadImage(msg.image)
    S.natW = S.base.naturalWidth
    S.natH = S.base.naturalHeight
    // 图片像素密度高于屏幕时先用 GPU 快速缩小到屏幕实际像素显示，主页面算出更清晰的结果后会再替换
    if (msg.target && S.natW > msg.target.width * 1.05) {
      const fast = document.createElement('canvas')
      fast.width = msg.target.width
      fast.height = msg.target.height
      const fctx = fast.getContext('2d')
      fctx.imageSmoothingEnabled = true
      fctx.imageSmoothingQuality = 'high'
      fctx.drawImage(S.base, 0, 0, fast.width, fast.height)
      S.base = fast
      S.natW = fast.width
      S.natH = fast.height
    }
  }
  canvas.width = overlay.width = S.natW
  canvas.height = overlay.height = S.natH
  host.setWindowId(msg.winId)
  rebuildLayer()
  S.rect = { ...msg.rect }
  S.baseSize = msg.baseSize || { width: S.rect.width, height: S.rect.height }
  setMode(msg.mode)
  host.send('win', { op: 'show' })
  S.shown = true
})

host.send('ready')
