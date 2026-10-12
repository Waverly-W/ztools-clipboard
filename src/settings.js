// 设置页
const MAX_TOOLBAR = 8
const REPO_URL = 'https://github.com/Waverly-W/ztools-clipboard'
const LINKS = [
  { name: '作者主页', url: 'https://github.com/Waverly-W' },
  { name: '使用帮助', url: REPO_URL + '#readme' },
  { name: '论坛', url: 'https://github.com/ZToolsCenter/ZTools/discussions' },
  { name: '开源地址', url: REPO_URL }
]

const HANDLER_OPTIONS = [['builtin', '内置功能'], ['provider', 'ZTools 服务'], ['redirect', '转给插件指令'], ['url', '打开网址']]
const PROVIDER_OPTIONS = [['translation', '翻译'], ['ocr', 'OCR 文字识别']]
const OCR_ENGINES = [['auto', '自动：优先 ZTools OCR 服务，没有时用系统识别'], ['provider', '只用 ZTools OCR 服务'], ['system', '只用系统文字识别']]
const IMAGE_HOST_MODES = [['picgo', 'PicGo / PicList'], ['custom', '自定义接口']]
const IMAGE_FORMATS = [['url', '图片地址'], ['markdown', 'Markdown'], ['html', 'HTML']]
const ACTION_TYPES = [['text', '文字'], ['image', '图片'], ['file', '文件']]

const JSON_HELP = `handler 决定处理方式：
  builtin  内置功能，builtin 为 wordCount / color / qrcode / ocr / imageHost / imageSearch
  provider ZTools 中已启用的服务，provider 为 translation / ocr；翻译没有服务时打开 url（可选）
  redirect 转给其他插件的指令，redirect 为 "指令名" 或 ["插件名", "指令名"]
  url      打开网址，{text} 会被替换为内容
types 为适用类型（text / image / file），match 为文字需匹配的正则（可选）`

function options(list, value) {
  return list.map(([v, label]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')
}

function field(label, control, hint = '') {
  return `<label class="field"><span>${esc(label)}</span>${control}</label>${hint ? `<p class="muted hint">${hint}</p>` : ''}`
}

function setStatus(el, status) {
  el.className = 'status ' + (status ? status.level : '')
  el.textContent = status ? status.message : ''
}

const Settings = {
  el: document.getElementById('settings'),
  actions: [],

  isOpen() {
    return !this.el.classList.contains('hidden')
  },

  open() {
    this.render()
    this.el.classList.remove('hidden')
  },

  close() {
    this.el.classList.add('hidden')
    this.el.innerHTML = ''
  },

  // 保存配置并刷新主界面
  save(patch) {
    services.setConfig(patch)
    Actions.reset()
    App.refresh({ keepCursor: true })
  },

  render() {
    const config = services.getConfig()
    const status = services.listenerStatus()
    const commands = services.listCommands()
    this.actions = config.customActions
    const modeText = status.mode === 'native'
      ? '<span class="ok">已安装监听程序，正在使用原生监听</span>'
      : '<span class="warn">未检测到监听程序，正在使用内置轮询监听（可正常记录，资源占用略高）</span>'

    this.el.innerHTML = `
      <div class="settings-head">
        <span>设置</span>
        <button class="icon-btn" data-s="close" title="关闭 (Esc)">${icon('close')}</button>
      </div>
      <div class="settings-body">
        <section>
          <h3>剪贴板监听</h3>
          <p>${modeText}</p>
          <details>
            <summary>安装说明</summary>
            <ol>
              <li>准备一个监听程序：剪贴板内容每变化一次，就向标准输出打印一行文字（内容不限）。</li>
              <li>把它重命名为 <code>${esc(status.path.split(/[\\/]/).pop())}</code>，放到下面的目录（macOS / Linux 需执行 <code>chmod +x</code> 赋予执行权限）：<br><code>${esc(status.path)}</code></li>
              <li>点击「重新检测」。未安装时插件会自动使用内置的轮询方式记录，功能不受影响。</li>
              <li>插件在后台运行期间才会记录；彻底退出插件或重启 ZTools 后，需要重新打开一次插件。</li>
            </ol>
          </details>
          <div class="btns"><button data-s="listener-dir">打开目录</button><button data-s="listener-check">重新检测</button></div>
        </section>

        <section>
          <h3>记录存放位置</h3>
          <p class="path">${esc(config.dataDir)}</p>
          <p class="muted">放到网盘目录（如 iCloud、OneDrive、坚果云）即可在多台设备之间同步。切换到已有记录的目录时直接使用该目录的记录，否则把当前记录复制过去。</p>
          <div class="btns"><button data-s="dir-change">修改</button><button data-s="dir-open">打开</button></div>
        </section>

        <section>
          <h3>记录保留</h3>
          <label class="range">最大记录条数 <input type="range" min="500" max="1000" step="50" value="${config.maxCount}" data-s="maxCount" /><b>${config.maxCount}</b> 条</label>
          <label class="range">最长保存时间 <input type="range" min="1" max="31" step="1" value="${config.maxDays}" data-s="maxDays" /><b>${config.maxDays}</b> 天</label>
          <p class="muted">收藏的内容不受以上限制。</p>
        </section>

        <section id="toolbar-section">${this.toolbarHtml(config)}</section>

        <section>
          <h3>截图</h3>
          <p class="muted">在 ZTools 中输入以下指令即可使用，建议设置全局快捷键。截图会自动记入剪贴板历史。</p>
          <div class="btns">
            <button data-hotkey="截图">设置「截图」快捷键</button>
            <button data-hotkey="截图贴图">设置「截图贴图」快捷键</button>
            <button data-hotkey="截图OCR">设置「截图OCR」快捷键</button>
          </div>
          <details>
            <summary>操作说明</summary>
            <ul class="shortcut-list">
              <li><b>标注</b>：R 矩形、E 椭圆、A 箭头、P 画笔、H 荧光笔、M 马赛克、T 文字、N 序号；按住 Shift 画正方形、圆形或 45° 箭头；Ctrl+Z 撤销，Ctrl+Shift+Z 重做</li>
              <li><b>截图后</b>：Enter / Ctrl+C 复制，Ctrl+S 保存，Ctrl+T / F3 贴图，Ctrl+O OCR 分词，Ctrl+J 跳转剪贴板，Esc 取消</li>
              <li><b>贴图</b>：拖动移动，滚轮缩放，Ctrl+滚轮调透明度，1 恢复原始大小，双击或 Esc 关闭，Ctrl+E 继续标注，右键查看更多操作</li>
              <li><b>剪贴板</b>：历史中的图片可以「贴图」「标注」；OCR 分词和跳转剪贴板会把截图（含标注）记入历史并选中</li>
            </ul>
          </details>
        </section>

        <section>
          <h3>OCR 文字识别</h3>
          ${field('识别方式', `<select data-cfg="ocr.engine">${options(OCR_ENGINES, config.ocr.engine)}</select>`,
            `系统文字识别：${esc(services.systemOcrName())}，无需安装。ZTools OCR 服务由其他插件提供，需在 ZTools 设置中启用。`)}
          <div class="detect"><button data-detect="ocr">检测</button><span class="status" id="status-ocr"></span></div>
        </section>

        <section>
          <h3>图床</h3>
          <div id="image-host-fields">${this.imageHostHtml(config.imageHost)}</div>
          <div class="detect"><button data-detect="imageHost">检测</button><span class="status" id="status-imageHost"></span></div>
        </section>

        <section>
          <h3>自定义操作</h3>
          <p class="muted">条目匹配适用类型（文字还需匹配正则）时，操作才会出现在菜单中。</p>
          <datalist id="dl-plugins">${commands.plugins.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
          <datalist id="dl-cmds">${commands.commands.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
          <div id="action-cards">${this.actions.map((a, i) => this.cardHtml(a, i)).join('')}</div>
          <div class="btns"><button data-s="add-action">添加操作</button><button data-s="detect-all">全部检测</button></div>
          <details class="json-editor">
            <summary>以 JSON 编辑</summary>
            <pre class="help">${esc(JSON_HELP)}</pre>
            <textarea id="custom-actions" spellcheck="false">${esc(JSON.stringify(config.customActions, null, 2))}</textarea>
            <div class="btns"><button class="primary" data-s="custom-save">保存 JSON</button></div>
          </details>
        </section>

        <section>
          <h3>其他</h3>
          <div class="btns">
            <button data-s="reset">恢复默认设置</button>
            <button class="danger" data-s="clear">清空全部记录</button>
          </div>
        </section>

        <section>
          <h3>关于</h3>
          <div class="btns">${LINKS.map((l) => `<button data-link="${esc(l.url)}">${esc(l.name)}</button>`).join('')}</div>
        </section>
      </div>`

    this.bind()
  },

  toolbarHtml(config) {
    return `<h3>主界面操作按钮 <span class="muted" id="toolbar-count">${config.toolbar.length}/${MAX_TOOLBAR}</span></h3>
      <div class="checks">${Actions.all()
        .map((a) => `<label><input type="checkbox" data-toolbar="${esc(a.id)}" ${config.toolbar.includes(a.id) ? 'checked' : ''} />${esc(a.name)}</label>`)
        .join('')}</div>
      <p class="muted">按钮只在适用的条目上显示，其余操作可通过右键或「更多」菜单使用。</p>`
  },

  imageHostHtml(cfg) {
    const input = (key, placeholder = '') => `<input type="text" data-cfg="imageHost.${key}" value="${esc(cfg[key] || '')}" placeholder="${esc(placeholder)}" spellcheck="false" />`
    let fields
    if (cfg.mode === 'picgo') {
      fields = field('服务地址', input('picgoUrl', 'http://127.0.0.1:36677/upload'), '需要先启动 PicGo 或 PicList，并在其设置中开启 Server（默认端口 36677）。')
    } else {
      fields = [
        field('上传地址', input('url', 'https://example.com/upload')),
        field('文件字段名', input('fileField', 'file')),
        field('请求头（JSON）', input('headers', '{"Authorization": "你的 token"}')),
        field('图片地址字段', input('urlPath', 'data.url'), '从接口返回的 JSON 中读取图片地址的路径，如 data.url。检测时会上传一张 1×1 的测试图片。')
      ].join('')
    }
    return field('上传方式', `<select data-cfg="imageHost.mode">${options(IMAGE_HOST_MODES, cfg.mode)}</select>`) +
      fields +
      field('复制格式', `<select data-cfg="imageHost.format">${options(IMAGE_FORMATS, cfg.format)}</select>`, '上传成功后按此格式复制到剪贴板。')
  },

  cardHtml(a, i) {
    const text = (f, value, placeholder, extra = '') =>
      `<input type="text" data-f="${f}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" spellcheck="false" ${extra} />`
    let specific = ''
    if (a.handler === 'builtin') {
      const list = Object.entries(Actions.builtins).map(([k, b]) => [k, b.name])
      specific = `<select data-f="builtin">${options(list, a.builtin)}</select>`
    } else if (a.handler === 'provider') {
      specific = `<select data-f="provider">${options(PROVIDER_OPTIONS, a.provider)}</select>` +
        (a.provider === 'translation' ? text('url', a.url, '未启用翻译服务时打开的网址（可选），{text} 为内容') : '')
    } else if (a.handler === 'redirect') {
      const [plugin, cmd] = Array.isArray(a.redirect) ? a.redirect : ['', a.redirect]
      specific = text('redirectPlugin', plugin, '插件名（可选）', 'list="dl-plugins"') + text('redirectCmd', cmd, '指令名', 'list="dl-cmds"')
    } else {
      specific = text('url', a.url, 'https://example.com/search?q={text}')
    }
    const types = ACTION_TYPES.map(([t, label]) =>
      `<label><input type="checkbox" data-type="${t}" ${(a.types || []).includes(t) ? 'checked' : ''} />${label}</label>`).join('')
    return `<div class="action-card" data-idx="${i}">
      <div class="card-row">
        ${text('name', a.name, '名称', 'class="card-name"')}
        <span class="types">${types}</span>
        <button data-card="detect">检测</button>
        <button class="icon-btn" data-card="remove" title="删除">${icon('trash')}</button>
      </div>
      <div class="card-row"><select data-f="handler">${options(HANDLER_OPTIONS, a.handler)}</select>${specific}</div>
      <div class="card-row">${text('match', a.match, '匹配正则（可选，只对文字生效）')}</div>
      <div class="status" data-status></div>
    </div>`
  },

  // 从表单读取操作；切换处理方式或内置功能时补上对应的默认值
  readCard(card) {
    const prev = this.actions[+card.dataset.idx]
    const get = (f) => {
      const el = card.querySelector(`[data-f="${f}"]`)
      return el ? el.value.trim() : ''
    }
    const next = {
      id: prev.id,
      name: get('name'),
      types: [...card.querySelectorAll('[data-type]:checked')].map((c) => c.dataset.type),
      handler: get('handler')
    }
    if (get('match')) next.match = get('match')
    const switched = next.handler !== prev.handler
    if (next.handler === 'builtin') {
      next.builtin = switched ? 'wordCount' : get('builtin')
      if (switched || next.builtin !== prev.builtin) next.types = [...Actions.builtins[next.builtin].types]
    } else if (next.handler === 'provider') {
      next.provider = switched ? 'translation' : get('provider')
      if (switched || next.provider !== prev.provider) next.types = next.provider === 'ocr' ? ['image'] : ['text']
      if (next.provider === 'translation' && get('url')) next.url = get('url')
    } else if (next.handler === 'redirect') {
      const plugin = switched ? '' : get('redirectPlugin')
      const cmd = switched ? '' : get('redirectCmd')
      next.redirect = plugin ? [plugin, cmd] : cmd
    } else {
      next.url = switched ? '' : get('url')
    }
    return next
  },

  saveActions() {
    const valid = new Set([...BUILTIN_ACTIONS.map((a) => a.id), ...this.actions.map((a) => 'custom:' + a.id)])
    const toolbar = services.getConfig().toolbar.filter((id) => valid.has(id))
    this.save({ customActions: this.actions, toolbar })
    this.el.querySelector('#toolbar-section').innerHTML = this.toolbarHtml(services.getConfig())
    this.el.querySelector('#custom-actions').value = JSON.stringify(this.actions, null, 2)
  },

  onCardChange(card, target) {
    const idx = +card.dataset.idx
    const prev = this.actions[idx]
    const next = this.readCard(card)
    this.actions = this.actions.map((a, i) => (i === idx ? next : a))
    const rerender = ['handler', 'builtin', 'provider'].includes(target.dataset.f)
    if (rerender) {
      card.outerHTML = this.cardHtml(next, idx)
      card = this.el.querySelector(`.action-card[data-idx="${idx}"]`)
    }
    const status = card.querySelector('[data-status]')
    if (!next.name) return setStatus(status, { level: 'error', message: '名称不能为空，未保存' })
    setStatus(status, null)
    this.saveActions()
    if (prev.handler !== next.handler || rerender) this.detectCard(card)
  },

  async detectCard(card) {
    const status = card.querySelector('[data-status]')
    setStatus(status, { level: '', message: '检测中…' })
    setStatus(status, await Actions.detect(this.actions[+card.dataset.idx]))
  },

  async detectService(name) {
    const status = this.el.querySelector('#status-' + name)
    setStatus(status, { level: '', message: '检测中…' })
    if (name === 'ocr') return setStatus(status, await Actions.detectOcr())
    const r = await services.detectImageHost()
    setStatus(status, { level: r.ok ? 'ok' : 'error', message: r.message })
  },

  bind() {
    const el = this.el
    el.onclick = async (e) => {
      const link = e.target.closest('[data-link]')
      if (link) return window.ztools.shellOpenExternal(link.dataset.link)
      const hotkey = e.target.closest('[data-hotkey]')
      if (hotkey) return window.ztools.redirectHotKeySetting(hotkey.dataset.hotkey)
      const detect = e.target.closest('[data-detect]')
      if (detect) return this.detectService(detect.dataset.detect)
      const cardBtn = e.target.closest('[data-card]')
      if (cardBtn) {
        const card = cardBtn.closest('.action-card')
        if (cardBtn.dataset.card === 'detect') return this.detectCard(card)
        const action = this.actions[+card.dataset.idx]
        if (!(await confirmDialog(`删除操作「${action.name}」？`, '删除'))) return
        this.actions = this.actions.filter((a) => a !== action)
        this.saveActions()
        el.querySelector('#action-cards').innerHTML = this.actions.map((a, i) => this.cardHtml(a, i)).join('')
        return
      }
      const btn = e.target.closest('button[data-s]')
      if (!btn) return
      switch (btn.dataset.s) {
        case 'close':
          return this.close()
        case 'listener-dir':
          return services.openListenerDir()
        case 'listener-check':
          services.restartListener()
          this.render()
          return App.toast(services.listenerStatus().mode === 'native' ? '已启用原生监听' : '未检测到监听程序')
        case 'dir-change':
          try {
            if (services.chooseDataDir()) {
              this.render()
              App.refresh()
              App.toast('存放位置已修改')
            }
          } catch (err) {
            App.toast('修改失败：' + err.message)
          }
          return
        case 'dir-open':
          return services.openDataDir()
        case 'add-action': {
          this.actions = [...this.actions, { id: 'a' + Date.now().toString(36), name: '新操作', types: ['text'], handler: 'url', url: '' }]
          this.saveActions()
          const cards = el.querySelector('#action-cards')
          cards.insertAdjacentHTML('beforeend', this.cardHtml(this.actions[this.actions.length - 1], this.actions.length - 1))
          const input = cards.lastElementChild.querySelector('.card-name')
          input.focus()
          input.select()
          return
        }
        case 'detect-all':
          for (const card of el.querySelectorAll('.action-card')) await this.detectCard(card)
          return
        case 'custom-save':
          return this.saveCustomActions()
        case 'reset':
          if (await confirmDialog('恢复默认设置？记录和存放位置不受影响。', '恢复')) {
            services.resetConfig()
            Actions.reset()
            App.refresh({ keepCursor: true })
            this.render()
            App.toast('已恢复默认设置')
          }
          return
        case 'clear':
          if (await confirmDialog('清空全部记录？收藏的内容也会被清空，此操作不可恢复。', '全部清空')) {
            services.clearAll()
            App.toast('已清空')
          }
          return
      }
    }

    el.oninput = (e) => {
      const input = e.target
      if (input.type === 'range') input.nextElementSibling.textContent = input.value
    }

    el.onchange = (e) => {
      const input = e.target
      const card = input.closest('.action-card')
      if (card) return this.onCardChange(card, input)
      if (input.dataset.cfg) {
        const [group, key] = input.dataset.cfg.split('.')
        const value = { ...services.getConfig()[group], [key]: input.value.trim() }
        this.save({ [group]: value })
        setStatus(el.querySelector('#status-' + group), null)
        if (input.dataset.cfg === 'imageHost.mode') el.querySelector('#image-host-fields').innerHTML = this.imageHostHtml(value)
        return
      }
      if (input.type === 'range') this.save({ [input.dataset.s]: +input.value })
      if (input.dataset.toolbar) {
        const toolbar = [...el.querySelectorAll('[data-toolbar]:checked')].map((c) => c.dataset.toolbar)
        if (toolbar.length > MAX_TOOLBAR) {
          input.checked = false
          return App.toast(`最多选择 ${MAX_TOOLBAR} 个`)
        }
        this.save({ toolbar })
        el.querySelector('#toolbar-count').textContent = `${toolbar.length}/${MAX_TOOLBAR}`
      }
    }
  },

  saveCustomActions() {
    let list
    try {
      list = JSON.parse(this.el.querySelector('#custom-actions').value)
      if (!Array.isArray(list)) throw new Error('必须是数组')
      const ids = new Set()
      for (const a of list) {
        if (!a || typeof a !== 'object') throw new Error('每一项必须是对象')
        if (!a.id || !a.name) throw new Error('每一项都需要 id 和 name')
        if (ids.has(a.id)) throw new Error(`id 重复：${a.id}`)
        ids.add(a.id)
        if (!HANDLER_OPTIONS.some(([h]) => h === a.handler)) throw new Error(`「${a.name}」的 handler 只能是 builtin、provider、redirect 或 url`)
        if (a.handler === 'builtin' && !Actions.builtins[a.builtin]) throw new Error(`「${a.name}」的 builtin 不正确`)
        if (a.handler === 'provider' && !['ocr', 'translation'].includes(a.provider)) throw new Error(`「${a.name}」的 provider 只能是 ocr 或 translation`)
        if (a.handler === 'redirect' && !a.redirect) throw new Error(`「${a.name}」需要 redirect`)
        if (a.handler === 'url' && !a.url) throw new Error(`「${a.name}」需要 url`)
        if (!Array.isArray(a.types) || !a.types.length || a.types.some((t) => !['text', 'image', 'file'].includes(t))) {
          throw new Error(`「${a.name}」的 types 只能包含 text、image、file`)
        }
        if (a.match) new RegExp(a.match)
      }
    } catch (err) {
      return App.toast('格式错误：' + err.message)
    }
    this.actions = list
    this.saveActions()
    this.render()
    App.toast('已保存')
  }
}
