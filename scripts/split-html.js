'use strict';
/**
 * 把一份超限的 HTML 按某个标题标签切成多个「完整 HTML」。
 *
 * 为什么需要：500KB 是**每个 HTML 块**的上限（实测：同一文档放两块各 400KB 成功）。
 * 但拆块有代价 —— 每块都要重背一遍 <head>/CSS/JS，
 * 且跨块不共享状态（如 am 的受众开关会每块各一套）。故只作显式回退，不自动触发。
 *
 * 切法：在「split 标签作为直接子元素」的那一层分组，
 * 并把祖先包装元素（如 <main class="am-doc">）复制进每个块 —— 否则布局会塌。
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

// 扫描出 depth-0 的元素（含开标签/闭标签原文）。注释与 depth-0 文本节点不返回。
function topLevelElements(s) {
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  let m;
  let depth = 0;
  let cur = null;
  const out = [];
  while ((m = re.exec(s))) {
    if (m[0].startsWith('<!--')) continue;
    const isClose = m[0][1] === '/';
    const tag = m[1].toLowerCase();
    if (isClose) {
      depth--;
      if (depth === 0 && cur) {
        cur.end = m.index + m[0].length;
        cur.close = m[0];
        out.push(cur);
        cur = null;
      }
    } else {
      const selfClosing = m[2] === '/' || VOID.has(tag);
      if (depth === 0) {
        cur = { start: m.index, open: m[0], innerStart: re.lastIndex, end: -1, close: '' };
      }
      if (!selfClosing) {
        depth++;
      } else if (depth === 0 && cur) {
        cur.end = re.lastIndex;
        cur.innerStart = cur.innerStart;
        out.push(cur);
        cur = null;
      }
    }
  }
  return out;
}

/**
 * @param {string} html      完整 HTML 文档
 * @param {string} tagName   切分标签，如 'h2'（只支持标签名，不支持任意选择器）
 * @returns {{chunks?: string[], error?: string, splitCount?: number}}
 */
function splitIntoChunks(html, tagName) {
  const tagRe = new RegExp('<' + tagName + '\\b', 'i');

  const headEnd = html.search(/<\/head>/i);
  if (headEnd < 0) return { error: '找不到 </head>，无法拆分' };
  const headHtml = html.slice(0, headEnd + 7);

  const afterHead = html.slice(headEnd + 7);
  const bodyOpenM = afterHead.match(/<body([^>]*)>/i);
  if (!bodyOpenM) return { error: '找不到 <body>，无法拆分' };
  const bodyOpen = '<body' + bodyOpenM[1] + '>';
  const innerStart = headEnd + 7 + bodyOpenM.index + bodyOpenM[0].length;
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose < innerStart) return { error: '找不到 </body>，无法拆分' };
  const tail = html.slice(bodyClose); // </body></html>

  const wrappers = [];   // 祖先开/闭标签，逐层向内
  let leading = '';      // 与目标同层但排在它前面的兄弟元素 → 并入第 1 块

  let level = html.slice(innerStart, bodyClose);
  for (let guard = 0; guard < 30; guard++) {
    const tops = topLevelElements(level);
    const hits = tops.filter((t) => tagRe.test(level.slice(t.innerStart, t.end)));
    if (hits.length === 0) {
      return { error: '正文里找不到 <' + tagName + '>，无法拆分（换个存在的标题层级试试）' };
    }
    if (hits.length >= 2) {
      // 在这一层切
      const parts = [];
      let cur = '';
      for (const t of tops) {
        const el = level.slice(t.start, t.end);
        const isSplit = tagRe.test(level.slice(t.innerStart, t.end));
        if (isSplit && cur.trim() !== '') { parts.push(cur); cur = ''; }
        cur += el;
      }
      if (cur.trim() !== '') parts.push(cur);

      // 头部块过小时并入第一节，避免出现一个几乎空白的块
      if (parts.length > 1 && Buffer.byteLength(parts[0], 'utf8') < 8 * 1024) {
        parts[1] = parts[0] + parts[1];
        parts.shift();
      }

      const pre = wrappers.map((w) => w.open).join('');
      const post = wrappers.slice().reverse().map((w) => w.close).join('');
      // 顺序要紧：leading 是与包装元素【平级】的前置兄弟，必须在包装开标签【之前】，
      // 否则会被塞进包装内部、改变结构（踩过）。
      const chunks = parts.map((p, i) =>
        headHtml + bodyOpen + (i === 0 ? leading : '') + pre + p + post + tail);
      return { chunks, splitCount: chunks.length };
    }

    // 只有一个祖先包含切分点 → 下沉一层
    const only = hits[0];
    for (const t of tops) {
      if (t === only) break;
      leading += level.slice(t.start, t.end);
    }
    if (!only.close) return { error: '<' + tagName + '> 的祖先元素没有闭合标签，无法安全拆分' };
    wrappers.push({ open: only.open, close: only.close });
    level = level.slice(only.innerStart, only.end - only.close.length);
  }
  return { error: '嵌套层级过深，放弃拆分' };
}

module.exports = { splitIntoChunks, topLevelElements };
