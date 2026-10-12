// README 截图场景（仅开发预览使用）：?scene=xxx 时在页面初始化后摆好对应的界面状态
;(function () {
  const params = new URLSearchParams(location.search)
  const scene = params.get('scene')
  if (!scene) return
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

  // 插件主界面
  const main = {
    async history() {},
    async dark() {
      applyTheme(true)
    },
    async fav() {
      switchTab('fav')
    },
    async ocr() {
      const item = services.getItems().find((i) => i.type === 'image')
      await Actions.builtins.ocr.run(item)
      await wait(50)
      const tokens = [...document.querySelectorAll('.token')]
      for (const text of ['2024-1012-8848', '138-1234-5678']) click(tokens.find((t) => t.textContent === text))
    },
    async settings() {
      Settings.open()
      click(document.querySelector('[data-s="detect-all"]'))
      await wait(200)
      document.querySelector('#action-cards').scrollIntoView()
      document.querySelector('.settings-body').scrollTop -= 60
    }
  }

  // 截图窗口（定格全屏选区 / 标注）
  const capture = {
    async select() {
      // 选区终点落在橙色柱子边缘，放大镜能看到像素和颜色值
      S.selStart = { x: 100, y: 70 }
      S.pointer = { x: 432, y: 300 }
      $('#select-hint').classList.add('hidden')
      scheduleSelect()
    },
    async annotate() {
      finishSelection({ x: 100, y: 70, width: 700, height: 370 })
      const k = S.natW / S.rect.width
      const base = { color: '#ff3b30', k, w: 3 * k }
      pushShape({ ...base, type: 'rect', x1: 10, y1: 182, x2: 800, y2: 240 })
      pushShape({ ...base, type: 'mosaic', x1: 146, y1: 252, x2: 398, y2: 298, block: 5 * k })
      pushShape({ ...base, type: 'arrow', x1: 800, y1: 445, x2: 975, y2: 555 })
      pushShape({ ...base, type: 'number', x: 26, y: 170, r: 13 * k, n: 1 })
      pushShape({ ...base, type: 'number', x: 1000, y: 470, r: 13 * k, n: 2 })
      pushShape({ ...base, type: 'text', x: 600, y: 392, fontSize: 18 * k, text: '环比增长亮点' })
      S.size = 1
      setTool('rect')
    }
  }

  // 页面脚本中的全局常量不会挂到 window 上，用 typeof 判断当前是插件主界面还是截图窗口
  const isMain = typeof Settings !== 'undefined'
  const table = isMain ? main : capture
  const run = table[scene]
  if (!run) return
  const until = async (check) => {
    for (let i = 0; i < 100 && !check(); i++) await wait(50)
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  // 等页面初始化完成（主界面列表已渲染、截图窗口已收到 init）再摆场景，完成后截图脚本才截图
  window.__sceneDone = (async () => {
    if (isMain) {
      await until(() => document.querySelector('.row'))
      closeModal() // 关掉首次使用提示
    } else {
      await until(() => S.mode === 'select' && S.frozenW)
    }
    await run()
    await wait(100)
    await frame()
    await frame()
    return true
  })().catch((e) => String(e))
})()
