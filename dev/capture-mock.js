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
  // README 截图用：桌面背景上的一个应用窗口（标题栏、文字、柱状图）
  function drawDemoDesktop(g) {
    const bg = g.createLinearGradient(0, 0, 1800, 1120); bg.addColorStop(0, '#312e81'); bg.addColorStop(1, '#0f766e'); g.fillStyle = bg; g.fillRect(0, 0, 1800, 1120)
    const round = (x, y, w, h, r, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill() }
    round(140, 110, 1520, 900, 24, '#ffffff')
    round(140, 110, 1520, 72, [24, 24, 0, 0], '#f1f5f9')
    ;['#ef4444', '#f59e0b', '#22c55e'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(184 + i * 36, 146, 11, 0, Math.PI * 2); g.fill() })
    g.fillStyle = '#1f2329'; g.font = 'bold 44px -apple-system, "PingFang SC", sans-serif'; g.fillText('季度运营报告', 220, 280)
    g.font = '32px -apple-system, "PingFang SC", sans-serif'; g.fillStyle = '#475569'
    ;['订单号 2024-1012-8848，本季度新增用户 12,480 人', '联系电话 138-1234-5678，邮箱 hello@example.com', '活跃度较上季度提升 23.6%，留存率稳定在 61%'].forEach((l, i) => g.fillText(l, 220, 360 + i * 64))
    g.fillStyle = '#0f172a'; g.font = 'bold 30px -apple-system, sans-serif'; g.fillText('月度访问量', 220, 620)
    ;[160, 240, 200, 320, 280, 400, 360].forEach((h, i) => round(230 + i * 120, 960 - h, 70, h, 10, i === 5 ? '#f59e0b' : '#3b82f6'))
    round(1180, 600, 400, 360, 16, '#eff6ff'); g.fillStyle = '#1d4ed8'; g.font = 'bold 72px -apple-system, sans-serif'; g.fillText('+23.6%', 1230, 800); g.font = '28px -apple-system, "PingFang SC", sans-serif'; g.fillStyle = '#475569'; g.fillText('环比增长', 1230, 860)
  }
  // 模拟一块 900×560、2 倍缩放屏幕的定格画面（1800×1120 物理像素）
  function frozenScreen() {
    const c = document.createElement('canvas'); c.width = 1800; c.height = 1120; const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 1800, 1120); grad.addColorStop(0, '#dbeafe'); grad.addColorStop(1, '#fde68a'); g.fillStyle = grad; g.fillRect(0, 0, 1800, 1120)
    g.fillStyle = '#fff'; g.fillRect(200, 160, 1000, 640); g.fillStyle = '#1f2329'; g.font = '40px sans-serif'
    for (let i = 0; i < 8; i++) g.fillText('定格全屏后选区 Freeze then select ' + i, 240, 240 + i * 70)
    g.fillStyle = '#ef4444'; g.fillRect(1300, 300, 300, 300)
    if (params.has('demo')) drawDemoDesktop(g)
    const data = g.getImageData(0, 0, 1800, 1120).data
    window.__frozenSource = data
    return { width: 1800, height: 1120, data }
  }
  window.shotHost = {
    send(type, payload = {}) {
      window.__shot.sent.push({ type, ...payload, png: payload.png ? payload.png.slice(0, 30) : undefined })
      if (type === 'ready' && mode === 'select') setTimeout(() => handler({ type: 'init', mode: 'select', after: params.get('after') || 'edit', frozen: frozenScreen(), display: { bounds: { x: 0, y: 0, width: 900, height: 560 }, scaleFactor: 2 }, winId: 7 }))
      else if (type === 'ready') setTimeout(() => handler({ type: 'init', image: sampleImage(), rect, mode, baseSize: { width: rect.width, height: rect.height }, target: params.get('target') ? { width: rect.width, height: rect.height } : null, winId: 7 }))
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
