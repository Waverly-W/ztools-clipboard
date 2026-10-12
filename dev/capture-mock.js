// 浏览器预览截图窗口：模拟 shotHost 与 ztools，页面本身充当截图窗口
;(function () {
  window.__shot = { sent: [] }
  let handler = null
  const params = new URLSearchParams(location.search)
  const mode = params.get('mode') || 'edit'
  const rect = { x: +(params.get('x') || 120), y: +(params.get('y') || 60), width: +(params.get('w') || 420), height: +(params.get('h') || 260) }
  function sampleImage() {
    const c = document.createElement('canvas')
    c.width = rect.width * 2
    c.height = rect.height * 2
    const g = c.getContext('2d')
    g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#1f2329'; g.font = '36px sans-serif'
    g.fillText('订单号 2024-1012-8848', 40, 90)
    g.fillText('联系电话 138-1234-5678', 40, 160)
    g.fillStyle = '#3b82f6'; g.fillRect(40, 220, 300, 120)
    g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(640, 300, 110, 0, Math.PI * 2); g.fill()
    return c.toDataURL('image/png')
  }
  window.shotHost = {
    send(type, payload = {}) {
      window.__shot.sent.push({ type, ...payload, png: payload.png ? payload.png.slice(0, 30) : undefined })
      if (type === 'ready') setTimeout(() => handler({ type: 'init', image: sampleImage(), rect, mode, baseSize: { width: rect.width, height: rect.height }, target: params.get('target') ? { width: rect.width, height: rect.height } : null, winId: 7 }))
      if (type === 'win' && payload.op === 'setBounds') {
        const b = payload.args[0]
        window.__shot.bounds = b
        // 用虚线框表示窗口范围
        document.documentElement.style.outline = '1px dashed #999'
        document.documentElement.style.width = b.width + 'px'
        document.documentElement.style.height = b.height + 'px'
      }
    },
    on(fn) { handler = fn; window.__shotHandler = fn },
    setWindowId(id) { window.__shot.winId = id },
    windowOp(op, ...args) { this.send('win', { op, args }) }
  }
  window.ztools = {
    isDarkColors: () => params.get('dark') === '1',
    getDisplayNearestPoint: () => ({ scaleFactor: 2, workArea: { x: 0, y: 0, width: +(params.get('ww') || 1440), height: +(params.get('wh') || 900) } })
  }
})()
