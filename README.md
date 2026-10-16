# html-to-lark

把**本地单文件 HTML** 发布成**飞书云文档** —— 正文整篇是一个 HTML 块，样式、脚本、交互全部原样保留。
同事点飞书链接就能看：不需要域名、不需要 CI、不需要内网穿透。

> Publish a local single-file HTML page as a Feishu/Lark doc — the whole body becomes one HTML block.
> Share the doc link instead of deploying a website.

## 为什么需要它

`answer-me-with-html` 这类工具产出的是**本地 HTML 文件**。想给同事看，传统办法是部署网站 ——
要域名、要 CI、要内网穿透，为了「给三个人看一眼」不值当。

飞书文档支持 HTML 块。所以：**发布 → 把链接甩过去**。

## 工作方式

```
输入：说明文档.html（单文件，含样式/脚本/交互）
         │
         ├─ prepare.js   校验 → 内联本地图片 → 注入三条 meta → 组装 XML
         │
输出：.h2l-build/block.html + doc.xml
         │
         └─ publish.js   发布 → 核查分享范围 → 打印回执
                │
         飞书文档链接 ✅  （同事打开即见 HTML 原貌）
```

## 安装

**把这个仓库链接直接丢给你的 Agent，让它装**：

> 帮我安装这个 skill：https://github.com/lishiyu7/html-to-lark

或者手动：

```bash
git clone https://github.com/lishiyu7/html-to-lark.git ~/.claude/skills/html-to-lark
```

想让仓库放在别处、技能目录用链接接进去（**避免实体副本漂移**）：

```bash
# macOS / Linux
ln -s /path/to/html-to-lark ~/.claude/skills/html-to-lark
```
```powershell
# Windows
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\html-to-lark" -Target "D:\path\to\html-to-lark"
```

> 技能根随 Agent 而异：Claude Code 读 `~/.claude/skills`，DSH 读 `~/.dsh/skills`（或 `~/.agents/skills`）。
> **装进一个不被发现的目录 = 装上了但永远不触发** —— 装完确认技能列表里有它。

### 依赖

| 依赖 | 版本 | 说明 |
|---|---|---|
| `lark-cli` | **≥ 1.0.98** | html5-block 在更早版本的文档里没有 |
| Node | **≥ 10** | 脚本只用标准库，无 npm 依赖 |

```bash
lark-cli auth login --domain docs --domain drive
```

**不必提前逐项自检** —— 缺什么，调用时报的错就会直接告诉你。

## 上手

装好后，直接对它说：

> 把这个 HTML 发布到飞书：`/path/to/说明文档.html`

它会跑三步（准备 → **你先在浏览器看一眼** → 发布），最后给你一个飞书文档链接。

日常三种操作，用大白话说就行：

| 你想干什么 | 就这么说 |
|---|---|
| 发一份新的 | 「把这个 HTML 发到飞书：`说明文档.html`」 |
| 改了本地文件，更新原文档 | 「更新那份飞书文档：\<文档链接\>」 |
| **有人在飞书里直接改过块** | 「先把那份文档拉下来：\<文档链接\>」，**改完再上传** |

> 第 3 条为什么会丢东西：块是本地 HTML 的**单向投影**。有人在飞书里改了块，那份改动只存在于文档里，
> 直接更新会把它覆盖掉。所以顺序是 **先 pull → 再改 → 再上传**。
> 工具会替你守着：检测到文档被流程外改过，**拒绝覆盖**并告诉你先 pull（`--force` 可强行覆盖）。

## 命令行用法

```bash
# 新建
node scripts/prepare.js 说明文档.html --out-dir .h2l-build
node scripts/publish.js .h2l-build

# 原地更新（链接不变）
node scripts/prepare.js 说明文档.html --out-dir .h2l-build
node scripts/publish.js .h2l-build --doc <文档链接>

# 把文档里的块拉回本地
node scripts/pull.js <文档链接> --out 拉回来的.html
```

回执会自动打印：文档链接 / 分享范围 / 页宽提示 / 服务端提醒。

超限拆块、多块文档等边界场景见 [SKILL.md](SKILL.md)。

## 硬约束速查

| 约束 | 值 |
|---|---|
| HTML 总长 | ≤ **500KB / 每块**（不是整篇文档的上限） |
| 文档可用宽度 | ≈ **820px**，所有读者一致 |
| 本地图片 | 自动内联为 `data:` URI（否则一定加载不到） |
| 其余本地引用 | 一定加载不到，不自动处理 |
| 外部 URL | 可以加载，但读者网络不通该域名会失败 |

## 验证范围

| 环境 | 状态 | 覆盖到哪一步 |
|---|---|---|
| Windows 11 + Git Bash + Node v22 + lark-cli 1.0.98 | ✅ 实测通过 | prepare / 超限拆块 / 多块读写 / 权限核查 / 原地更新 |
| macOS 15 (arm64) + Node v23 + lark-cli 1.0.98 | ✅ 实测通过 | prepare / 反向用例 / publish 新建 / pull 往返 |
| Linux | ⬜ 未实测 | 脚本只用 Node 标准库；`cli.js` 只有 Windows/`cmd` 特判，POSIX 定位与 macOS 同一分支 |

macOS 那轮的实测数字（同机同输入重跑，产物逐字节一致；**夹具不随仓库分发**）：

| 环节 | 结果 |
|---|---|
| `prepare.js` | 3 张本地图片（含 CSS `url()` 里那张）全部内联为 `data:`；块 **74,975B** / 上限 512,000B；3 条 meta 就位；无残留本地引用。重跑产物与记录**逐字节一致** |
| 反向用例 | 缺图 / `./app.js` / `./style.css` 三类都被点名；`description` 缺失也会提醒 |
| `publish.js` | 新建成功；回读分享范围 `tenant_readable`（组织内获得链接的人可阅读）；**服务端无提醒** |
| `pull.js` | 拉回的块与 `block.html` 用 `cmp` 比对**逐字节一致** → 往返无损 |

`cli.js` 定位 `run.js` **不是 Windows 特有**：除 `lark-cli.cmd` 外，它还会按 POSIX 布局
（shim 在 `bin/`、模块在 `../lib/node_modules/`）和 brew / nvm 的常见前缀依次查找。
macOS 这次命中的就是 Homebrew 的 `bin` → `../lib/node_modules` 这条，**无需任何环境变量**。

### macOS 上唯一会卡住的地方：凭据落盘

`lark-cli` 把 App Secret 存进 **macOS 钥匙串**，同时要在 `~/Library/Application Support/lark-cli`
建配置目录。Agent 跑在只能写工作目录的沙箱里时，这一步会失败，形如：

```
keychain Set failed: mkdir /Users/<you>/Library/Application Support/lark-cli: operation not permitted
```

此时**应用其实已经在租户里建出来了，但本地没留下凭据** —— 扫码那步的成功反而会误导人。
出路两条：放开文件权限重跑，或用 `lark-cli config init --app-id <id> --app-secret-stdin`
把已有应用绑上。这是沙箱环境的事，不是 skill 的事。

## 文档

- [SKILL.md](SKILL.md) — 完整流程、超限拆块、漂移守卫
- [references/lark-html5-block.md](references/lark-html5-block.md) — 全部实测事实与证据
  （含 macOS 端到端实测、本项目几次误判的复盘，以及一个上游 skill 的问题）

## License

MIT
