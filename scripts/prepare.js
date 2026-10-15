#!/usr/bin/env node
'use strict';
/**
 * html-to-lark · 准备阶段
 *
 * 把本地单文件 HTML 加工成可发布到飞书文档的形态：
 *   1. 校验        文件存在 / 是 HTML / 未超 500KB 硬上限
 *   2. 剥旧版 chrome  只剥真正的「元素」，不按字符串计数（踩过坑）
 *   3. 内联本地图片   转 data: URI —— 否则块内一定加载不到（实测）
 *   4. 扫描引用     分清本地相对引用（加载不到）与外部 URL（可加载）
 *   5. 注入 meta    use-iframe / html-box-height-mode / description
 *   6. 组装 XML     doc.xml（<title> + <html5-block path>）+ block.html
 *
 * 不负责发布——发布走 lark-cli，见 SKILL.md。
 *
 * 用法：
 *   node prepare.js <输入.html> [--out-dir .h2l-build] [--height auto|viewport]
 *                   [--title 标题] [--description 摘要] [--no-inline-images]
 */

const fs = require('fs');
const path = require('path');

const LIMIT = 500 * 1024; // 官方硬上限：HTML 总长 500KB

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const outDir = opt('out-dir', '.h2l-build');
const height = opt('height', 'auto');
const titleOverride = opt('title', '');
const descOverride = opt('description', '');
const inlineImages = !argv.includes('--no-inline-images');

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

// 体积可读化：小于 1KB 的按字节显示，别缩成 "0 KB"
const fmt = (b) => (b < 1024 ? b + ' B' : (b / 1024).toFixed(0) + ' KB');
const fmtPad = (b) => fmt(b).padStart(7);

if (!input) die('用法: node prepare.js <输入.html> [--out-dir .h2l-build] [--height auto|viewport] [--no-inline-images]');
if (!fs.existsSync(input)) die('文件不存在: ' + input);
if (height !== 'auto' && height !== 'viewport') die('--height 只能是 auto 或 viewport，收到: ' + height);

const inputDir = path.dirname(path.resolve(input));
let html = fs.readFileSync(input, 'utf8');
const srcBytes = Buffer.byteLength(html, 'utf8');
const report = {
  input, srcBytes, limit: LIMIT,
  inlined: [], skippedLocal: [], unhandledLocal: [], external: [], chrome: [], metas: [], warnings: [],
};

// ── 1. 初步校验 ─────────────────────────────────────────────────────────
if (srcBytes > LIMIT) {
  die('HTML 超过飞书硬上限：' + srcBytes + 'B > ' + LIMIT + 'B（500KB）。\n' +
      '  这不是策略问题，是平台上限，写进去会失败。');
}
if (!/^\s*(<!doctype|<html)/i.test(html)) {
  report.warnings.push('文件不像完整 HTML（开头既不是 <!doctype 也不是 <html>）——块会原样存储，可能渲染异常。');
}

// ── 2. 剥旧版 chrome（按元素，不按字符串）─────────────────────────────────
// am 运行时源码里的 document.querySelector('[data-am="reply"]') 是选择器字符串，不是标记；
// 按字符串计数会误报（这个坑踩过）。
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

// ── 3. 内联本地图片为 data: URI ──────────────────────────────────────────
// 块只是一段存进 reference_map 的文本：没有托管、没有同目录文件，
// 所以 ./img.png 一定加载不到（实测）。data: URI 实测可正常渲染。
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
const isExternal = (u) => /^(https?:)?\/\//i.test(u);
const isInlineOrAnchor = (u) => /^(data:|blob:|#|mailto:|tel:|javascript:|about:)/i.test(u);

function toDataUri(ref) {
  const clean = ref.split('?')[0].split('#')[0];
  const abs = path.resolve(inputDir, clean);
  if (!fs.existsSync(abs)) throw new Error('文件不存在');
  const ext = path.extname(clean).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error('不支持的图片类型 ' + (ext || '(无扩展名)'));
  const buf = fs.readFileSync(abs);
  return { uri: 'data:' + mime + ';base64,' + buf.toString('base64'), raw: buf.length, mime };
}

if (inlineImages) {
  // a) <img src="本地"> / <source src="本地">
  html = html.replace(/(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']+)\2/gi, (all, pre, q, url) => {
    if (isExternal(url) || isInlineOrAnchor(url)) return all;
    try {
      const r = toDataUri(url);
      report.inlined.push({ url, rawBytes: r.raw, mime: r.mime, where: '<img src>' });
      return pre + q + r.uri + q;
    } catch (e) {
      report.skippedLocal.push({ url, reason: e.message, where: '<img src>' });
      return all;
    }
  });

  // b) CSS url(本地图片)
  const inlineCss = (cssText, where) =>
    cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, q, url) => {
      if (isExternal(url) || isInlineOrAnchor(url)) return all;
      const ext = path.extname(url.split('?')[0].split('#')[0]).toLowerCase();
      if (!MIME[ext]) { report.unhandledLocal.push({ url, where, reason: '非图片，未内联' }); return all; }
      try {
        const r = toDataUri(url);
        report.inlined.push({ url, rawBytes: r.raw, mime: r.mime, where });
        return 'url(' + r.uri + ')';
      } catch (e) {
        report.skippedLocal.push({ url, reason: e.message, where });
        return all;
      }
    });

  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, o, body, c) => o + inlineCss(body, 'CSS <style>') + c);
  html = html.replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, (all, pre, q, body) => pre + q + inlineCss(body, 'style 属性') + q);
}

// ── 4. 扫描剩余引用 ─────────────────────────────────────────────────────
const classify = (url, where) => {
  const u = url.trim();
  if (!u || isInlineOrAnchor(u)) return;
  (isExternal(u) ? report.external : report.unhandledLocal).push({ url: u, where });
};

const refRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
let m;
while ((m = refRe.exec(html))) classify(m[1], '标签属性');

// url() / @import 只扫 CSS 上下文，否则会误伤 JS
// （实测踩过：canvas 的 toDataURL('image/png') 被当成 CSS url(image/png)）
const cssRegions = [];
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
while ((m = styleRe.exec(html))) cssRegions.push({ text: m[1], where: 'CSS <style>' });
const inlineStyleRe = /\sstyle\s*=\s*["']([^"']*)["']/gi;
while ((m = inlineStyleRe.exec(html))) cssRegions.push({ text: m[1], where: 'style 属性' });
for (const region of cssRegions) {
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = urlRe.exec(region.text))) classify(m[1], region.where);
  const impRe = /@import\s+(?:url\()?\s*["']([^"']+)["']/gi;
  while ((m = impRe.exec(region.text))) classify(m[1], region.where);
}

// 合并同一 URL 的重复项（扫描阶段对内联后的 data: 已天然跳过）
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
};
report.unhandledLocal = dedupe(report.unhandledLocal);
report.external = dedupe(report.external);

if (/<base\s[^>]*href=/i.test(html)) {
  report.warnings.push('<base href> 存在——块内相对路径的解析基准不可靠。');
}

// ── 5. 注入三条 meta ────────────────────────────────────────────────────
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

const metaLines = [];
if (!hasMeta('use-iframe')) metaLines.push('  <meta name="use-iframe" content="true">');
if (!hasMeta('html-box-height-mode')) metaLines.push('  <meta name="html-box-height-mode" content="' + height + '">');
if (!hasMeta('description')) metaLines.push('  <meta name="description" content="' + description.replace(/"/g, '&quot;') + '">');

if (metaLines.length) {
  const anchor = html.match(/<meta\s+charset\s*=\s*["']?[^>]*>/i) || html.match(/<head[^>]*>/i);
  if (!anchor) die('找不到 <meta charset> 或 <head>，不敢乱插 meta。请确认这是完整 HTML。');
  const at = anchor.index + anchor[0].length;
  html = html.slice(0, at) + '\n' + metaLines.join('\n') +
         '  <!-- html-to-lark: 以上三条为发布所需，由本工具注入 -->' + html.slice(at);
  report.metas = metaLines.map((l) => l.trim());
} else {
  report.metas = ['（三条 meta 已齐全，未改动）'];
}

// ── 6. 最终体积校验（内联之后才算数）──────────────────────────────────────
const finalBytes = Buffer.byteLength(html, 'utf8');
if (finalBytes > LIMIT) {
  const lines = report.inlined
    .slice()
    .sort((a, b) => b.rawBytes - a.rawBytes)
    .map((x) => '    ' + fmtPad(x.rawBytes) + '  →  ' +
                 fmtPad(Math.ceil(x.rawBytes * 4 / 3)) + ' (内联后)  ' + x.url);
  die(
    '内联图片后超过飞书硬上限：' + finalBytes + 'B > ' + LIMIT + 'B（500KB），超出 ' +
    ((finalBytes - LIMIT) / 1024).toFixed(0) + 'KB。\n' +
    '  base64 会让图片膨胀约 1/3，500KB 是平台硬上限、无法绕过。\n' +
    (lines.length ? '  按体积排序的内联清单（压缩最大的那几张，或改成外链）：\n' + lines.join('\n') : '') +
    '\n  也可加 --no-inline-images 先发布不含图的版本。'
  );
}

// ── 7. 落盘 ─────────────────────────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blockPath = path.join(outDir, 'block.html');
const docPath = path.join(outDir, 'doc.xml');
fs.writeFileSync(blockPath, html, 'utf8');
fs.writeFileSync(docPath, '<title>' + esc(title) + '</title><html5-block path="@./block.html"></html5-block>\n', 'utf8');
report.finalBytes = finalBytes;
report.title = title;
report.description = description;
report.height = height;
report.docXml = docPath;

// ── 8. 报告 ─────────────────────────────────────────────────────────────
const L = [];
L.push('html-to-lark 准备完成');
L.push('  输入      ' + input + '  ' + srcBytes + 'B');
L.push('  输出 HTML ' + blockPath + '  ' + finalBytes + 'B  （上限 ' + LIMIT + 'B，余 ' + (LIMIT - finalBytes) + 'B）');
L.push('  文档 XML  ' + docPath);
L.push('  文档标题  ' + title);
L.push('  块 alt    ' + description);
L.push('  高度模式  ' + height);

L.push('');
if (report.inlined.length) {
  L.push('已内联本地图片 ' + report.inlined.length + ' 张（转 data: URI，块内可正常渲染 ✅ 实测）：');
  for (const x of report.inlined.sort((a, b) => b.rawBytes - a.rawBytes)) {
    L.push('    ' + fmtPad(x.rawBytes) + '  ' + x.url + '   (' + x.where + ')');
  }
} else if (inlineImages) {
  L.push('本地图片：无（或全部已内联）');
} else {
  L.push('本地图片：未内联（--no-inline-images）—— 块内将加载不到');
}

if (report.skippedLocal.length) {
  L.push('');
  L.push('⚠ 以下本地图片内联失败，块内【一定加载不到】：');
  for (const x of report.skippedLocal) L.push('    ' + x.url + '   (' + x.reason + ')');
}

if (report.chrome.length) {
  L.push('');
  L.push('已剥除读者交互 chrome（输入来自较老的 am 版本）：');
  for (const c of report.chrome) L.push('  - ' + c.name + ' ×' + c.removed);
}

if (report.unhandledLocal.length) {
  L.push('');
  L.push('⚠ 其余本地引用 ' + report.unhandledLocal.length + ' 处 —— 块内【一定加载不到】，本工具不自动处理（只内联图片）：');
  for (const r of report.unhandledLocal.slice(0, 20)) L.push('    ' + r.url + '   (' + r.where + ')');
  if (report.unhandledLocal.length > 20) L.push('    …另有 ' + (report.unhandledLocal.length - 20) + ' 处');
  L.push('  处理办法：手动内联进 HTML（注意别撞 500KB），或改成可公开访问的 http(s) URL。');
} else {
  L.push('');
  L.push('其余本地引用：无 ✅');
}

if (report.external.length) {
  L.push('');
  L.push('外部 URL ' + report.external.length + ' 处 —— 实测【可以加载】（块有完整网络访问权，无 CSP）。');
  L.push('  但读者所在网络若不通该域名，仍会加载失败（实测境外 CDN 有失败案例）。');
}

if (report.warnings.length) {
  L.push('');
  L.push('提醒：');
  for (const w of report.warnings) L.push('  - ' + w);
}

console.log(L.join('\n'));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
