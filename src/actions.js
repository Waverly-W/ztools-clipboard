// 条目操作：内置操作 + 设置中配置的自定义操作
const BUILTIN_ACTIONS = [
  { id: 'copy', name: '复制', icon: 'copy', when: () => true, run: (item) => App.copy([item]) },
  { id: 'view', name: '查看全部', icon: 'view', when: () => true, run: (item) => App.view(item) },
  { id: 'openFolder', name: '打开所在文件夹', icon: 'folder', when: (item) => item.type !== 'text', run: (item) => services.openFolder(item) },
  { id: 'fav', name: '收藏', icon: 'star', when: (item) => !item.fav, run: (item) => App.favorite([item]) },
  { id: 'editFav', name: '编辑收藏', icon: 'edit', when: (item) => item.fav, run: (item) => App.editFavorite(item) },
  { id: 'unfav', name: '取消收藏', icon: 'unstar', when: (item) => item.fav, run: (item) => App.unfavorite([item]) },
  { id: 'delete', name: '删除', icon: 'trash', when: () => true, run: (item) => App.remove([item]) },
  { id: 'split', name: '分词', icon: 'split', when: (item) => item.type === 'text', run: (item) => App.split(item) },
  { id: 'saveFile', name: '保存为文件', icon: 'save', when: (item) => item.type !== 'file', run: (item) => App.saveFile(item) }
]

const ok = (message) => ({ level: 'ok', message })
const warn = (message) => ({ level: 'warn', message })
const fail = (message) => ({ level: 'error', message })

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim())

async function getProvider(type) {
  try {
    return (await window.ztools.providers.getDefaultProvider(type)) || null
  } catch {
    return null
  }
}

const providerName = (p) => p.label || p.id || '已启用的服务'

// ---------- 内置功能 ----------
function wordStats(text) {
  const lines = text.split(/\r?\n/)
  return [
    ['字符（含空白）', [...text].length],
    ['字符（不含空白）', [...text].filter((c) => !/\s/.test(c)).length],
    ['汉字', (text.match(/\p{Script=Han}/gu) || []).length],
    ['英文单词', (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length],
    ['数字', (text.match(/\d+(?:\.\d+)?/g) || []).length],
    ['标点', (text.match(/\p{P}/gu) || []).length],
    ['行数', lines.length],
    ['段落', lines.filter((l) => l.trim()).length]
  ]
}

function parseColor(input) {
  const el = document.createElement('div')
  el.style.color = input
  if (!el.style.color) return null
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  el.remove()
  const nums = (computed.match(/[\d.]+/g) || []).map(Number)
  if (nums.length < 3) return null
  const [r, g, b, a = 1] = nums
  const hex = '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') +
    (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '')
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
    h *= 60
  }
  const alpha = a < 1 ? `, ${+a.toFixed(2)}` : ''
  return {
    css: computed,
    values: [
      ['HEX', hex.toUpperCase()],
      ['RGB', `rgb${a < 1 ? 'a' : ''}(${r}, ${g}, ${b}${alpha})`],
      ['HSL', `hsl${a < 1 ? 'a' : ''}(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%${alpha})`]
    ]
  }
}

async function runOcr(item) {
  const engine = services.getConfig().ocr.engine
  App.toast('正在识别…')
  let text
  if (engine !== 'system') {
    const provider = await getProvider('ocr')
    if (provider) {
      try {
        text = ((await window.ztools.ocr(services.imageUrl(item))) || {}).text || ''
      } catch (e) {
        if (engine === 'provider') throw e
      }
    } else if (engine === 'provider') {
      throw new Error('未启用 ZTools OCR 服务，请安装提供 OCR 的插件，或在设置中改用系统文字识别')
    }
  }
  if (text === undefined) text = await services.systemOcr(item)
  showOcrText(text)
}

// OCR 结果用分词界面展示，方便挑选复制
function showOcrText(text, title = 'OCR 文字识别') {
  if (!text || !text.trim()) return App.toast('未识别到文字')
  App.splitText(text, { title })
}

async function detectOcr() {
  const engine = services.getConfig().ocr.engine
  if (engine === 'system') return toStatus(await services.detectSystemOcr())
  const provider = await getProvider('ocr')
  if (provider) return ok(`使用 ZTools OCR 服务：${providerName(provider)}`)
  if (engine === 'provider') return fail('未启用 ZTools OCR 服务，请安装提供 OCR 的插件并在 ZTools 设置中启用')
  const system = await services.detectSystemOcr()
  return system.ok
    ? ok(`未启用 ZTools OCR 服务，将使用${services.systemOcrName()}，检测通过`)
    : fail(`未启用 ZTools OCR 服务；${system.message}`)
}

function formatImageUrl(url) {
  const format = services.getConfig().imageHost.format
  if (format === 'markdown') return `![](${url})`
  if (format === 'html') return `<img src="${url}" />`
  return url
}

const toStatus = (r) => (r.ok ? ok(r.message) : fail(r.message))

const BUILTIN_HANDLERS = {
  wordCount: {
    name: '统计字数',
    types: ['text'],
    run: (item) => App.showWordCount(wordStats(item.text)),
    detect: async () => ok('内置功能，无需配置')
  },
  color: {
    name: '识别颜色值',
    types: ['text'],
    run: (item) => {
      const color = parseColor(item.text.trim())
      if (!color) return App.toast('不是有效的颜色值')
      App.showColor(item.text.trim(), color)
    },
    detect: async () => ok('内置功能，无需配置')
  },
  qrcode: {
    name: '识别二维码',
    types: ['image'],
    run: (item) => {
      const text = services.decodeQr(item)
      if (!text) return App.toast('未识别到二维码')
      App.showResult('二维码内容', text, { link: isUrl(text) ? text.trim() : '' })
    },
    detect: async () => ok('内置功能，无需配置')
  },
  ocr: { name: 'OCR 文字识别', types: ['image'], run: runOcr, detect: detectOcr },
  imageHost: {
    name: '上传图床',
    types: ['image'],
    run: async (item) => {
      App.toast('正在上传…')
      const url = await services.uploadImage(item)
      const text = formatImageUrl(url)
      services.copyText(text)
      App.showResult('上传成功，已复制', text, { link: url })
    },
    detect: async () => toStatus(await services.detectImageHost())
  },
  imageSearch: {
    name: '百度识图',
    types: ['image'],
    run: async (item) => {
      App.toast('正在打开百度识图…')
      await services.imageSearch(item)
    },
    detect: async () => toStatus(await services.detectImageSearch())
  }
}

// ---------- 处理方式 ----------
const redirectLabel = (r) => (Array.isArray(r) ? r.join(' / ') : r)

const HANDLERS = {
  builtin: {
    run: (def, item) => {
      const builtin = BUILTIN_HANDLERS[def.builtin]
      if (!builtin) throw new Error('未知的内置功能：' + def.builtin)
      return builtin.run(item)
    },
    detect: async (def) => {
      const builtin = BUILTIN_HANDLERS[def.builtin]
      if (!builtin) return fail('未知的内置功能：' + def.builtin)
      const wrongType = (def.types || []).find((t) => !builtin.types.includes(t))
      if (wrongType) return fail(`「${builtin.name}」只支持${builtin.types.map(typeName).join('、')}`)
      return builtin.detect()
    }
  },

  provider: {
    run: async (def, item) => {
      const provider = await getProvider(def.provider)
      if (!provider) {
        if (def.url && item.type === 'text') return HANDLERS.url.run(def, item)
        throw new Error(`未启用${PROVIDER_LABELS[def.provider]}服务，请安装对应插件并在 ZTools 设置中启用`)
      }
      App.toast(def.provider === 'ocr' ? '正在识别…' : '正在翻译…')
      const result = def.provider === 'ocr' ? await window.ztools.ocr(services.imageUrl(item)) : await window.ztools.translate(item.text)
      const text = (result && result.text) || ''
      if (def.provider === 'ocr') showOcrText(text, def.name)
      else App.showResult(def.name, text)
    },
    detect: async (def) => {
      const label = PROVIDER_LABELS[def.provider]
      if (!label) return fail('provider 只能是 translation 或 ocr')
      const provider = await getProvider(def.provider)
      if (provider) return ok(`使用 ZTools ${label}服务：${providerName(provider)}`)
      if (def.url) return warn(`未启用 ZTools ${label}服务，将打开网页：${def.url}`)
      return fail(`未启用 ZTools ${label}服务，请安装提供${label}的插件并在 ZTools 设置中启用`)
    }
  },

  // ZTools 跳转规则：带内容只能进入 regex / over 指令；不带内容只能进入文字指令。
  // 目标指令不接收内容时，先把内容复制到剪贴板再打开。
  redirect: {
    run: (def, item) => {
      const found = services.findCommand(def.redirect)
      if (item.type === 'text' && (found.withPayload || !found.plain)) {
        window.ztools.redirect(def.redirect, item.text)
        return
      }
      services.copy([item])
      window.ztools.redirect(def.redirect)
      App.toast('内容已复制，可在打开的插件中粘贴')
    },
    detect: async (def) => {
      if (!def.redirect || (Array.isArray(def.redirect) && !def.redirect[1])) return fail('请填写目标指令')
      const found = services.findCommand(def.redirect)
      const label = redirectLabel(def.redirect)
      if (!found.withPayload && !found.plain) {
        return fail(`已安装的插件中没有指令「${label}」，请安装对应插件或修改目标指令`)
      }
      const types = def.types || ['text']
      if (types.includes('text') && found.withPayload) {
        return ok(`已找到「${found.withPayload.plugin}」，文字会直接传入`)
      }
      return warn(`已找到「${found.plain || found.withPayload.plugin}」，会先复制内容再打开，需要在插件中手动粘贴`)
    }
  },

  url: {
    run: (def, item) => {
      const text = item.type === 'text' ? item.text : item.type === 'file' ? item.files.map((f) => f.path).join('\n') : ''
      window.ztools.shellOpenExternal(def.url.replace(/\{text\}/g, encodeURIComponent(text)))
    },
    detect: async (def) => {
      try {
        new URL((def.url || '').replace(/\{text\}/g, 'test'))
      } catch {
        return fail('网址格式不正确')
      }
      if (!def.url.includes('{text}')) return warn('网址中没有 {text}，打开时不会带上内容')
      return ok('网址有效')
    }
  }
}

const PROVIDER_LABELS = { ocr: 'OCR', translation: '翻译' }
const TYPE_NAMES = { text: '文字', image: '图片', file: '文件' }
const typeName = (t) => TYPE_NAMES[t] || t

async function runCustomAction(def, item) {
  const handler = HANDLERS[def.handler]
  try {
    if (!handler) throw new Error('未知的处理方式：' + def.handler)
    await handler.run(def, item)
  } catch (e) {
    App.toast(`${def.name}失败：${e.message || e}`)
  }
}

// 检测操作能否正常使用，返回 { level: 'ok' | 'warn' | 'error', message }
async function detectCustomAction(def) {
  if (def.match) {
    try { new RegExp(def.match) } catch { return fail('匹配正则格式不正确') }
  }
  if (!def.types || !def.types.length) return fail('请至少选择一种适用类型')
  const handler = HANDLERS[def.handler]
  if (!handler) return fail('请选择处理方式')
  try {
    return await handler.detect(def)
  } catch (e) {
    return fail(e.message || String(e))
  }
}

function customAction(def) {
  let re = null
  if (def.match) {
    try { re = new RegExp(def.match, 'i') } catch {}
  }
  const types = def.types && def.types.length ? def.types : ['text']
  return {
    id: 'custom:' + def.id,
    name: def.name,
    icon: 'bolt',
    custom: true,
    // 只在内容匹配时显示：类型匹配，文字还需匹配正则
    when: (item) => types.includes(item.type) && (!re || (item.type === 'text' && re.test(item.text))),
    run: (item) => runCustomAction(def, item)
  }
}

const Actions = {
  cache: null,
  // 配置变更后调用
  reset() {
    this.cache = null
  },
  load() {
    if (!this.cache) {
      const config = services.getConfig()
      const custom = (config.customActions || []).filter((d) => d && d.id && d.name).map(customAction)
      this.cache = { all: [...BUILTIN_ACTIONS, ...custom], toolbar: config.toolbar || [] }
    }
    return this.cache
  },
  all() {
    return this.load().all
  },
  for(item) {
    return this.all().filter((a) => a.when(item))
  },
  toolbarFor(item) {
    const { all, toolbar } = this.load()
    return toolbar.map((id) => all.find((a) => a.id === id)).filter((a) => a && a.when(item))
  },
  detect: detectCustomAction,
  detectOcr,
  builtins: BUILTIN_HANDLERS
}
