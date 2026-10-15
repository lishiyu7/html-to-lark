#!/usr/bin/env node
'use strict';
/**
 * html-to-lark · 反向拉取
 *
 * 把飞书文档里那个 HTML 块的内容拉回本地文件。
 *
 * 为什么需要它：块是本地 HTML 的**单向投影** —— publish.js 推上去的是什么，块里就是什么。
 * 如果有人在飞书里直接改了块，那份改动**只存在于文档里**，下一次 publish 会把它覆盖掉。
 * 所以正确的工作流是「**先 pull → 再改 → 再上传**」：
 *   pull 把文档里的当前内容取回来当新的本地事实源，改完再推回去，就不会丢东西。
 *
 * 用法：
 *   node pull.js <飞书文档URL> [--out <本地文件.html>] [--block-index N]
 */

const fs = require('fs');
const path = require('path');
const { runCli, explain } = require('./cli');
const state = require('./state');

const argv = process.argv.slice(2);
const docRef = argv.find((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const outOpt = opt('out', '');
const indexOpt = opt('block-index', '');

function die(msg) { console.error('✖ ' + msg); process.exit(1); }

if (!docRef) die('用法: node pull.js <飞书文档URL> [--out <本地文件.html>] [--block-index N]');

// 让 fetch 落资源到我们指定的目录，别污染 cwd
const outDir = outOpt ? path.dirname(path.resolve(outOpt)) : path.resolve('.');
fs.mkdirSync(outDir, { recursive: true });

const res = runCli(['docs', '+fetch', '--doc', docRef, '--detail', 'full', '--as', 'user'], { cwd: outDir });
if (!res.json || !res.json.ok) die(explain(res, '读取文档'));

const doc = res.json.data.document;
const docId = doc.document_id || docRef.split('/').filter(Boolean).pop();
const content = doc.content || '';

// 从正文里取块的 alt（= 当初写入的 <meta name="description">），用于给用户确认是哪一块
const blocks = [...content.matchAll(/<html5-block\b([^>]*)>/g)].map((m) => {
  const attrs = m[1];
  const alt = (attrs.match(/\balt="([^"]*)"/) || [])[1] || '';
  const ref = (attrs.match(/\bdata-ref="([^"]*)"/) || [])[1] || '';
  return { alt, ref };
});
if (blocks.length === 0) die('这份文档里没有 html5-block，没有东西可拉。');

let idx = 0;
if (blocks.length > 1) {
  if (!indexOpt) {
    const list = blocks.map((b, i) => '    [' + (i + 1) + '] alt=' + (b.alt || '(无)')).join('\n');
    die('文档里有 ' + blocks.length + ' 个 html5-block，无法判断拉哪一个（不猜）。\n' +
        '  用 --block-index N 指定：\n' + list);
  }
  idx = parseInt(indexOpt, 10) - 1;
  if (!(idx >= 0 && idx < blocks.length)) die('--block-index 超出范围（文档里共 ' + blocks.length + ' 块）。');
}

// reference_map 里取内容：可能是 data（内联）也可能是 path（落盘文件）——两种都要处理
const rm = (doc.reference_map && doc.reference_map['html5-block']) || {};
const entry = rm[blocks[idx].ref] || Object.values(rm)[idx];
if (!entry) die('reference_map 里找不到第 ' + (idx + 1) + ' 块的内容。');

let html;
if (typeof entry.data === 'string') {
  html = entry.data;
} else if (entry.path) {
  const p = path.resolve(outDir, entry.path.replace(/^@/, ''));
  if (!fs.existsSync(p)) die('reference_map 指向的本地文件不存在：' + p);
  html = fs.readFileSync(p, 'utf8');
} else {
  die('reference_map 条目的形态不认识：' + JSON.stringify(entry).slice(0, 200));
}

const outFile = outOpt || path.join(outDir, docId + '-block-' + (idx + 1) + '.html');
fs.writeFileSync(outFile, html, 'utf8');

// 关键：记下「已看过文档当前状态」。否则 publish 的漂移守卫会把
// 「pull → 改 → 上传」这条**正常流程**也当成外部改动拦下来（设计缺陷，实测踩到）。
state.remember(docId, state.hash(html), 'pull（已消化漂移）');

console.log('已从文档拉取块内容');
console.log('  文档      ' + docRef);
console.log('  文档 ID   ' + docId);
console.log('  第几块    ' + (idx + 1) + ' / ' + blocks.length + '    alt = ' + (blocks[idx].alt || '(无)'));
console.log('  内容来源  ' + (typeof entry.data === 'string' ? 'reference_map.data（内联）' : 'reference_map.path（落盘文件）'));
console.log('  写入      ' + outFile + '   ' + Buffer.byteLength(html, 'utf8') + 'B');
console.log('');
console.log('接下来：在这个文件上改，然后推回去（文档链接不变）——');
console.log('  node scripts/prepare.js ' + JSON.stringify(outFile) + ' --out-dir .h2l-build');
console.log('  node scripts/publish.js .h2l-build --doc ' + JSON.stringify(docRef));
