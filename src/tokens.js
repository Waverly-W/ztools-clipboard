// 分词：插件主界面的分词界面与截图窗口的文字识别共用
// 返回 [{ text, start, punct }]，start 为在 text 中的位置；标点、符号也作为单独的块（punct 为 true），只去掉空白
function segmentWords(text, offset = 0) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' })
    return [...seg.segment(text)]
      .filter((s) => s.segment.trim())
      .map((s) => ({ text: s.segment, start: offset + s.index, punct: !s.isWordLike }))
  }
  return [...text.matchAll(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)].map((m) => ({ text: m[0], start: offset + m.index, punct: !/[\p{L}\p{N}]/u.test(m[0]) }))
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
      if (tokens.length < limit) tokens.push({ text: t.text, line: i, start: t.start, end: t.start + t.text.length, punct: !!t.punct })
    }
  })
  return tokens
}

// 把选中的块拼成文字：不同行之间换行；同一行内相邻的块照搬原文中间的空白（选连续一段时与原文一致），
// 其余按分词规则拼接（英文、数字之间补空格）
function joinPicked(tokens, sourceLines, picked) {
  let out = ''
  let prev = null
  for (const i of [...picked].sort((a, b) => a - b)) {
    const t = tokens[i]
    if (prev && t.line !== prev.line) out += '\n'
    else if (prev && i === prev.index + 1) out += sourceLines[t.line].slice(prev.end, t.start)
    else if (prev && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t.text)) out += ' '
    out += t.text
    prev = { ...t, index: i }
  }
  return out
}

// 估算字符宽度的权重：中文、全角字符为 1，其余约为一半
const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
const charWeight = (c) => (WIDE_CHAR.test(c) ? 1 : /\s/.test(c) ? 0.3 : 0.55)

// 由 OCR 结果（每行的文字、位置、字符边界）分词并算出每个块在图片中的位置。
// 返回 { text, lines, tokens }，块的 box 为相对图片宽高的比例 { x, y, w, h }
function layoutTokens({ width, height, lines }) {
  const text = lines.map((l) => l.text).join('\n')
  const tokens = tokenize(text, 5000)
  for (const t of tokens) {
    const line = lines[t.line]
    const { left, top, right, bottom } = line.box
    let x0 = Infinity
    let x1 = -Infinity
    const chars = line.chars || []
    for (let i = t.start; i < t.end; i++) {
      if (!chars[i]) continue
      x0 = Math.min(x0, chars[i][0])
      x1 = Math.max(x1, chars[i][1])
    }
    // 没有字符边界时按字符宽度在行内估算
    if (!(x1 > x0)) {
      const weights = line.text.split('').map(charWeight)
      const total = weights.reduce((a, b) => a + b, 0) || 1
      const before = weights.slice(0, t.start).reduce((a, b) => a + b, 0)
      const own = weights.slice(t.start, t.end).reduce((a, b) => a + b, 0)
      x0 = left + ((right - left) * before) / total
      x1 = x0 + ((right - left) * own) / total
    }
    t.box = { x: x0 / width, y: top / height, w: (x1 - x0) / width, h: (bottom - top) / height }
  }
  return { text, lines: lines.map((l) => l.text), tokens }
}
