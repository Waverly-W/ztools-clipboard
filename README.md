# 超级剪贴板（ZTools 插件）

记录和管理剪贴板历史，支持 Windows、macOS、Linux。纯 HTML/CSS/JS 实现，无需构建。

## 目录

```
plugin.json        插件配置
preload.js         Node/Electron 能力入口，暴露 window.services
lib/store.js       记录存储（data.json + images/）、去重、过期与上限清理
lib/clipboard.js   读取剪贴板、监听变化
index.html         主界面
src/app.js         列表、搜索、多选、快捷键、弹窗
src/actions.js     内置操作与自定义操作
src/settings.js    设置页
src/icons.js       图标
src/style.css      样式（跟随 ZTools 深浅色）
dev/               浏览器预览（模拟 ztools API），不打包
scripts/pack.js    打包脚本
```

## 打包与安装

```bash
node scripts/pack.js
```

生成 `dist/super-clipboard-v<版本>.zip`（无需安装依赖）。在 ZTools 插件管理页面选择「本地安装」，选中这个 zip 即可。ZTools 本地安装支持 `.zpx` 和 `.zip`，zip 需要 `plugin.json` 位于压缩包根目录，脚本已按此打包。

压缩包只包含 `plugin.json`、`preload.js`、`lib/`、`index.html`、`src/`、`logo.png`。修改代码后更新 `plugin.json` 的 `version` 再重新打包安装。

发布前把 `src/settings.js` 里 `LINKS` 的地址换成实际的作者主页、帮助文档、开源仓库和赞赏页。

## 界面调试

在项目根目录执行 `python3 -m http.server 5178`，打开 `http://localhost:5178/dev/preview.html`（使用模拟的 ztools API）。

## 数据

- 默认存放在 `~/.ztools-clipboard/data/`：`data.json` 保存记录，`images/` 保存图片。
- 设置中可改为网盘目录实现多设备同步；切换到已有记录的目录时直接使用，否则复制当前记录过去。
- 设置（条数上限、保存天数、按钮、自定义操作）保存在 ZTools 的插件存储中，按设备独立。

## 剪贴板监听

插件运行期间（包括退到后台）持续记录：

1. 若存在 `~/.ztools-clipboard/bin/clipboard-listener`（Windows 为 `clipboard-listener.exe`），启动它并在其标准输出每打印一行时读取剪贴板。
2. 否则使用 ZTools 剪贴板事件 + 800ms 轮询（通过内容指纹判断变化）。

密码管理器标记为敏感（`org.nspasteboard.ConcealedType`）的内容不会记录。

## 自定义操作

在设置中以 JSON 编辑，例如：

```json
{ "id": "color", "name": "识别颜色值", "types": ["text"], "match": "^#[0-9a-f]{6}$", "redirect": "颜色" }
```

- `provider`：`"ocr"` 或 `"translation"`，调用 ZTools 中已启用的 OCR / 翻译服务（`ztools.ocr` / `ztools.translate`），结果在弹窗中显示，可修改后复制或粘贴。ZTools 本身不带 OCR 引擎，需要先安装提供 OCR 的插件并在 ZTools 设置中启用。
- `redirect`：转给的指令，`"指令名"` 或 `["插件名", "指令名"]`；图片会先写入剪贴板，再以 Data URL 传递。
- `url`：打开网址，`{text}` 替换为内容。
- `provider`、`redirect`、`url` 三选一；只有类型匹配（文字还需匹配 `match`）时才显示。

默认的「OCR 文字识别」「翻译」使用 `provider`；其余默认操作的指令名（统计字数、颜色、上传到图床、百度识图、识别二维码、备忘快贴）需与已安装插件的实际指令一致，可在设置中修改。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `↑/↓`、`Ctrl+K/J` | 上下移动 |
| `Enter` / 双击 | 粘贴到当前应用（多选时粘贴已选） |
| 单击 | 复制（多选时勾选） |
| `Alt+1~9`、`Ctrl+3~9` | 粘贴第 N 条 |
| `Space` | 进入多选 / 勾选当前项 |
| `Tab`、`Ctrl+1`、`Ctrl+2` | 切换历史 / 收藏 |
| `Ctrl+F` | 聚焦搜索（直接打字也会进入搜索） |
| `Ctrl+,` | 打开设置 |
| `Esc` | 清空搜索 / 退出多选 |

macOS 上 `Ctrl` 也可以用 `Cmd`。由于 `Ctrl+1/2` 用于切换栏，粘贴第 1、2 条请用 `Alt+1/2`。
