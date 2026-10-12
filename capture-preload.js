// 截图 / 贴图窗口的预加载脚本：只负责与插件主页面通信，记录读写都由主页面完成
const { ipcRenderer } = require('electron')

let winId = null
let direct = true

window.shotHost = {
  // 发送给插件主页面
  send: (type, payload = {}) => window.ztools.sendToParent('shot', { type, ...payload }),
  // 接收插件主页面的消息
  on: (fn) => ipcRenderer.on('shot', (_event, msg) => fn(msg)),
  setWindowId: (id) => {
    winId = id
  },
  // 调整本窗口（移动、缩放、透明度、置顶）。ZTools 允许插件子窗口直接调用自己窗口的方法，
  // 比经插件主页面转发少两次进程间通信；不可用时退回由主页面转发
  windowOp: (op, ...args) => {
    if (direct && winId != null) {
      try {
        const result = ipcRenderer.sendSync('plugin.api', 'pluginBrowserWindowMethod', { id: winId, method: op, args })
        if (!(result instanceof Error)) return
      } catch {}
      direct = false
    }
    window.shotHost.send('win', { op, args })
  }
}
