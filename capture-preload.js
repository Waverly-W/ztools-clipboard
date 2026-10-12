// 截图 / 贴图窗口的预加载脚本：只负责与插件主页面通信，记录读写都由主页面完成
const { ipcRenderer } = require('electron')

window.shotHost = {
  // 发送给插件主页面
  send: (type, payload = {}) => window.ztools.sendToParent('shot', { type, ...payload }),
  // 接收插件主页面的消息
  on: (fn) => ipcRenderer.on('shot', (_event, msg) => fn(msg))
}
