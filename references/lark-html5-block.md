# 飞书 html5-block 事实与实测记录

本文件记录 `html-to-lark` 依赖的全部外部事实。**每条都标注来源与是否实测**——
「官方这么说」和「我们验过」是两回事，本项目的两次误判都源于把前者当后者。

## 一、它是什么

飞书文档的「文档小组件 · HTML 块」：允许在文档里内嵌一段完整的 HTML，以网页形态渲染。
在 `lark-cli` 的 DocxXML 里对应 `<html5-block>` 标签。

官方内置文档位置（lark-cli ≥ 1.0.98）：
`lark-cli skills read lark-doc references/lark-doc-xml-extended-blocks.md` 的 `## HTML5 block` 章节。

> **版本门槛**：1.0.73 的内置文档里 **0 处**提到 html5-block（只有 OKR），但**读路径已可用**，
> 写路径未验。升级到 **1.0.98** 后写路径实测通过。故本 skill 要求 ≥ 1.0.98。

## 二、写入语法

```xml
<title>文档标题</title><html5-block path="@./block.html"></html5-block>
```

```bash
lark-cli docs +create --doc-format xml --content "@./doc.xml" --parent-position my_library --as user
```

- **[实测] 不需要 `--reference-map`** —— CLI 自动把 `path="..."` 展开进 `document.reference_map`。
- **[实测] 回读**：`docs +fetch --detail full` 得到
  `<html5-block id="…" alt="…" data-ref="html5_1">`，落库 HTML 与源文件 **`cmp` 字节级一致**。
- **[实测] `reference_map` 有两种形态**：`{"path": "@doc-fetch-resources/<doc>/html5_1.html"}`（新建/未改）
  或 `{"data": "<完整 HTML 源码>"}`（更新后）。读取时两种都要处理。

### 更新（原地替换）

```bash
lark-cli docs +fetch --doc <URL> --detail with-ids --as user      # 取当前 block_id
lark-cli docs +update --doc <URL> --command block_replace --block-id <id> \
  --content '<html5-block path="@./block.html"></html5-block>' --as user
```

- **[实测] `block_replace` 会生成一个「新」块 id**，旧的作废 → **连续更新必须重新 fetch 拿 id**。
- **[实测] 文档 URL 不变**，`result: "success"`，`revision_id` 递增。

## 三、HTML 文件的格式要求

官方要求的 `<head>` 声明：

```html
<meta name="use-iframe" content="true">
<meta name="html-box-height-mode" content="auto">   <!-- 或 viewport -->
<meta name="description" content="内容摘要">
```

- **[实测] `description` 会成为该块的 `alt` 属性**（官方说法成立）。
  `alt` 是块**唯一的索引面**（搜索结果里能看到的就它），值得认真写。
- **[实测] 三条 meta 不是平台校验项** —— 用户的样本文档三条全无，仍能正常渲染
  （推测是走飞书 UI 手工粘贴建的块）。`lark-cli` 也是**原样写入、不校验**。
  但为可移植与正确性，本 skill 一律注入。
- **[实测] am 产物（answer-me-with-html 0.5.0）三条 meta 一条都没有**，必须注入。

### 高度模式

- `auto`：普通文档流，正文完整展开。不给根容器设固定高、不加 `overflow:hidden`。
- `viewport`：`100vh` + 内部滚动 / 切页 / 缩放，适合游戏、幻灯片、Dashboard、canvas 编辑器。
- 官方称「页面加载后的内容追加或展开不会由 CLI 刷新高度」，且**明令不要臆造相关 flag**。
- **[实测] 这条对 am 的受众开关不构成问题** —— 用户实测来回切换「运营 / 开发」开关，内容**未被裁切**。

### 内容限制

- **HTML 总长上限 500KB —— 这是【每个块】的上限，不是整篇文档的。**
- 官方建议不要内联大图片 / Base64 / 字体 / 长 JSON/CSV。
- **文档可用宽度约 820px**；根容器宜用 `width:100%; max-width:100%; box-sizing:border-box`。
  **[推演]** 该宽度对所有读者一致，是「同事看到的版面」的唯一硬约束。

#### 500KB 是「每块」上限 —— 实测证据

官方原文只写「HTML 总长度上限为 500KB」，放在 `## HTML5 block` 章节下，读起来是每块；
但「每块」意味着**多块可绕过上限**，这是个大结论，故实测：

- 造两份各 409600B 的 HTML，同一个 `doc.xml` 里放两个 `<html5-block>`；
- `docs +create` **成功**，`new_blocks` 返回**两个** `html5-block`（合计 819200B > 512000B）；
- `docs +fetch` 回读，`reference_map` 落盘 `html5_1.html` 与 `html5_2.html`，**均为完整 409600B**。

→ **确认是每块上限。**

**推论与取舍**：理论上可拆块绕过，但代价使它对 am 类产物**收益很窄**：
每块都要重背一遍 `<head>`/CSS/JS（不是 300+300 而是「150 CSS + 225 内容」×2），
且受众开关会每块各一套（状态不共享）。
故本 skill 的立场是：**默认整篇一个块；超限时先告知代价、征得用户同意，才用 `--split-at` 拆** ——
绝不自动拆，否则用户会在不知情下拿到一个交互不同步的页面。

## 四、外部资源能否加载 —— 实测，推翻预期

原先依据官方「不要内联大图」等建议，**误以为**外链也不保险。实测（自诊断页面，用户肉眼读数）：

| 项 | 结果 |
|---|---|
| 外部脚本（`cdn.bootcdn.net` lodash） | ✅ 加载成功 v4.17.21 |
| 外部样式表（`cdn.bootcdn.net`） | ✅ 已加载 |
| 外部图片 `baidu.com` favicon | ✅ 64px |
| 外部图片 `feishu.cn` favicon | ✅ 48px |
| `fetch` 外部 URL | ✅ 通 |
| 页面自带 CSP meta | **未自带** |
| **本地相对路径 `./test-local.png`** | **❌ 失败** |
| **境外 CDN（`cdn.jsdelivr.net`）** | **❌ 失败** |

**结论**：
1. **块有完整网络访问权，无 CSP 限制** —— 外部 JS / CSS / 图片全部可加载。
2. 真正会失败的只有**本地相对引用**（块是一段文本，没有同目录文件）。
3. 境外 CDN 失败属**读者网络可达性**问题，**不是块的沙箱限制** —— 报告文案不可夸大。

### 本地图片怎么办 —— `data:` URI 实测可渲染

| 方案 | 结论 |
|---|---|
| **`data:` URI 内联**（base64） | ✅ **实测可渲染**（utf8 SVG 与 canvas 生成的 base64 PNG 均成功）。本 skill 默认走这条 |
| 外部 URL | ✅ 可加载，但读者网络不通该域名就失败 |
| 若不动 | ❌ 块内一定加载不到 |

**为什么不能用飞书自己的图片上传**（`docs +media-insert` / `+media-upload --parent-type docx_image`）：
它们产出的是**给飞书原生图片块用的 `file_token`**，由飞书渲染器解析；HTML 块跑在 iframe 里、
是一段自包含文本，**拿不到也用不了 token**。二者是不同机制。
（已核实：另一套内部发布 skill 的「成功嵌入图片」走的正是原生块那条路，
**不可移植到本场景**。）

**托管方案（妙搭）为何不选**：`apps` 是**付费产品**（按 AI 额度计费，官方试用页写明「属于付费产品，限时免费试用中」），
且需 `spark:*` 授权、`+file-sign` 给的是**临时签名 URL**不持久。为「让本地图可见」引入这些不划算。

**代价**：base64 膨胀约 **1/3**，直接受 500KB 上限压制 → 超限时硬失败并列出撑爆体积的图片清单。

## 五、权限

```bash
lark-cli drive permission.public get --token <docx_token> --type docx --as user
```

- **[实测] 该租户新建文档默认 `link_share_entity = "tenant_readable"`**
  （实测值：`comment_entity=anyone_can_view, external_access=true, invite_external=true,
  link_share_entity=tenant_readable, share_entity=anyone`）→ **常规路径无需改权限**。
- `link_share_entity` 枚举：`tenant_readable`（组织内可阅读）/ `tenant_editable` /
  `anyone_readable` / `anyone_editable`（后两者需 `external_access=true`）/ `closed`。
- `drive permission.public patch` 是 **high-risk-write**，CLI 明令：
  > 「requires explicit user confirmation to execute; the agent must NOT add `--yes` on its own」
  → 必须用户确认后才可加 `--yes`。

## 六、页宽 —— 为什么本 skill 不碰

用户曾要求「默认设为全宽」，核实后**撤销**。原因是**原理上不可行**，不是接口缺失：

- 飞书帮助中心明载：页宽
  > 「**仅对设置者生效，不会影响其他阅读者看到的效果**」
  > 「**无法将『全宽』或『较宽』设置为打开任意文档时的默认页面宽度**」
- 官方 API 亦无此字段：docx 元数据 `display_setting` 无页宽项；创建接口 body 仅 `folder_token` + `title`。
- 网上流传的非官方内部接口（`space/api/platform/common_setting/update` + `width_mode=full`）
  即便可用，**效果也只落在设置者自己眼里** —— 与「转发即可看」的诉求正好相反。

**替代方案**：把「在 ~820px 可用宽度下排版正常」作为验收标准（该宽度对所有读者一致），
并在回执里提醒用户自行切换 + 说明该设置只对自己生效。

## 七、本项目踩过的两次误判（留作警示）

1. **「飞书文档没有 HTML 块」** —— 错。凭 `lark-cli` 的 XML 标签表就下了结论。
   教训：**工具的能力边界 ≠ 平台的能力边界**；1.0.73 的文档不全。
2. **「用户样本是未剥的原始渲染」** —— 错。我用**字符串出现次数**（`replyBtn` ×4、`am-source` ×1）
   当证据，而那些字符串全在 am 运行时的 **JS 源码**里（`document.querySelector('[data-am="reply"]')`），
   是**选择器**不是标记。实际 `<button` 全文件仅 5 处：受众开关 ×2、灯箱关闭 ×1、JS 模板内 ×2，
   **am 0.5.0 的独立产物没有任何 reply/remark/copy 工具条**。
   教训：**统计字符串 ≠ 核实语义**；必须取上下文。

   附带发现（**上游问题，未修**）：`write-how-to-use/scripts/clean-am-chrome.js` 瞄准的
   `data-am="reply"` 等**元素**在当前 am 0.5.0 产物中不存在 → 该脚本对其声称支持的版本已是 **no-op**，
   头部注释「在 am 0.5.0 上核实」与实测不符。
