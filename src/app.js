const $ = (sel, el = document) => el.querySelector(sel)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const PAGE_SIZE = 100
const DEFAULT_TAG = '__default__'
const NOTICE_KEY = 'noticeVersion'
// 首次使用或有重要更新时弹出，更新内容时修改 version
const NOTICE = {
  version: '1.0.0',
  title: '欢迎使用超级剪贴板',
  lines: [
    '复制过的文字、图片和文件会被自动记录，插件在后台运行期间持续记录。',
    '单击复制，双击或回车粘贴到当前应用；按 Space 进入多选。',
    '收藏的内容不受保存期限和条数上限影响，可以打标签分类。',
    '按 Ctrl+, 打开设置，可修改存放位置（放到网盘目录即可多设备同步）。'
  ]
}

const state = {
  tab: 'history', // history | fav
  filter: 'all', // all | text | image | file
  tag: '', // 收藏标签筛选，'' 为全部
  keyword: '',
  list: [],
  cursor: 0,
  rendered: 0,
  multi: false,
  selected: new Set()
}

const listEl = $('#list')
const searchEl = $('#search')

// ---------- 数据 ----------
const searchCache = new WeakMap()
function searchText(item) {
  const key = item.hash + '|' + (item.tags || []).join(',')
  const cached = searchCache.get(item)
  if (cached && cached.key === key) return cached.text
  let text = ''
  if (item.type === 'text') text = item.text
  else if (item.type === 'file') text = item.files.map((f) => f.name + '\n' + f.path).join('\n')
  text = (text + '\n' + (item.tags || []).join(' ')).toLowerCase()
  searchCache.set(item, { key, text })
  return text
}

function computeList() {
  let items = services.getItems()
  if (state.tab === 'fav') {
    items = items.filter((i) => i.fav).sort((a, b) => (b.favTime || 0) - (a.favTime || 0))
    if (state.tag === DEFAULT_TAG) items = items.filter((i) => !(i.tags && i.tags.length))
    else if (state.tag) items = items.filter((i) => i.tags && i.tags.includes(state.tag))
  } else if (state.filter !== 'all') {
    items = items.filter((i) => i.type === state.filter)
  }
  const words = state.keyword.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length) items = items.filter((i) => words.every((w) => searchText(i).includes(w)))
  return items
}

function allTags() {
  const count = new Map()
  for (const item of services.getItems()) {
    if (item.fav) for (const t of item.tags || []) count.set(t, (count.get(t) || 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
}

// ---------- 渲染 ----------
function refresh({ keepCursor = false } = {}) {
  const prevId = state.list[state.cursor] && state.list[state.cursor].id
  state.list = computeList()
  if (keepCursor && prevId) {
    const idx = state.list.findIndex((i) => i.id === prevId)
    state.cursor = idx >= 0 ? idx : Math.min(state.cursor, state.list.length - 1)
  } else {
    state.cursor = 0
  }
  state.cursor = Math.max(0, state.cursor)
  const ids = new Set(state.list.map((i) => i.id))
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id)
  renderTabs()
  renderFilters()
  renderList(keepCursor)
  renderMultiBar()
}

let refreshTimer = null
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refresh({ keepCursor: true }), 30)
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === state.tab))
}

function renderFilters() {
  let chips
  if (state.tab === 'history') {
    chips = [['all', '全部'], ['text', '文字'], ['image', '图片'], ['file', '文件']].map(
      ([v, label]) => `<button class="chip ${state.filter === v ? 'active' : ''}" data-filter="${v}">${label}</button>`
    )
  } else {
    const tags = [['', '全部'], [DEFAULT_TAG, '默认'], ...allTags().map((t) => [t, t])]
    chips = tags.map(([v, label]) => `<button class="chip ${state.tag === v ? 'active' : ''}" data-tag="${esc(v)}">${esc(label)}</button>`)
  }
  $('#filters').innerHTML = chips.join('')
}

function renderList(keepScroll) {
  const scrollTop = listEl.scrollTop
  const count = Math.max(PAGE_SIZE, keepScroll ? state.rendered : 0, state.cursor + 1)
  state.rendered = 0
  listEl.innerHTML = ''
  if (!state.list.length) {
    listEl.innerHTML = `<div class="empty">${emptyText()}</div>`
    return
  }
  renderMore(count)
  if (keepScroll) listEl.scrollTop = scrollTop
  updateCursor(!keepScroll)
}

function emptyText() {
  if (state.keyword) return '没有找到匹配的内容'
  if (state.tab === 'fav') return '还没有收藏，在历史中选中条目后点击「收藏」'
  return '还没有记录，复制一些内容试试'
}

function renderMore(n = PAGE_SIZE) {
  const end = Math.min(state.list.length, state.rendered + n)
  if (end <= state.rendered) return
  let html = ''
  for (let i = state.rendered; i < end; i++) html += rowHtml(state.list[i], i)
  listEl.insertAdjacentHTML('beforeend', html)
  state.rendered = end
  listEl.querySelectorAll('img[data-thumb]:not([src])').forEach((img) => thumbObserver.observe(img))
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const img = entry.target
    thumbObserver.unobserve(img)
    const item = services.getItem(img.dataset.thumb)
    if (item) img.src = services.thumbUrl(item) || ''
  }
}, { root: listEl, rootMargin: '200px' })

function formatTime(ts) {
  const diff = Date.now() - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前'
  const d = new Date(ts)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm
  const yesterday = new Date(now.getTime() - 864e5)
  if (d.toDateString() === yesterday.toDateString()) return '昨天 ' + hm
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`
}

function rowHtml(item, i) {
  let lead
  if (state.multi) lead = `<span class="check ${state.selected.has(item.id) ? 'on' : ''}">${icon('check')}</span>`
  else lead = `<span class="index">${i < 9 ? i + 1 : ''}</span>`

  let media
  let content
  let info
  if (item.type === 'text') {
    media = `<span class="type-icon">${icon('text')}</span>`
    content = esc(item.text.slice(0, 400).replace(/\s+/g, ' ').trim())
    info = `${item.text.length} 字`
  } else if (item.type === 'image') {
    media = `<img class="thumb" data-thumb="${item.id}" alt="" />`
    content = '图片'
    info = `${item.width} × ${item.height}`
  } else {
    const first = item.files[0]
    media = `<span class="type-icon">${icon(first.isDir ? 'folder' : 'file')}</span>`
    content = esc(first.name) + (item.files.length > 1 ? ` <span class="muted">等 ${item.files.length} 个文件</span>` : '')
    info = esc(first.path)
  }

  const tags = item.fav
    ? state.tab === 'fav'
      ? (item.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')
      : `<span class="fav-mark">${icon('star')}</span>`
    : ''
  const actions = Actions.toolbarFor(item)
    .map((a) => `<button class="icon-btn" data-action="${esc(a.id)}" title="${esc(a.name)}">${icon(a.icon)}</button>`)
    .join('')

  return `<div class="row ${state.selected.has(item.id) ? 'checked' : ''}" data-idx="${i}">
    ${lead}${media}
    <div class="row-main">
      <div class="row-content">${content}</div>
      <div class="row-meta"><span>${formatTime(item.time)}</span><span class="info">${info}</span>${tags}</div>
    </div>
    <div class="row-actions">${actions}<button class="icon-btn" data-more title="更多操作">${icon('more')}</button></div>
  </div>`
}

function rowEl(idx) {
  return listEl.querySelector(`.row[data-idx="${idx}"]`)
}

function updateCursor(scroll = true) {
  listEl.querySelectorAll('.row.active').forEach((el) => el.classList.remove('active'))
  const el = rowEl(state.cursor)
  if (!el) return
  el.classList.add('active')
  if (scroll) el.scrollIntoView({ block: 'nearest' })
}

function setCursor(idx) {
  if (!state.list.length) return
  state.cursor = Math.max(0, Math.min(state.list.length - 1, idx))
  if (state.cursor >= state.rendered) renderMore(state.cursor - state.rendered + PAGE_SIZE)
  updateCursor()
}

function renderMultiBar() {
  $('#multi-bar').classList.toggle('hidden', !state.multi)
  $('#multi-count').textContent = `已选 ${state.selected.size} 项`
}

// ---------- 多选 ----------
function toggleSelect(item) {
  if (state.selected.has(item.id)) state.selected.delete(item.id)
  else state.selected.add(item.id)
  const el = rowEl(state.list.indexOf(item))
  if (el) {
    el.classList.toggle('checked', state.selected.has(item.id))
    const check = el.querySelector('.check')
    if (check) check.classList.toggle('on', state.selected.has(item.id))
  }
  renderMultiBar()
}

function enterMulti() {
  state.multi = true
  state.selected.clear()
  renderList(true)
  renderMultiBar()
}

function exitMulti() {
  if (!state.multi) return
  state.multi = false
  state.selected.clear()
  renderList(true)
  renderMultiBar()
}

function selectedItems() {
  return state.list.filter((i) => state.selected.has(i.id))
}

function currentItem() {
  return state.list[state.cursor]
}

// 多选模式下操作已选条目（未选任何条目时操作当前条目）
function targetItems() {
  if (state.multi && state.selected.size) return selectedItems()
  const item = currentItem()
  return item ? [item] : []
}

// ---------- 弹层 ----------
let modalKeyHandler = null

function openModal(html, onKey, cls = '') {
  hideMenu()
  $('#modal-body').className = 'modal ' + cls
  $('#modal-body').onclick = null
  $('#modal-body').innerHTML = html
  $('#modal').classList.remove('hidden')
  modalKeyHandler = onKey || null
}

function closeModal() {
  $('#modal').classList.add('hidden')
  $('#modal-body').innerHTML = ''
  modalKeyHandler = null
}

function isModalOpen() {
  return !$('#modal').classList.contains('hidden')
}

function confirmDialog(message, okText = '确定') {
  return new Promise((resolve) => {
    const done = (v) => {
      closeModal()
      resolve(v)
    }
    openModal(
      `<div class="modal-head">请确认</div>
       <div class="modal-text">${esc(message)}</div>
       <div class="modal-foot"><button data-act="cancel">取消</button><button class="danger" data-act="ok">${esc(okText)}</button></div>`,
      (e) => {
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }
    )
    $('#modal-body [data-act=ok]').onclick = () => done(true)
    $('#modal-body [data-act=cancel]').onclick = () => done(false)
  })
}

let toastTimer = null
function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1600)
}

function showMenu(item, x, y) {
  const menu = $('#menu')
  menu.innerHTML = Actions.for(item)
    .map((a) => `<div class="menu-item" data-action="${esc(a.id)}">${icon(a.icon)}<span>${esc(a.name)}</span></div>`)
    .join('')
  menu.classList.remove('hidden')
  const { innerWidth, innerHeight } = window
  const rect = menu.getBoundingClientRect()
  menu.style.left = Math.min(x, innerWidth - rect.width - 8) + 'px'
  menu.style.top = Math.max(8, Math.min(y, innerHeight - rect.height - 8)) + 'px'
  menu.onclick = (e) => {
    const el = e.target.closest('[data-action]')
    if (!el) return
    hideMenu()
    runAction(el.dataset.action, item)
  }
}

function hideMenu() {
  $('#menu').classList.add('hidden')
}

function runAction(id, item) {
  const action = Actions.all().find((a) => a.id === id)
  if (action && item) action.run(item)
}

// ---------- 条目操作 ----------
function joinTokens(tokens) {
  let out = ''
  for (const t of tokens) {
    if (out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t)) out += ' '
    out += t
  }
  return out
}

// 返回 [{ text, start }]，start 为在 text 中的位置
function segmentWords(text, offset = 0) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' })
    return [...seg.segment(text)].filter((s) => s.isWordLike).map((s) => ({ text: s.segment, start: offset + s.index }))
  }
  return [...text.matchAll(/[^\s,.;:!?，。；：！？、"'“”‘’()（）[\]【】<>《》]+/g)].map((m) => ({ text: m[0], start: offset + m.index }))
}

// 网址、邮箱、带分隔符的数字（电话、日期、金额）、带点或横线的英文数字串保持完整
const WHOLE_TOKEN = /https?:\/\/[^\s，。、；"'<>（）()]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\d+(?:[-.:/,]\d+)+|[A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)+/g

function tokenizeLine(line) {
  const tokens = []
  let last = 0
  for (const m of line.matchAll(WHOLE_TOKEN)) {
    tokens.push(...segmentWords(line.slice(last, m.index), last), { text: m[0], start: m.index })
    last = m.index + m[0].length
  }
  tokens.push(...segmentWords(line.slice(last), last))
  return tokens
}

// 按行分词，返回 [{ text, line, start, end }]
function tokenize(text, limit = 2000) {
  const tokens = []
  text.split(/\r?\n/).forEach((line, i) => {
    for (const t of tokenizeLine(line)) {
      if (tokens.length < limit) tokens.push({ text: t.text, line: i, start: t.start, end: t.start + t.text.length })
    }
  })
  return tokens
}

function parseTags(str) {
  return [...new Set(str.split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean))]
}

const App = {
  toast,
  refresh,

  // 操作结果（OCR、翻译、二维码、图床地址），可修改后复制或粘贴
  showResult(title, text, { link = '' } = {}) {
    $('#toast').classList.add('hidden')
    openModal(
      `<div class="modal-head">${esc(title)}</div>
       <textarea id="result-text" spellcheck="false">${esc(text)}</textarea>
       <div class="modal-foot">
         ${text ? '' : '<span class="muted">未识别到文字</span>'}
         ${link ? '<button data-act="link">打开链接</button>' : ''}
         <button data-act="close">关闭</button><button data-act="copy">复制</button>
         <button class="primary" data-act="paste">粘贴 (Ctrl+Enter)</button>
       </div>`,
      (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done('paste')
      },
      'wide'
    )
    const done = (act) => {
      const value = $('#result-text').value
      closeModal()
      if (act === 'link') {
        window.ztools.shellOpenExternal(link)
      } else if (act === 'copy') {
        services.copyText(value)
        toast('已复制')
      } else if (act === 'paste') {
        services.pasteText(value)
      }
    }
    $('#modal-body').onclick = (e) => {
      const act = e.target.closest('[data-act]')
      if (act) done(act.dataset.act)
    }
  },

  showWordCount(stats) {
    const summary = stats.map(([k, v]) => `${k}：${v}`).join('\n')
    openModal(
      `<div class="modal-head">统计字数</div>
       <div class="stats">${stats.map(([k, v]) => `<div class="muted">${esc(k)}</div><b>${v}</b>`).join('')}</div>
       <div class="modal-foot"><button data-act="close">关闭</button><button class="primary" data-act="copy">复制统计结果</button></div>`
    )
    $('#modal-body').onclick = (e) => {
      const act = e.target.closest('[data-act]')
      if (!act) return
      closeModal()
      if (act.dataset.act === 'copy') {
        services.copyText(summary)
        toast('已复制')
      }
    }
  },

  showColor(input, color) {
    openModal(
      `<div class="modal-head">识别颜色值</div>
       <div class="color-view">
         <div class="swatch"><span style="background:${esc(color.css)}"></span></div>
         <div class="color-values">${color.values
           .map(([k, v]) => `<div class="color-row" data-copy="${esc(v)}" title="点击复制"><span class="muted">${k}</span><code>${esc(v)}</code>${icon('copy')}</div>`)
           .join('')}</div>
       </div>
       <div class="modal-foot"><span class="muted">原始值：${esc(input)}</span><button data-act="close">关闭</button></div>`
    )
    $('#modal-body').onclick = (e) => {
      const row = e.target.closest('[data-copy]')
      if (row) {
        services.copyText(row.dataset.copy)
        toast('已复制 ' + row.dataset.copy)
      }
      if (e.target.closest('[data-act=close]')) closeModal()
    }
  },

  copy(items) {
    if (!items.length) return
    const result = services.copy(items)
    if (result === 'partial') toast('内容类型混合，已复制其中的文字')
    else toast(items.length > 1 ? `已复制 ${items.length} 条` : '已复制')
    exitMulti()
  },

  paste(items) {
    if (!items.length) return
    exitMulti()
    services.paste(items)
  },

  favorite(items) {
    services.favorite(items.map((i) => i.id))
    toast(items.length > 1 ? `已收藏 ${items.length} 条` : '已收藏')
    exitMulti()
  },

  unfavorite(items) {
    services.unfavorite(items.map((i) => i.id))
    toast('已取消收藏')
  },

  async remove(items) {
    if (!items.length) return
    const favCount = items.filter((i) => i.fav).length
    if (favCount && !(await confirmDialog(`其中 ${favCount} 条是收藏内容，确定删除吗？`, '删除'))) return
    services.remove(items.map((i) => i.id))
    toast(items.length > 1 ? `已删除 ${items.length} 条` : '已删除')
    exitMulti()
  },

  saveFile(item) {
    try {
      if (services.saveAsFile(item)) toast('已保存')
    } catch (e) {
      toast('保存失败：' + e.message)
    }
  },

  view(item) {
    let body
    let foot = '<button data-act="close">关闭</button><button data-act="copy">复制</button><button class="primary" data-act="paste">粘贴</button>'
    if (item.type === 'text') {
      body = `<div class="modal-head">文字 · ${item.text.length} 字</div><pre class="full-text">${esc(item.text)}</pre>`
    } else if (item.type === 'image') {
      body = `<div class="modal-head">图片 · ${item.width} × ${item.height}</div>
        <div class="full-image"><img src="${services.imageUrl(item)}" alt="" /></div>`
      foot = '<button data-act="folder">打开所在文件夹</button>' + foot
    } else {
      body = `<div class="modal-head">文件 · ${item.files.length} 个</div><div class="file-list">${item.files
        .map((f) => {
          const missing = !services.fileExists(f.path)
          return `<div class="file-row ${missing ? 'missing' : ''}" data-path="${esc(f.path)}" title="${missing ? '文件不存在' : '点击打开'}">
            ${icon(f.isDir ? 'folder' : 'file')}<div><div>${esc(f.name)}</div><div class="muted">${esc(f.path)}</div></div>
            ${missing ? '<span class="muted">不存在</span>' : `<button class="icon-btn" data-reveal title="在文件夹中显示">${icon('folder')}</button>`}
          </div>`
        })
        .join('')}</div>`
    }
    openModal(body + `<div class="modal-foot">${foot}</div>`, (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        closeModal()
        App.paste([item])
      }
    }, 'wide')
    const modal = $('#modal-body')
    modal.onclick = (e) => {
      const reveal = e.target.closest('[data-reveal]')
      const row = e.target.closest('.file-row')
      if (reveal) window.ztools.shellShowItemInFolder(row.dataset.path)
      else if (row && !row.classList.contains('missing')) services.openPath(row.dataset.path)
      const act = e.target.closest('[data-act]')
      if (!act) return
      const a = act.dataset.act
      if (a === 'close') closeModal()
      else if (a === 'copy') { closeModal(); App.copy([item]) }
      else if (a === 'paste') { closeModal(); App.paste([item]) }
      else if (a === 'folder') services.openFolder(item)
    }
  },

  editFavorite(item) {
    const tags = allTags()
    const isText = item.type === 'text'
    openModal(
      `<div class="modal-head">编辑收藏</div>
       ${isText ? `<textarea id="fav-text" spellcheck="false">${esc(item.text)}</textarea>` : '<div class="muted">图片和文件收藏只能修改标签</div>'}
       <label class="field-label">标签（空格或逗号分隔，留空归入「默认」）</label>
       <input id="fav-tags" type="text" value="${esc((item.tags || []).join(' '))}" />
       ${tags.length ? `<div class="chips">${tags.map((t) => `<button class="chip" data-add-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
       <div class="modal-foot"><button data-act="cancel">取消</button><button class="primary" data-act="save">保存 (Ctrl+Enter)</button></div>`,
      (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
      },
      'wide'
    )
    const tagsEl = $('#fav-tags')
    const save = () => {
      const text = isText ? $('#fav-text').value : undefined
      if (isText && !text.trim()) return toast('内容不能为空')
      services.editFavorite(item.id, { text, tags: parseTags(tagsEl.value) })
      closeModal()
      toast('已保存')
    }
    $('#modal-body').onclick = (e) => {
      const add = e.target.closest('[data-add-tag]')
      if (add) {
        const list = parseTags(tagsEl.value)
        const t = add.dataset.addTag
        tagsEl.value = (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]).join(' ')
      }
      const act = e.target.closest('[data-act]')
      if (act && act.dataset.act === 'cancel') closeModal()
      if (act && act.dataset.act === 'save') save()
    }
    ;(isText ? $('#fav-text') : tagsEl).focus()
  },

  split(item) {
    App.splitText(item.text, { title: '分词' })
  },

  // 分词选择：点击选词，Shift+点击选范围，双击选整行；Enter 粘贴所选，Ctrl+C 复制所选
  splitText(text, { title = '分词' } = {}) {
    $('#toast').classList.add('hidden')
    const tokens = tokenize(text)
    const sourceLines = text.split(/\r?\n/)
    const lines = []
    tokens.forEach((t, i) => {
      if (!lines.length || lines[lines.length - 1].line !== t.line) lines.push({ line: t.line, html: '' })
      lines[lines.length - 1].html += `<span class="token" data-i="${i}">${esc(t.text)}</span>`
    })
    const picked = new Set()
    let anchor = -1
    openModal(
      `<div class="modal-head">${esc(title)} <span class="muted">· 点击选词，Shift+点击选范围，双击选整行</span></div>
       <div class="tokens">${lines.map((l) => `<div class="token-line">${l.html}</div>`).join('') || '<span class="muted">没有可选的词语</span>'}</div>
       <div class="modal-foot">
         <span class="muted" id="split-count">已选 0 个</span>
         <button data-act="all">全选</button><button data-act="none">清空</button>
         <button data-act="edit">编辑全文</button><button data-act="copy-all">复制全文</button>
         <button data-act="copy">复制所选</button><button class="primary" data-act="paste">粘贴所选</button>
       </div>`,
      (e) => {
        if (e.key === 'Enter') finish('paste')
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !String(getSelection())) finish('copy')
      },
      'wide'
    )
    // 不同行之间换行；同一行内相邻的词保留原文中的空格，其余按分词规则拼接
    const pickedText = () => {
      let out = ''
      let prev = null
      for (const i of [...picked].sort((a, b) => a - b)) {
        const t = tokens[i]
        if (prev && t.line !== prev.line) out += '\n'
        else if (prev && i === prev.index + 1 && /\s/.test(sourceLines[t.line].slice(prev.end, t.start))) out += ' '
        else if (prev && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t.text)) out += ' '
        out += t.text
        prev = { ...t, index: i }
      }
      return out
    }
    const update = () => {
      document.querySelectorAll('.token').forEach((el) => el.classList.toggle('on', picked.has(+el.dataset.i)))
      $('#split-count').textContent = `已选 ${picked.size} 个`
    }
    const finish = (act) => {
      if (act === 'copy-all') {
        closeModal()
        services.copyText(text)
        return toast('已复制全文')
      }
      if (act === 'edit') return App.showResult(title, text)
      if (!picked.size) return toast('请先选择词语')
      const result = pickedText()
      closeModal()
      if (act === 'copy') {
        services.copyText(result)
        toast('已复制')
      } else {
        services.pasteText(result)
      }
    }
    const body = $('#modal-body')
    body.onclick = (e) => {
      const tok = e.target.closest('.token')
      if (tok) {
        const i = +tok.dataset.i
        if (e.shiftKey && anchor >= 0) {
          for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) picked.add(k)
        } else {
          picked.has(i) ? picked.delete(i) : picked.add(i)
          anchor = i
        }
        return update()
      }
      const act = e.target.closest('[data-act]')
      if (!act) return
      const a = act.dataset.act
      if (a === 'all') tokens.forEach((_, i) => picked.add(i))
      else if (a === 'none') picked.clear()
      else return finish(a)
      update()
    }
    body.ondblclick = (e) => {
      const tok = e.target.closest('.token')
      if (!tok) return
      const line = tokens[+tok.dataset.i].line
      const indexes = tokens.map((t, i) => (t.line === line ? i : -1)).filter((i) => i >= 0)
      const all = indexes.every((i) => picked.has(i))
      indexes.forEach((i) => (all ? picked.delete(i) : picked.add(i)))
      update()
    }
    // Shift+点击时不选中页面文字
    body.onmousedown = (e) => {
      if (e.shiftKey && e.target.closest('.token')) e.preventDefault()
    }
  }
}

// ---------- 切换 / 设置 ----------
function switchTab(tab) {
  if (state.tab === tab) return
  state.tab = tab
  exitMulti()
  refresh()
}

function showNotice() {
  let seen = null
  try { seen = window.ztools.dbStorage.getItem(NOTICE_KEY) } catch {}
  if (seen === NOTICE.version) return
  openModal(
    `<div class="modal-head">${esc(NOTICE.title)}</div>
     <ul class="notice">${NOTICE.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
     <div class="modal-foot"><button class="primary" data-act="ok">知道了</button></div>`
  )
  const done = () => {
    try { window.ztools.dbStorage.setItem(NOTICE_KEY, NOTICE.version) } catch {}
    closeModal()
  }
  $('#modal-body [data-act=ok]').onclick = done
  modalKeyHandler = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') done()
  }
}

// ---------- 事件 ----------
document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')
  if (tab) switchTab(tab.dataset.tab)
})

$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip')
  if (!chip) return
  if (chip.dataset.filter !== undefined) state.filter = chip.dataset.filter
  if (chip.dataset.tag !== undefined) state.tag = chip.dataset.tag
  refresh()
})

searchEl.addEventListener('input', () => {
  state.keyword = searchEl.value
  refresh()
})

listEl.addEventListener('click', (e) => {
  const row = e.target.closest('.row')
  if (!row) return
  const idx = +row.dataset.idx
  const item = state.list[idx]
  const btn = e.target.closest('[data-action]')
  if (btn) return runAction(btn.dataset.action, item)
  if (e.target.closest('[data-more]')) {
    const rect = e.target.closest('[data-more]').getBoundingClientRect()
    return showMenu(item, rect.left, rect.bottom + 4)
  }
  setCursor(idx)
  if (state.multi) toggleSelect(item)
  else App.copy([item])
})

listEl.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row')
  if (!row || state.multi || e.target.closest('button')) return
  App.paste([state.list[+row.dataset.idx]])
})

listEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row')
  if (!row) return
  e.preventDefault()
  setCursor(+row.dataset.idx)
  showMenu(state.list[+row.dataset.idx], e.clientX, e.clientY)
})

listEl.addEventListener('scroll', () => {
  hideMenu()
  if (listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 300) renderMore()
})

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#menu')) hideMenu()
})

$('#modal').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modal') closeModal()
})

$('#multi-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-multi]')
  if (!btn) return
  const items = selectedItems()
  const act = btn.dataset.multi
  if (act === 'exit') return exitMulti()
  if (act === 'all') {
    state.list.forEach((i) => state.selected.add(i.id))
    renderList(true)
    return renderMultiBar()
  }
  if (!items.length) return toast('请先选择条目')
  if (act === 'copy') App.copy(items)
  if (act === 'paste') App.paste(items)
  if (act === 'fav') App.favorite(items)
  if (act === 'delete') App.remove(items)
})

$('#btn-settings').innerHTML = icon('settings')
$('#btn-settings').addEventListener('click', () => Settings.open())

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return
  if (isModalOpen()) {
    if (modalKeyHandler) modalKeyHandler(e)
    if (e.key === 'Escape' && isModalOpen()) {
      e.preventDefault()
      closeModal()
    }
    return
  }
  if (Settings.isOpen()) {
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.code === 'Comma'))) {
      e.preventDefault()
      Settings.close()
    }
    return
  }
  if (!$('#menu').classList.contains('hidden') && e.key === 'Escape') {
    e.preventDefault()
    return hideMenu()
  }

  const ctrl = e.ctrlKey || e.metaKey
  const key = e.key
  const lower = key.toLowerCase()
  const inSearch = document.activeElement === searchEl
  const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  const digit = digitMatch ? +digitMatch[1] : 0
  let handled = true

  if (key === 'ArrowDown' || (ctrl && lower === 'j')) setCursor(state.cursor + 1)
  else if (key === 'ArrowUp' || (ctrl && lower === 'k')) setCursor(state.cursor - 1)
  else if (key === 'Enter') App.paste(targetItems())
  else if (key === 'Tab') switchTab(state.tab === 'history' ? 'fav' : 'history')
  // Ctrl+1 / Ctrl+2 切换栏；其余 Ctrl/Alt+数字 粘贴第 N 条
  else if (ctrl && !e.altKey && (digit === 1 || digit === 2)) switchTab(digit === 1 ? 'history' : 'fav')
  else if ((ctrl || e.altKey) && digit) {
    if (state.list[digit - 1]) App.paste([state.list[digit - 1]])
  } else if (ctrl && lower === 'f') {
    searchEl.focus()
    searchEl.select()
  } else if (ctrl && (key === ',' || e.code === 'Comma')) Settings.open()
  else if (key === ' ' && !inSearch) {
    const item = currentItem()
    if (!state.multi) enterMulti()
    if (item) toggleSelect(item)
  } else if (key === 'Escape') {
    if (state.keyword) {
      searchEl.value = ''
      state.keyword = ''
      refresh()
    } else if (state.multi) exitMulti()
    else handled = false // 交给 ZTools 处理（退出插件）
  } else {
    handled = false
    // 直接打字自动进入搜索
    if (!inSearch && !ctrl && !e.altKey && (key.length === 1 || key === 'Backspace')) searchEl.focus()
  }
  if (handled) e.preventDefault()
})

// ---------- 初始化 ----------
function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
}

function onEnter() {
  services.sync()
  closeModal()
  Settings.close()
  hideMenu()
  state.keyword = ''
  searchEl.value = ''
  state.multi = false
  state.selected.clear()
  refresh()
  listEl.scrollTop = 0
  try {
    window.ztools.removeSubInput()
    window.ztools.subInputBlur()
  } catch {}
  searchEl.blur()
  showNotice()
}

;(function init() {
  const zt = window.ztools
  if (zt) {
    try { applyTheme(zt.isDarkColors()) } catch {}
    try { zt.onThemeChange((info) => applyTheme(info.isDark)) } catch {}
    zt.onPluginEnter(onEnter)
  }
  services.onChange(scheduleRefresh)
  refresh()
  showNotice()
})()
