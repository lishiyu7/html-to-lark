---
name: html-to-lark
description: 把本地单文件 HTML 网页发布成飞书云文档——正文整篇是一个 HTML 块，样式、脚本、交互、受众开关全部原样保留。当用户说「把这个 HTML 发到飞书 / 发成飞书文档 / 让同事看这个网页 / 不想部署网站怎么分享 / 转成飞书文档发给别人」，或刚用 answer-me-with-html 产出单文件 HTML 后想要一个可转发的链接时使用。不用于把 HTML 重排成飞书原生排版（那是重建内容，不是发布），也不用于部署公网站点。
---

# html-to-lark

本地 HTML → 飞书云文档，正文**整篇一个 HTML 块**。同事点链接就能看 —— 不需要域名、不需要 CI、不需要内网穿透。

## 三步

```bash
# 1 准备（校验 / 内联本地图片 / 组装 XML）
node scripts/prepare.js <输入.html> --out-dir .h2l-build

# 2 先在本地看一眼（别跳）
#    用浏览器打开 .h2l-build/block.html —— 内联图片后长什么样，只有打开才知道

# 3 发布（发布 + 权限核查 + 回执，一步到位）
node scripts/publish.js .h2l-build
```

**第 2 步为什么不能跳**：图片内联、样式继承这类问题，在飞书里才发现就要重发一遍。
本地打开是零成本的最后一道检查。

**发布脚本会自动打印回执四项**：文档链接 / 分享范围 / 页宽提示 / 服务端提醒。
把回执**原样转给用户**（页宽提示里那两句注意事项不能省，理由见下）。

### 报告要转述的

`prepare.js` 的输出里有两类必须讲给用户，否则会拿到坏页面：

- **内联失败的图片**（文件缺失 / 不是图片类型）→ 块内一定加载不到。
- **其余本地引用**（`./app.js`、`./style.css`）→ 脚本**只内联图片**，这些要用户自己改。

## 硬约束

| 约束 | 值 |
|---|---|
| HTML 总长 | **≤ 500KB / 每块**（不是整篇文档的上限） |
| 文档可用宽度 | ≈ **820px**，所有读者一致，按此验收排版 |
| 必须注入的 meta | `use-iframe` / `html-box-height-mode` / `description`（脚本已做） |
| `description` → 块的 `alt` | `alt` 是这个块**唯一的索引面** |
| 本地图片 | 自动内联为 `data:` URI；否则一定加载不到 |
| 其余本地引用 | 一定加载不到，**不自动处理** |
| 外部 URL | 可以加载；但读者网络不通该域名仍会失败 |
| 高度模式 | 默认 `auto`；单屏类（deck / dashboard）用 `--height viewport` |

> 每条都有实测依据，证据与「为什么」见 [references/lark-html5-block.md](references/lark-html5-block.md)。
> **本文件只留结论，不重复证据** —— 单一事实源。

## 超限时：先问，再拆（**不要自动拆**）

超过 500KB 时 `prepare.js` 会硬失败，并给出两条路。**先把代价讲清楚，再问用户要不要拆。**

要转述的代价（原文照用）：

1. **每块都要重背一遍 `<head>` / CSS / JS** —— 省下的**远少于一半**。
2. **跨块不共享状态** —— 受众开关这类交互会**每块各一套**，读者要切多次。
3. **块与块之间在文档里是可见的分隔**，不再是一整页。

用户同意后：

```bash
node scripts/prepare.js <输入.html> --out-dir .h2l-build --split-at h2   # h1 / h2 / h3
```

拆完仍有块超限 → 换更靠上的层级（`h2` → `h1`）重试。

## 更新已有文档（链接不变，同事刷新即新版）

顺序是 **先 pull → 再改 → 再上传**：

```bash
# 1 把文档里的块拉回本地（消化漂移，同时拿到最新内容）
node scripts/pull.js <飞书文档URL> --out 拉回来的.html

# 2 在「拉回来的.html」上改（或直接改你自己的源文件）

# 3 推回去
node scripts/prepare.js 拉回来的.html --out-dir .h2l-build
node scripts/publish.js .h2l-build --doc <飞书文档URL>
```

### 为什么要先 pull

块是本地 HTML 的**单向投影**。有人在飞书里直接改了块，那份改动**只存在于文档里**，
直接更新会把它静默覆盖掉。

`publish.js` 内置**漂移守卫**：更新前比对「文档里现在的块」与「上次由本工具推上去的」指纹。
不一致 → **拒绝覆盖**，打印两个 sha 并给出 pull 命令。`--force` 可强行覆盖（确认那些改动不要了才用）。

守卫的记忆按**文档 ID** 存在 `~/.html-to-lark/state.json`。`pull.js` 成功后会记下
「已看过文档当前状态」，所以 **pull → 改 → 上传这条正常流程不会被自己的守卫挡住**。

### 其他边界

- 文档里有**多个** html5-block 时，更新与拉取都会**拒绝**（不猜是哪一个），需用 `--block-index N` 或人工确认。
- 更新走 `block_replace`，**只替换那一个块** —— 文档里的标题、其他段落、原生内容都不动（实测验证）。
  （对比：`docs +update --command overwrite` 会清空整篇文档，别用。）

## 出问题读哪

| 症状 | 读这个 |
|---|---|
| 认证 / 登录态 / 缺 scope / 版本过低 | `lark-cli skills read lark-shared`（**本 skill 不重复官方配置流程**） |
| html5-block 为什么会这样、实测证据 | [references/lark-html5-block.md](references/lark-html5-block.md) |
| 脚本到底做了什么 | 直接读 `scripts/*.js` —— 五个文件、无外部依赖、无隐藏步骤（`cli.js` 是共用的 CLI 调用层，`state.js` 是漂移指纹存储） |

**依赖**：`lark-cli` ≥ **1.0.98**（html5-block 在此之前的文档里没有）、Node ≥ 10。
**不做事前检查** —— 调用失败时报的错就是最好的提示，照着修即可。

## 验证范围

**Windows 11 + Git Bash + Node v22 + lark-cli 1.0.98** 实测通过。
**macOS / Linux 未验证**：脚本只用 Node 标准库（理论可跑），但 `publish.js` 的 CLI 定位与
安装方式（PowerShell junction）是 Windows 特有的，移植前请先测。
