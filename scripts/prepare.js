#!/usr/bin/env node
'use strict';
/**
 * html-to-lark · 准备阶段
 *
 * 把一个本地单文件 HTML 加工成可发布到飞书文档的形态：
 *   1. 校验        文件存在 / 是 HTML / 未超 500KB 硬上限
 *   2. 扫描引用    分清「本地相对引用」（块内一定加载不到）与「外部 URL」（可加载）
 *   3. 注入 meta   use-iframe / html-box-height-mode / description 三条
 *   4. 组装 XML    doc.xml（<title> + <html5-block path>）+ block.html
 *
 * 不负责发布——发布走 lark-cli，见 SKILL.md。
 *
 * 用法：
 *   node prepare.js <输入.html> [--out-dir .h2l-build] [--height auto|viewport]
 *                   [--title 标题] [--description 摘要]
 */

const fs = require('fs');
const path = require('path');

const LIMIT = 500 * 1024; // 官方硬上限：HTML 总长 500KB

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const outDir = opt('out-dir', '.h2l-build');
const height = opt('height', 'auto');
const titleOverride = opt('title', '');
const descOverride = opt('description', '');

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

if (!input) die('用法: node prepare.js <输入.html> [--out-dir .h2l-build] [--height auto|viewport]');
if (!fs.existsSync(input)) die('文件不存在: ' + input);
if (height !== 'auto' && height !== 'viewport') die('--height 只能是 auto 或 viewport，收到: ' + height);

let html = fs.readFileSync(input, 'utf8');
const bytes = Buffer.byteLength(html, 'utf8');
const report = { input, bytes, limit: LIMIT, local: [], external: [], chrome: [], metas: [], warnings: [], errors: [] };

// ── 1. 校验 ─────────────────────────────────────────────────────────────
if (bytes > LIMIT) {
  die(
    'HTML 超过飞书硬上限：' + bytes + 'B > ' + LIMIT + 'B（500KB）。\n' +
    '  这不是策略问题，是平台上限，写进去会失败。\n' +
    '  最常见的元凶：内联的大图片 / Base64 / 字体 / 长 JSON。把它们改成外链 URL 再来。'
  );
}
if (!/^\s*(<!doctype|<html)/i.test(html)) {
  report.warnings.push('文件不像完整 HTML（开头既不是 <!doctype 也不是 <html>）——块会原样存储，可能渲染异常。');
}

// ── 2. 扫描引用 ─────────────────────────────────────────────────────────
// 本地相对引用在块里一定加载不到：块只是存进 reference_map 的一段文本，
// 没有托管、没有同目录文件。外部 URL 则可以加载（实测：外部 JS/CSS/图片全通）。
const isExternal = (u) => /^(https?:)?\/\//i.test(u);
const isInlineOrAnchor = (u) => /^(data:|blob:|#|mailto:|tel:|javascript:|about:)/i.test(u);

function classify(url, where) {
  const u = url.trim();
  if (!u || isInlineOrAnchor(u)) return;
  if (isExternal(u)) {
    report.external.push({ url: u, where });
  } else {
    report.local.push({ url: u, where });
  }
}

const refRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
let m;
while ((m = refRe.exec(html))) classify(m[1], '标签属性');

// url() / @import 只扫 CSS 上下文（<style> 块与 style="..." 属性）。
// 否则会误伤 JS——实测踩过：canvas 的 toDataURL('image/png') 被当成 CSS url(image/png)。
const cssRegions = [];
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
while ((m = styleRe.exec(html))) cssRegions.push({ text: m[1], where: 'CSS <style>' });
const inlineStyleRe = /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/gi;
while ((m = inlineStyleRe.exec(html))) cssRegions.push({ text: m[1] || m[2], where: 'style 属性' });

for (const region of cssRegions) {
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = urlRe.exec(region.text))) classify(m[1], region.where);
  const impRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi;
  while ((m = impRe.exec(region.text))) classify(m[1], region.where);
}

if (/<base\s[^>]*href=/i.test(html)) {
  report.warnings.push('<base href> 存在——块内相对路径的解析基准不可靠。');
}

// ── 3. 检测读者交互 chrome ───────────────────────────────────────────────
// 注意：只有真正的「元素」才算。am 运行时源码里的 document.querySelector('[data-am="reply"]')
// 是选择器字符串，不是标记——按字符串计数会误报（这个坑踩过）。
for (const name of ['reply', 'remark', 'copy', 'copy-code']) {
  const elRe = new RegExp('<[a-zA-Z][^>]*\\sdata-am\\s*=\\s*["\']' + name + '["\'][^>]*>', 'g');
  const hits = html.match(elRe);
  if (hits) {
    for (const h of hits) html = html.replace(h, '');
    report.chrome.push({ name, removed: hits.length });
  }
}
const srcOpen = '<textarea id="am-source"';
if (html.includes(srcOpen)) {
  const a = html.indexOf(srcOpen);
  const b = html.indexOf('</textarea>', a);
  if (b > 0) {
    html = html.slice(0, a) + html.slice(b + '</textarea>'.length);
    report.chrome.push({ name: 'am-source 草稿副本', removed: 1 });
  }
}

// ── 4. 注入三条 meta ────────────────────────────────────────────────────
// am 产物一条都没有；官方称「必须声明」，且 CLI 原样写入、不校验——
// 声明错了不报错，只有打开页面才看得出来。
const hasMeta = (name) => new RegExp('<meta[^>]*\\sname\\s*=\\s*["\']' + name + '["\']', 'i').test(html);

const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
const titleFromDoc = tm ? tm[1].trim() : '';
const title = titleOverride || titleFromDoc || path.basename(input, path.extname(input));
if (!titleFromDoc && !titleOverride) {
  report.warnings.push('HTML 没有 <title>，文档标题回落到文件名「' + title + '」。建议补一个。');
}

const dm = html.match(/<meta[^>]*\sname\s*=\s*["\']description["\'][^>]*\scontent\s*=\s*["']([^"']*)["']/i);
const description = descOverride || (dm ? dm[1].trim() : '') || title;
if (!dm && !descOverride) {
  report.warnings.push('HTML 没有 <meta name="description">，块的 alt 回落到标题「' + description + '」。alt 是这个块唯一的索引面，建议认真写。');
}
if (!titleFromDoc && !titleOverride) report.warnings.push('文档标题非取自 <title>。');

const metaLines = [];
if (!hasMeta('use-iframe')) metaLines.push('  <meta name="use-iframe" content="true">');
if (!hasMeta('html-box-height-mode')) metaLines.push('  <meta name="html-box-height-mode" content="' + height + '">');
if (!hasMeta('description')) metaLines.push('  <meta name="description" content="' + description.replace(/"/g, '&quot;') + '">');

if (metaLines.length) {
  const anchor = html.match(/<meta\s+charset\s*=\s*["']?[^>]*>/i) || html.match(/<head[^>]*>/i);
  if (!anchor) die('找不到 <meta charset> 或 <head>，不敢乱插 meta。请确认这是完整 HTML。');
  const at = anchor.index + anchor[0].length;
  const block = '\n' + metaLines.join('\n') + '  <!-- html-to-lark: 以上三条为发布所需，由本工具注入 -->';
  html = html.slice(0, at) + block + html.slice(at);
  report.metas = metaLines.map((l) => l.trim());
} else {
  report.metas = ['（三条 meta 已齐全，未改动）'];
}

// ── 5. 落盘 ─────────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blockPath = path.join(outDir, 'block.html');
const docPath = path.join(outDir, 'doc.xml');
fs.writeFileSync(blockPath, html, 'utf8');
fs.writeFileSync(docPath, '<title>' + esc(title) + '</title><html5-block path="@./block.html"></html5-block>\n', 'utf8');
report.finalBytes = Buffer.byteLength(html, 'utf8');
report.title = title;
report.description = description;
report.height = height;
report.docXml = docPath;

// ── 6. 报告 ─────────────────────────────────────────────────────────────
const L = [];
L.push('html-to-lark 准备完成');
L.push('  输入      ' + input + '  ' + bytes + 'B');
L.push('  输出 HTML ' + blockPath + '  ' + report.finalBytes + 'B  （上限 ' + LIMIT + 'B，余 ' + (LIMIT - report.finalBytes) + 'B）');
L.push('  文档 XML  ' + docPath);
L.push('  文档标题  ' + title);
L.push('  块 alt    ' + description);
L.push('  高度模式  ' + height);

if (report.chrome.length) {
  L.push('');
  L.push('已剥除读者交互 chrome（说明输入来自较老的 am 版本）：');
  for (const c of report.chrome) L.push('  - ' + c.name + ' ×' + c.removed);
} else {
  L.push('');
  L.push('读者交互 chrome：未发现需剥除的元素（am 0.5.0 产物本就没有 reply/remark/copy 工具条）。');
}

L.push('');
if (report.local.length) {
  L.push('⚠ 本地相对引用 ' + report.local.length + ' 处 —— 块内【一定加载不到】，请逐一处理：');
  for (const r of report.local.slice(0, 20)) L.push('    ' + r.url + '   (' + r.where + ')');
  if (report.local.length > 20) L.push('    …另有 ' + (report.local.length - 20) + ' 处');
  L.push('  处理办法：内联进 HTML（注意别撞 500KB），或改成可公开访问的 http(s) URL。');
} else {
  L.push('本地相对引用：无 ✅');
}

if (report.external.length) {
  L.push('');
  L.push('外部 URL ' + report.external.length + ' 处 —— 实测【可以加载】（块有完整网络访问权，无 CSP 限制）。');
  L.push('  但请注意：读者所在网络若不通该域名，就会加载失败（实测境外 CDN 有失败案例）。');
} else {
  L.push('外部 URL：无');
}

if (report.warnings.length) {
  L.push('');
  L.push('提醒：');
  for (const w of report.warnings) L.push('  - ' + w);
}

console.log(L.join('\n'));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
