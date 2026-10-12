// 记录存储：<dataDir>/data.json 保存条目，<dataDir>/images/ 保存图片。
// 只用普通文件，目录放到网盘里即可多设备同步。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DAY = 24 * 60 * 60 * 1000

function md5(data) {
  return crypto.createHash('md5').update(data).digest('hex')
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
}

class Store {
  constructor(dir) {
    this.items = []
    this.listeners = new Set()
    this.saveTimer = null
    this.open(dir)
  }

  open(dir) {
    this.flush()
    this.dir = dir
    this.file = path.join(dir, 'data.json')
    this.imageDir = path.join(dir, 'images')
    fs.mkdirSync(this.imageDir, { recursive: true })
    this.load()
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.items = Array.isArray(data.items) ? data.items : []
      this.mtime = fs.statSync(this.file).mtimeMs
    } catch {
      this.items = []
      this.mtime = 0
    }
    this.sort()
  }

  // 其他设备（网盘同步）改了文件时重新载入；本地有未写盘的改动时以本地为准
  syncFromDisk() {
    if (this.saveTimer) return false
    let mtime = 0
    try { mtime = fs.statSync(this.file).mtimeMs } catch {}
    if (mtime && mtime !== this.mtime) {
      this.load()
      this.emit()
      return true
    }
    return false
  }

  sort() {
    this.items.sort((a, b) => b.time - a.time)
  }

  save() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 300)
    this.emit()
  }

  flush() {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items }))
    fs.renameSync(tmp, this.file)
    this.mtime = fs.statSync(this.file).mtimeMs
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) {
      try { fn() } catch (e) { console.error(e) }
    }
  }

  get(id) {
    return this.items.find((i) => i.id === id)
  }

  imagePath(item) {
    return item && item.image ? path.join(this.imageDir, item.image) : ''
  }

  // entry: { type: 'text', text } | { type: 'image', png, bitmapHash, width, height } | { type: 'file', files }
  add(entry) {
    this.syncFromDisk()
    let hash
    if (entry.type === 'text') hash = md5('text:' + entry.text)
    else if (entry.type === 'image') hash = 'img:' + entry.bitmapHash
    else hash = md5('file:' + entry.files.map((f) => f.path).join('\n'))

    const now = Date.now()
    const exists = this.items.find((i) => i.hash === hash)
    if (exists) {
      // 重复内容只挪到最前面
      exists.time = now
      this.items.splice(this.items.indexOf(exists), 1)
      this.items.unshift(exists)
      this.save()
      return exists
    }

    const item = { id: newId(), type: entry.type, hash, time: now }
    if (entry.type === 'text') {
      item.text = entry.text
    } else if (entry.type === 'image') {
      item.image = entry.bitmapHash + '.png'
      item.width = entry.width
      item.height = entry.height
      const file = path.join(this.imageDir, item.image)
      if (!fs.existsSync(file)) fs.writeFileSync(file, entry.png)
    } else {
      item.files = entry.files
    }
    this.items.unshift(item)
    this.save()
    return item
  }

  update(id, patch) {
    this.syncFromDisk()
    const item = this.get(id)
    if (!item) return null
    Object.assign(item, patch)
    if (item.type === 'text' && patch.text !== undefined) item.hash = md5('text:' + item.text)
    this.save()
    return item
  }

  remove(ids) {
    this.syncFromDisk()
    const set = new Set(ids)
    const removed = this.items.filter((i) => set.has(i.id))
    this.items = this.items.filter((i) => !set.has(i.id))
    this.removeImages(removed)
    this.save()
  }

  clear() {
    const removed = this.items
    this.items = []
    this.removeImages(removed)
    this.save()
  }

  // 超过保存期限或条数上限的记录删除，收藏不受影响
  cleanup({ maxCount, maxDays }) {
    this.syncFromDisk()
    const deadline = Date.now() - maxDays * DAY
    const keep = []
    const removed = []
    let count = 0
    for (const item of this.items) {
      if (item.fav) keep.push(item)
      else if (item.time < deadline || count >= maxCount) removed.push(item)
      else { count++; keep.push(item) }
    }
    if (!removed.length) return 0
    this.items = keep
    this.removeImages(removed)
    this.save()
    return removed.length
  }

  removeImages(removed) {
    const used = new Set(this.items.map((i) => i.image).filter(Boolean))
    for (const item of removed) {
      if (item.image && !used.has(item.image)) {
        try { fs.unlinkSync(path.join(this.imageDir, item.image)) } catch {}
      }
    }
  }

  // 切换存放位置：目标目录已有记录就直接使用（多设备同步），否则把当前记录复制过去
  moveTo(dir) {
    this.flush()
    if (path.resolve(dir) === path.resolve(this.dir)) return
    const targetFile = path.join(dir, 'data.json')
    if (!fs.existsSync(targetFile)) {
      const targetImages = path.join(dir, 'images')
      fs.mkdirSync(targetImages, { recursive: true })
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, targetFile)
      for (const name of fs.readdirSync(this.imageDir)) {
        fs.copyFileSync(path.join(this.imageDir, name), path.join(targetImages, name))
      }
    }
    this.open(dir)
    this.emit()
  }
}

module.exports = { Store, md5 }
