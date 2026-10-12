// 截图清晰化
// 混合缩放比例的多屏环境下，ZTools 会把低倍率屏幕（如 1× 外接屏）的截图用双线性插值放大到 2 倍，
// 图片因此发虚。双线性 2 倍放大是可逆的线性变换：放大后每个偶数位像素 = 0.75×原像素 + 0.25×左（上）邻，
// 奇数位 = 0.75×原像素 + 0.25×右（下）邻。据此逐行、逐列反推即可还原原始像素。
// 反推前会抽样校验图片确实符合该模型，不符合时退回高质量缩放。

// 从 PNG Data URL 的文件头读取尺寸，不需要解码整张图
function pngSize(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.startsWith('data:image/png')) return null
  const head = atob(dataUrl.slice(comma + 1, comma + 1 + 32))
  if (head.slice(12, 16) !== 'IHDR') return null
  const u32 = (i) => ((head.charCodeAt(i) << 24) | (head.charCodeAt(i + 1) << 16) | (head.charCodeAt(i + 2) << 8) | head.charCodeAt(i + 3)) >>> 0
  return { width: u32(16), height: u32(20) }
}

// 反推双线性 2 倍放大前的原图。src 为 RGBA 像素（w×h，均为偶数），返回 (w/2)×(h/2) 的 RGBA 像素。
// 每个方向前向用偶数位方程、后向用奇数位方程各推一遍再取平均，误差逐步衰减不会累积。
// 纵向按行推进（一次处理整行所有列），保证内存顺序访问
// 纵向反推的临时缓冲区在多次截图间复用，避免每次分配十几 MB 内存触发垃圾回收
let invertBuffer = null

function invertBilinear2x(src, w, h) {
  const W = w >> 1
  const H = h >> 1
  const K = 4 / 3
  const row = w * 4
  const mw = w * 3
  if (!invertBuffer || invertBuffer.length < mw * H) invertBuffer = new Float32Array(mw * H)
  const mid = invertBuffer // 纵向反推结果：H 行 × w 列 × RGB

  // 纵向前向：mid[i] = (偶数行 2i - 0.25 × mid[i-1]) × 4/3
  for (let x = 0, s = 0, m = 0; x < w; x++, s += 4, m += 3) {
    mid[m] = src[s]
    mid[m + 1] = src[s + 1]
    mid[m + 2] = src[s + 2]
  }
  for (let i = 1; i < H; i++) {
    const so = 2 * i * row
    const mo = i * mw
    const po = mo - mw
    for (let x = 0, s = so, m = 0; x < w; x++, s += 4, m += 3) {
      mid[mo + m] = (src[s] - 0.25 * mid[po + m]) * K
      mid[mo + m + 1] = (src[s + 1] - 0.25 * mid[po + m + 1]) * K
      mid[mo + m + 2] = (src[s + 2] - 0.25 * mid[po + m + 2]) * K
    }
  }
  // 纵向后向：用奇数行方程逐行反推，与前向结果取平均
  const back = new Float32Array(mw)
  {
    const so = (2 * H - 1) * row
    const mo = (H - 1) * mw
    for (let x = 0, s = so, m = 0; x < w; x++, s += 4, m += 3) {
      for (let c = 0; c < 3; c++) {
        back[m + c] = src[s + c]
        mid[mo + m + c] = (mid[mo + m + c] + back[m + c]) / 2
      }
    }
  }
  for (let i = H - 2; i >= 0; i--) {
    const so = (2 * i + 1) * row
    const mo = i * mw
    for (let x = 0, s = so, m = 0; x < w; x++, s += 4, m += 3) {
      for (let c = 0; c < 3; c++) {
        const v = (src[s + c] - 0.25 * back[m + c]) * K
        back[m + c] = v
        mid[mo + m + c] = (mid[mo + m + c] + v) / 2
      }
    }
  }

  // 横向：每行内前向、后向反推后取平均（写入 Uint8ClampedArray 时自动四舍五入并限制在 0~255）
  const out = new Uint8ClampedArray(W * H * 4)
  const f = new Float32Array(W * 3)
  for (let y = 0; y < H; y++) {
    const mo = y * mw
    const oo = y * W * 4
    f[0] = mid[mo]
    f[1] = mid[mo + 1]
    f[2] = mid[mo + 2]
    for (let i = 1; i < W; i++) {
      const m = mo + 6 * i
      f[i * 3] = (mid[m] - 0.25 * f[i * 3 - 3]) * K
      f[i * 3 + 1] = (mid[m + 1] - 0.25 * f[i * 3 - 2]) * K
      f[i * 3 + 2] = (mid[m + 2] - 0.25 * f[i * 3 - 1]) * K
    }
    let b0 = mid[mo + (2 * W - 1) * 3]
    let b1 = mid[mo + (2 * W - 1) * 3 + 1]
    let b2 = mid[mo + (2 * W - 1) * 3 + 2]
    for (let i = W - 1; i >= 0; i--) {
      if (i < W - 1) {
        const m = mo + (2 * i + 1) * 3
        b0 = (mid[m] - 0.25 * b0) * K
        b1 = (mid[m + 1] - 0.25 * b1) * K
        b2 = (mid[m + 2] - 0.25 * b2) * K
      }
      const o = oo + i * 4
      out[o] = (f[i * 3] + b0) / 2
      out[o + 1] = (f[i * 3 + 1] + b1) / 2
      out[o + 2] = (f[i * 3 + 2] + b2) / 2
      out[o + 3] = 255
    }
  }
  return out
}

// 校验：用还原结果按双线性 2 倍放大，抽样与 ZTools 的图比较，返回平均误差（0~255）
function bilinearResidual(src, w, h, out) {
  const W = w >> 1
  const H = h >> 1
  const at = (x, y, c) => out[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + c]
  let sum = 0
  let n = 0
  const step = Math.max(3, Math.floor(Math.sqrt((w * h) / 20000)))
  for (let Y = 1; Y < h - 1; Y += step) {
    const sy = (Y + 0.5) / 2 - 0.5
    const y0 = Math.floor(sy)
    const fy = sy - y0
    for (let X = 1; X < w - 1; X += step) {
      const sx = (X + 0.5) / 2 - 0.5
      const x0 = Math.floor(sx)
      const fx = sx - x0
      for (let c = 0; c < 3; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx
        const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx
        sum += Math.abs(top * (1 - fy) + bottom * fy - src[(Y * w + X) * 4 + c])
        n++
      }
    }
  }
  return n ? sum / n : Infinity
}

// 平均误差低于该值视为符合双线性放大（实测 ZTools 截图约 0.2，取样像素多为平滑区域）
const BILINEAR_MAX_RESIDUAL = 1

// ---------- 浏览器端 ----------
function loadImageElement(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// 把截图缩到目标像素尺寸，返回 { width, height, data, method }
async function sharpenScreenshot(dataUrl, size, target) {
  const img = await loadImageElement(dataUrl)
  if (!img) return null
  if (size.width === target.width * 2 && size.height === target.height * 2) {
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const src = ctx.getImageData(0, 0, size.width, size.height).data
    const out = invertBilinear2x(src, size.width, size.height)
    const residual = bilinearResidual(src, size.width, size.height, out)
    if (residual < BILINEAR_MAX_RESIDUAL) return { width: target.width, height: target.height, data: out, method: 'invert', residual }
  }
  // 不是 2 倍或不符合双线性模型：高质量缩放（2:1 时等同 2×2 面积平均）
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, target.width, target.height)
  return { width: target.width, height: target.height, data: ctx.getImageData(0, 0, target.width, target.height).data, method: 'scale' }
}

function pixelsToDataUrl(pixels) {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  return canvas.toDataURL('image/png')
}

if (typeof module !== 'undefined') module.exports = { pngSize, invertBilinear2x, bilinearResidual, BILINEAR_MAX_RESIDUAL }
