# 超级剪贴板（ZTools 插件）

记录和管理剪贴板历史，并内置截图工具（定格全屏选区、标注、贴图、OCR 分词），支持 Windows、macOS、Linux。纯 HTML/CSS/JS 实现，无需构建。

## 预览

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/history.png" alt="剪贴板历史"><br><sub>剪贴板历史：按类型筛选，单击选中，Ctrl+C 复制、双击粘贴</sub></td>
    <td width="50%"><img src="docs/screenshots/favorites.png" alt="收藏与标签"><br><sub>收藏：按标签筛选，不受保存期限和条数上限影响</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/screenshot-select.png" alt="定格全屏选区"><br><sub>截图：定格全屏后选区，放大镜显示像素与颜色值</sub></td>
    <td><img src="docs/screenshots/screenshot-annotate.png" alt="截图标注"><br><sub>标注：矩形、箭头、马赛克、文字、序号等，选完原地编辑</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/ocr.png" alt="OCR 分词"><br><sub>OCR 分词：按行显示，网址、电话、金额保持完整，保留标点，点选复制</sub></td>
    <td><img src="docs/screenshots/settings.png" alt="自定义操作"><br><sub>自定义操作：逐项配置并一键检测是否可用</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dark.png" alt="深色模式"><br><sub>深色模式：跟随 ZTools 主题</sub></td>
    <td></td>
  </tr>
</table>

> 截图由 `node dev/readme-shots.js` 使用演示数据自动生成。

## 目录

```
plugin.json        插件配置
preload.js         Node/Electron 能力入口，暴露 window.services
lib/store.js       记录存储（data.json + images/）、去重、过期与上限清理
lib/clipboard.js   读取剪贴板、监听变化
lib/handlers.js    内置操作：系统 OCR、二维码、图床、百度识图、查找其他插件指令
lib/vendor/        jsQR（二维码识别）
index.html         主界面
capture.html       截图标注 / 贴图窗口（capture-preload.js 为其预加载脚本）
src/app.js         列表、搜索、多选、快捷键、弹窗
src/actions.js     内置操作与自定义操作
src/tokens.js      分词（剪贴板分词界面与截图识别文字共用）
src/settings.js    设置页
src/screenshot.js  截图控制：定格全屏 / ZTools 原生截图、管理截图窗口、与剪贴板联动
src/sharpen.js     ZTools 原生截图的清晰化（反推双线性放大）
src/capture.js     截图窗口：选区、标注编辑与贴图
src/icons.js       图标
src/style.css      样式（跟随 ZTools 深浅色）
dev/               浏览器预览（模拟 ztools API）与 README 截图生成脚本，不打包
docs/screenshots/  README 截图
scripts/pack.js    打包脚本
.github/workflows/ 推送 v* 标签时自动打包并发布 Release
```

## 安装

从 [Releases](https://github.com/Waverly-W/ztools-clipboard/releases) 下载 `super-clipboard-v<版本>.zip`，在 ZTools 插件管理页面选择「本地安装」，选中这个 zip 即可。

## 打包

```bash
node scripts/pack.js
```

生成 `dist/super-clipboard-v<版本>.zip`（无需安装依赖，`dist/` 不提交到仓库）。ZTools 本地安装支持 `.zpx` 和 `.zip`，zip 需要 `plugin.json` 位于压缩包根目录，脚本已按此打包。压缩包只包含 `plugin.json`、`preload.js`、`capture-preload.js`、`index.html`、`capture.html`、`lib/`、`src/`、`logo.png`。

## 发布

1. 修改 `plugin.json` 的 `version` 并提交。
2. 推送同名标签，GitHub Actions（`.github/workflows/release.yml`）会校验版本、打包并发布到 Release：

```bash
git tag v1.1.1 && git push origin v1.1.1
```

## 界面调试

在项目根目录执行 `python3 -m http.server 5178`，打开 `http://localhost:5178/dev/preview.html`（使用模拟的 ztools API）；截图窗口为 `dev/capture-preview.html?mode=select`。加上 `demo=1` 使用演示数据，`scene=…` 直接进入某个界面状态（见 `dev/scenes.js`）。

更新 README 截图（需要 Node 22+ 与 Google Chrome）：

```bash
node dev/readme-shots.js
```

## 数据

- 默认存放在 `~/.ztools-clipboard/data/`：`data.json` 保存记录，`images/` 保存图片。
- 设置中可改为网盘目录实现多设备同步；切换到已有记录的目录时直接使用，否则复制当前记录过去。
- 设置（条数上限、保存天数、按钮、自定义操作）保存在 ZTools 的插件存储中，按设备独立。

## 剪贴板监听

插件运行期间（包括退到后台）持续记录：

1. 若存在 `~/.ztools-clipboard/bin/clipboard-listener`（Windows 为 `clipboard-listener.exe`），启动它并在其标准输出每打印一行时读取剪贴板。
2. 否则使用 ZTools 剪贴板事件 + 800ms 轮询（通过内容指纹判断变化）。

密码管理器标记为敏感（`org.nspasteboard.ConcealedType`）的内容不会记录。

## 截图

基于 ZTools 的截图接口（`ztools.screenCapture`）选区，之后的标注、贴图由插件自己的窗口完成。

| 指令 | 作用 |
| --- | --- |
| 截图 | 选区后进入标注 |
| 截图贴图 | 选区后直接贴在屏幕上 |
| 截图OCR | 选区后直接在截图上识别文字并选词 |

三个指令都声明了 `mainHide`，在设置中可一键跳转到 ZTools 快捷键设置，用全局快捷键触发时不会闪出主窗口。

**交互**

- 选区后图片原位显示，工具栏在选区下方（放不下时在上方或选区内）。
- 标注：R 矩形、E 椭圆、A 箭头、P 画笔、H 荧光笔、M 马赛克、T 文字、N 序号；可选颜色和粗细，Shift 约束为正方形 / 圆形 / 45° 箭头；Ctrl+Z 撤销，Ctrl+Shift+Z 重做。
- 完成：Enter / Ctrl+C 复制，Ctrl+S 保存，Ctrl+T / F3 贴图，Ctrl+O 识别文字，Ctrl+J 跳转剪贴板，Esc 取消。
- 识别文字：在截图原位给每个词（包括标点）显示可点选的文字块。点击选词，Shift+点击选范围，拖动框选，双击选整行；Ctrl+C 复制所选（未选时复制全文），Enter 粘贴所选到当前应用，Ctrl+A 全选；也可以「复制全文」或转到剪贴板的「分词界面」，Esc 返回标注。文字位置来自 OCR：系统识别（macOS / Windows / Linux tesseract）总能给出；ZTools OCR 服务返回了行坐标时也会使用。设置为「自动」时优先用能给出位置的方式；只用 ZTools 服务且服务不提供位置时，改在分词界面中打开。
- 贴图：拖动移动，滚轮缩放（以光标为中心），Ctrl+滚轮调透明度，1 恢复原始大小，双击或 Esc 关闭；右键菜单提供复制、保存、OCR、继续标注（之前的标注仍可撤销）、跳转剪贴板、置顶、透明度。

**与剪贴板联动**

- ZTools 截图会写入系统剪贴板，因此每次截图都会自动记入历史；复制标注后的图片也会记入历史。
- 跳转剪贴板：把当前图片（含标注）写入历史，打开剪贴板并选中它。识别文字时图片同样会写入历史。
- 贴图的右键菜单「OCR 分词」仍是跳转剪贴板后在分词界面中识别。
- 历史中的图片可以「贴图」和「标注」。

## 自定义操作

在设置中逐项配置，每个操作都有「检测」按钮（也可「全部检测」），高级用户可展开「以 JSON 编辑」。条目匹配适用类型（文字还需匹配正则）时操作才会出现。

处理方式（`handler`）：

| 处理方式 | 说明 | 检测内容 |
| --- | --- | --- |
| `builtin` 内置功能 | 见下表，插件自己完成 | 依赖的服务是否可用 |
| `provider` ZTools 服务 | 调用 ZTools 中已启用的翻译 / OCR 服务（由其他插件提供）；翻译未启用服务时打开 `url` | 是否有已启用的服务 |
| `redirect` 转给插件指令 | `"指令名"` 或 `["插件名", "指令名"]` | 在 `~/.ztools/plugins` 已安装插件中查找该指令 |
| `url` 打开网址 | `{text}` 替换为内容 | 网址格式 |

内置功能：

| 功能 | 实现 |
| --- | --- |
| 统计字数 | 本地统计字符、汉字、英文单词、数字、标点、行数、段落 |
| 识别颜色值 | 本地解析，显示色块和 HEX / RGB / HSL，点击复制 |
| 识别二维码 | 本地识别（内置 jsQR，Apache-2.0），网址可直接打开 |
| OCR 文字识别 | 结果在分词界面中按行显示，网址、邮箱、电话、日期、金额等保持完整，标点单独成块（选连续一段时保留原文标点），点击选词、Shift+点击选范围、双击选整行，Enter 粘贴所选、Ctrl+C 复制所选，也可复制或编辑全文。设置中选择识别方式：自动（默认，优先 ZTools OCR 服务，没有时用系统识别）/ 只用 ZTools 服务 / 只用系统识别。系统识别：macOS 用 Vision（10.15+），Windows 用 Windows.Media.Ocr（10+，需安装对应语言的 OCR 包），Linux 用 tesseract |
| 上传图床 | PicGo / PicList 本地服务（需开启 Server，默认 `http://127.0.0.1:36677/upload`），或自定义接口（multipart 上传，可配置文件字段名、请求头、返回 JSON 中图片地址的路径）。上传后按设置的格式（地址 / Markdown / HTML）复制 |
| 百度识图 | 在 ZTools 内置浏览器中打开百度识图并自动选择图片，由页面完成上传 |

转给插件指令时遵循 ZTools 的跳转规则：带内容跳转只能进入 `regex` / `over` 类型的指令；目标是普通文字指令或内容是图片 / 文件时，会先把内容复制到剪贴板再打开插件。

从 1.0.x 升级时，未修改过的默认操作会自动换成新的实现，自己改过或新增的操作保持不变。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `↑/↓`、`Ctrl+K/J` | 上下移动 |
| `Enter` / 双击 | 粘贴到当前应用（多选时粘贴已选） |
| 单击 | 选中（多选时勾选） |
| `Ctrl+C` | 复制当前条目（多选时复制已选）；搜索框中选中文字时复制文字 |
| `⌘/Ctrl`+单击 | 进入多选并勾选或取消该条（macOS 用 `⌘`） |
| `Shift`+单击、`Shift+↑/↓` | 从当前条目到目标条目整段选中 |
| `⌘/Ctrl+A` | 全选（焦点不在搜索框时） |
| `Alt+1~9`、`Ctrl+3~9` | 粘贴第 N 条 |
| `Space` | 进入多选 / 勾选当前项 |
| `Tab`、`Ctrl+1`、`Ctrl+2` | 切换历史 / 收藏 |
| `Ctrl+F` | 聚焦搜索（直接打字也会进入搜索） |
| `Ctrl+,` | 打开设置 |
| `Esc` | 清空搜索 / 退出多选 |

macOS 上 `Ctrl` 也可以用 `Cmd`。由于 `Ctrl+1/2` 用于切换栏，粘贴第 1、2 条请用 `Alt+1/2`。
