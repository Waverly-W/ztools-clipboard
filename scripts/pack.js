// 打包为 ZTools 可安装的 zip：plugin.json 位于压缩包根目录
// 用法：node scripts/pack.js  → dist/<name>-v<version>.zip
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..')
const INCLUDE = ['plugin.json', 'preload.js', 'index.html', 'logo.png', 'lib', 'src']

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function collect(rel) {
  const abs = path.join(ROOT, rel)
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).sort().flatMap((name) => collect(path.join(rel, name)))
  }
  return [rel]
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const { time, day } = dosTime(new Date())
  for (const rel of files) {
    const name = Buffer.from(rel.split(path.sep).join('/'), 'utf8')
    const data = fs.readFileSync(path.join(ROOT, rel))
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + deflated.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const files = INCLUDE.flatMap(collect).filter((f) => !path.basename(f).startsWith('.'))
const outDir = path.join(ROOT, 'dist')
const out = path.join(outDir, `${pkg.name}-v${pkg.version}.zip`)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(out, zip(files))
console.log(`已打包 ${files.length} 个文件 → ${path.relative(ROOT, out)}`)
