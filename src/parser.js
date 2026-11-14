(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormulaParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ENV_NAMES = new Set([
    'equation', 'equation*', 'displaymath', 'math',
    'align', 'align*', 'alignat', 'alignat*', 'aligned', 'alignedat',
    'gather', 'gather*', 'gathered', 'multline', 'multline*',
    'eqnarray', 'eqnarray*', 'flalign', 'flalign*',
    'cases', 'dcases', 'rcases', 'matrix', 'pmatrix', 'bmatrix',
    'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'array', 'subarray', 'split'
  ]);

  const MATH_FENCE_LANGS = new Set(['latex', 'math', 'tex', 'katex']);

  function isEscaped(text, index) {
    let count = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
    return count % 2 === 1;
  }

  function normalizeSource(source) {
    return String(source == null ? '' : source).replace(/\s+/g, ' ').trim();
  }

  function stripOuterDelimiters(source) {
    const s = String(source == null ? '' : source).trim();
    if (s.length > 4 && s.startsWith('$$') && s.endsWith('$$') && s.indexOf('$$', 2) === s.length - 2) {
      return s.slice(2, -2).trim();
    }
    if (s.length > 4 && s.startsWith('\\[') && s.endsWith('\\]') && s.indexOf('\\]', 2) === s.length - 2) {
      return s.slice(2, -2).trim();
    }
    if (s.length > 2 && s.startsWith('$') && s.endsWith('$') && s.indexOf('$', 1) === s.length - 1) {
      return s.slice(1, -1).trim();
    }
    if (s.length > 4 && s.startsWith('\\(') && s.endsWith('\\)') && s.indexOf('\\)', 2) === s.length - 2) {
      return s.slice(2, -2).trim();
    }
    return s;
  }

  function findUnescapedToken(text, token, from) {
    let pos = from;
    while (pos < text.length) {
      const found = text.indexOf(token, pos);
      if (found === -1) return -1;
      if (!isEscaped(text, found)) return found;
      pos = found + token.length;
    }
    return -1;
  }

  function unwrapEquationEnv(source) {
    const match = /^\\begin\{(equation\*?|displaymath|math)\}([\s\S]*)\\end\{\1\}$/.exec(source);
    return match ? match[2].trim() : source;
  }

  function findCodeFences(text) {
    const fences = [];
    const lines = text.split('\n');
    const starts = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      starts.push(offset);
      offset += lines[i].length + 1;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
      const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (!open) continue;

      const fenceChar = open[2][0];
      const fenceLen = open[2].length;
      const info = open[3].trim();
      const contentStart = starts[i] + lines[i].length + (i < lines.length - 1 ? 1 : 0);
      let closeIndex = -1;

      for (let j = i + 1; j < lines.length; j++) {
        const closeLine = lines[j].endsWith('\r') ? lines[j].slice(0, -1) : lines[j];
        const close = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(closeLine);
        if (close && close[2][0] === fenceChar && close[2].length >= fenceLen) {
          closeIndex = j;
          break;
        }
      }

      const contentEnd = closeIndex === -1 ? text.length : starts[closeIndex];
      const end = closeIndex === -1
        ? text.length
        : starts[closeIndex] + lines[closeIndex].length + (closeIndex < lines.length - 1 ? 1 : 0);
      const lang = (info.split(/\s+/)[0] || '').toLowerCase();

      fences.push({
        start: starts[i],
        contentStart,
        contentEnd,
        end,
        info,
        lang,
        isMath: MATH_FENCE_LANGS.has(lang)
      });

      if (closeIndex !== -1) i = closeIndex;
      else break;
    }

    return fences;
  }

  function findInlineCodeRanges(text, fences) {
    const ranges = [];
    const re = /(`+)([\s\S]*?)\1/g;
    let match;
    while ((match = re.exec(text))) {
      if (match[1].length >= 3) continue;
      const start = match.index;
      const end = start + match[0].length;
      const inFence = fences.some(function (fence) {
        return start < fence.end && end > fence.start;
      });
      if (!inFence) ranges.push({ start: start, end: end });
    }
    return ranges;
  }

  function findEnvEnd(text, from, env) {
    const openTag = '\\begin{' + env + '}';
    const closeTag = '\\end{' + env + '}';
    let depth = 1;
    let pos = from + openTag.length;

    while (pos < text.length) {
      const nextOpen = text.indexOf(openTag, pos);
      const nextClose = text.indexOf(closeTag, pos);
      if (nextClose === -1) return -1;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + openTag.length;
      } else {
        depth--;
        if (depth === 0) return nextClose;
        pos = nextClose + closeTag.length;
      }
    }
    return -1;
  }

  function looksLikeCurrency(text, index) {
    return /^\$[\d.,]+(?=$|[\s，。；、,.;:)）])/.test(text.slice(index, index + 24));
  }

  function getLineRanges(text, start, end) {
    const lines = [];
    let lineStart = start;
    for (let i = start; i <= end; i++) {
      if (i === end || text.charAt(i) === '\n') {
        lines.push({ start: lineStart, end: i });
        lineStart = i + 1;
      }
    }
    return lines;
  }

  function trimRange(text, start, end) {
    let s = start;
    let e = end;
    while (s < e && (text.charAt(s) === ' ' || text.charAt(s) === '\t')) s++;
    while (e > s && /[ \t\r]/.test(text.charAt(e - 1))) e--;
    return { start: s, end: e, text: text.slice(s, e) };
  }

  function cellFromRange(text, start, end) {
    const trimmed = trimRange(text, start, end);
    return {
      start: trimmed.start,
      end: trimmed.end,
      text: trimmed.text.replace(/\\\|/g, '|')
    };
  }

  // Splits a GFM table row. Pipes inside inline code spans stay in the cell,
  // and \| is treated as a literal pipe.
  function splitTableRow(text, start, end) {
    let s = start;
    let e = end;
    while (s < e && (text.charAt(s) === ' ' || text.charAt(s) === '\t')) s++;
    while (e > s && /[ \t\r]/.test(text.charAt(e - 1))) e--;

    let sawPipe = false;
    if (s < e && text.charAt(s) === '|') {
      sawPipe = true;
      s++;
    }
    if (e > s && text.charAt(e - 1) === '|' && !isEscaped(text, e - 1)) {
      sawPipe = true;
      e--;
    }

    const cells = [];
    let cellStart = s;
    let ticks = 0;
    let i = s;

    while (i < e) {
      const ch = text.charAt(i);
      if (ch === '`') {
        let run = 1;
        while (i + run < e && text.charAt(i + run) === '`') run++;
        if (ticks === 0) ticks = run;
        else if (run === ticks) ticks = 0;
        i += run;
        continue;
      }
      if (ch === '|' && ticks === 0 && !isEscaped(text, i)) {
        sawPipe = true;
        cells.push(cellFromRange(text, cellStart, i));
        cellStart = i + 1;
      }
      i++;
    }
    cells.push(cellFromRange(text, cellStart, e));

    return sawPipe ? cells : null;
  }

  function tableAlignOf(cellText) {
    if (!/^:?-+:?$/.test(cellText)) return undefined;
    const left = cellText.charAt(0) === ':';
    const right = cellText.charAt(cellText.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  }

  function findTable(text, start, end) {
    const lines = getLineRanges(text, start, end);

    for (let i = 0; i + 1 < lines.length; i++) {
      const headerLine = trimRange(text, lines[i].start, lines[i].end);
      if (!headerLine.text) continue;
      if (/^(?:[-*+]|\d{1,9}[.)])[ \t]/.test(headerLine.text) || headerLine.text.charAt(0) === '>') continue;

      const header = splitTableRow(text, headerLine.start, headerLine.end);
      if (!header) continue;

      const delimiterLine = trimRange(text, lines[i + 1].start, lines[i + 1].end);
      if (!delimiterLine.text) continue;

      const delimiter = splitTableRow(text, delimiterLine.start, delimiterLine.end);
      if (!delimiter || delimiter.length !== header.length) continue;

      const align = [];
      let valid = true;
      for (let c = 0; c < delimiter.length; c++) {
        const value = tableAlignOf(delimiter[c].text);
        if (value === undefined) {
          valid = false;
          break;
        }
        align.push(value);
      }
      if (!valid) continue;

      const rows = [];
      let lastLine = i + 1;
      for (let j = i + 2; j < lines.length; j++) {
        const rowLine = trimRange(text, lines[j].start, lines[j].end);
        if (!rowLine.text) break;
        const cells = splitTableRow(text, rowLine.start, rowLine.end);
        if (!cells) break;
        rows.push({ start: rowLine.start, end: rowLine.end, cells: cells });
        lastLine = j;
      }

      const tableEnd = trimRange(text, lines[lastLine].start, lines[lastLine].end).end;
      return {
        start: headerLine.start,
        end: tableEnd,
        markdown: text.slice(headerLine.start, tableEnd).replace(/\r\n?/g, '\n'),
        header: header,
        align: align,
        rows: rows
      };
    }

    return null;
  }

  function validInlineMath(text, open, close, content) {
    if (!content.trim()) return false;
    if (/\s/.test(text.charAt(open + 1))) return false;
    if (/\s/.test(text.charAt(close - 1))) return false;
    if (/^[\d.,\s]+$/.test(content)) return false;
    if (/\n[ \t]*\n/.test(content)) return false;
    return true;
  }

  function extractFromText(input, options) {
    const text = String(input == null ? '' : input);
    const opts = options || {};
    const includeCode = !!opts.includeCode;
    const dedupe = opts.dedupe !== false;
    const formulas = [];
    const warningSet = new Set();
    const fences = findCodeFences(text);
    const fenceByStart = new Map();
    fences.forEach(function (fence) { fenceByStart.set(fence.start, fence); });
    const inlineRanges = includeCode ? [] : findInlineCodeRanges(text, fences);

    function warn(message) {
      warningSet.add(message);
    }

    function pushFormula(source, type, wrapper, start, end, origin) {
      const clean = String(source == null ? '' : source).trim();
      if (!clean) return;
      formulas.push({
        source: clean,
        type: type,
        wrapper: wrapper,
        origin: origin || 'text',
        start: start,
        end: end,
        contextBefore: text.slice(Math.max(0, start - 70), start).replace(/\s+/g, ' ').trim(),
        contextAfter: text.slice(end, Math.min(text.length, end + 70)).replace(/\s+/g, ' ').trim()
      });
    }

    let i = 0;
    let inlineRangeIndex = 0;

    while (i < text.length) {
      const fence = fenceByStart.get(i);
      if (fence) {
        if (fence.isMath) {
          pushFormula(
            text.slice(fence.contentStart, fence.contentEnd),
            'display',
            'code',
            fence.contentStart,
            fence.contentEnd,
            'code'
          );
          i = fence.end;
          continue;
        }
        if (!includeCode) {
          i = fence.end;
          continue;
        }
        i = fence.contentStart;
        continue;
      }

      if (!includeCode) {
        while (inlineRangeIndex < inlineRanges.length && inlineRanges[inlineRangeIndex].end <= i) {
          inlineRangeIndex++;
        }
        const range = inlineRanges[inlineRangeIndex];
        if (range && i >= range.start && i < range.end) {
          i = range.end;
          continue;
        }
      }

      const ch = text.charAt(i);

      if (ch === '\\' && !isEscaped(text, i)) {
        if (text.startsWith('\\[', i)) {
          const close = findUnescapedToken(text, '\\]', i + 2);
          if (close === -1) {
            warn('有未闭合的 \\[ \\] 行间公式已跳过');
            i += 2;
            continue;
          }
          pushFormula(text.slice(i + 2, close), 'display', 'bracket', i, close + 2);
          i = close + 2;
          continue;
        }

        if (text.startsWith('\\(', i)) {
          const close = findUnescapedToken(text, '\\)', i + 2);
          if (close === -1) {
            warn('有未闭合的 \\( \\) 行内公式已跳过');
            i += 2;
            continue;
          }
          pushFormula(text.slice(i + 2, close), 'inline', 'paren', i, close + 2);
          i = close + 2;
          continue;
        }

        if (text.startsWith('\\begin{', i)) {
          const beginMatch = /^\\begin\{([A-Za-z*]+)\}/.exec(text.slice(i, i + 48));
          if (beginMatch && ENV_NAMES.has(beginMatch[1])) {
            const env = beginMatch[1];
            const close = findEnvEnd(text, i, env);
            if (close === -1) {
              warn('有未闭合的 \\begin{' + env + '} 环境已跳过');
              i += beginMatch[0].length;
              continue;
            }
            const closeTag = '\\end{' + env + '}';
            pushFormula(text.slice(i, close + closeTag.length), 'display', 'env', i, close + closeTag.length);
            i = close + closeTag.length;
            continue;
          }
        }

        i++;
        continue;
      }

      if (ch === '$' && !isEscaped(text, i)) {
        if (text.charAt(i + 1) === '$') {
          let searchFrom = i + 2;
          let close = -1;
          while (searchFrom < text.length) {
            const candidate = text.indexOf('$$', searchFrom);
            if (candidate === -1) break;
            if (!isEscaped(text, candidate)) {
              close = candidate;
              break;
            }
            searchFrom = candidate + 2;
          }
          if (close === -1) {
            warn('有未闭合的 $$ 行间公式已跳过');
            i += 2;
            continue;
          }
          pushFormula(text.slice(i + 2, close), 'display', 'double', i, close + 2);
          i = close + 2;
          continue;
        }

        let searchFrom = i + 1;
        let close = -1;
        while (searchFrom < text.length) {
          const candidate = text.indexOf('$', searchFrom);
          if (candidate === -1) break;
          if (isEscaped(text, candidate)) {
            searchFrom = candidate + 1;
            continue;
          }
          if (text.charAt(candidate + 1) === '$') break;
          const content = text.slice(i + 1, candidate);
          if (validInlineMath(text, i, candidate, content)) {
            close = candidate;
            break;
          }
          searchFrom = candidate + 1;
        }

        if (close === -1) {
          if (!looksLikeCurrency(text, i) && !/^\s/.test(text.charAt(i + 1))) {
            warn('有未闭合的 $ 行内公式已跳过');
          }
          i++;
          continue;
        }

        pushFormula(text.slice(i + 1, close), 'inline', 'dollar', i, close + 1);
        i = close + 1;
        continue;
      }

      i++;
    }

    let result = formulas;
    if (dedupe) {
      const seen = new Set();
      result = formulas.filter(function (formula) {
        const key = formula.type + '::' + normalizeSource(formula.source);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return {
      formulas: result,
      warnings: Array.from(warningSet)
    };
  }

  const HTML_SELECTOR = [
    'annotation[encoding*="x-tex"]',
    'script[type^="math/tex"]',
    '[data-latex]',
    '[data-tex]'
  ].join(', ');

  function extractFromHtml(html, documentArg) {
    let doc = documentArg;
    if (!doc) {
      if (typeof DOMParser === 'undefined') return [];
      doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    }

    const elements = Array.from(doc.querySelectorAll(HTML_SELECTOR));
    const formulas = [];
    const seen = new Set();

    elements.forEach(function (el) {
      if (el.parentElement && el.parentElement.closest(HTML_SELECTOR)) return;

      let source = '';
      const tagName = el.tagName.toLowerCase();
      if (tagName === 'script' || tagName === 'annotation') {
        source = el.textContent || '';
      } else {
        source = el.getAttribute('data-latex') || el.getAttribute('data-tex') || '';
      }
      source = source.trim();
      if (!source) return;

      let display = /mode\s*=\s*display/i.test(el.getAttribute('type') || '');
      const math = el.closest('math');
      if (math && math.getAttribute('display') === 'block') display = true;
      if (el.getAttribute('data-display') === 'true') display = true;
      if (el.closest('.katex-display, mjx-container[display="true"], [data-display="true"]')) display = true;

      const key = (display ? 'display' : 'inline') + '::' + normalizeSource(source);
      if (seen.has(key)) return;
      seen.add(key);

      formulas.push({
        source: source,
        type: display ? 'display' : 'inline',
        wrapper: 'html',
        origin: 'html',
        start: -1,
        end: -1,
        contextBefore: '',
        contextAfter: ''
      });
    });

    return formulas;
  }

  function mergeFormulas(textFormulas, htmlFormulas, options) {
    const opts = options || {};
    const dedupe = opts.dedupe !== false;
    const result = (textFormulas || []).slice();
    const seen = new Set();

    if (dedupe) {
      result.forEach(function (formula) {
        seen.add(normalizeSource(formula.source));
      });
    }

    let addedHtml = 0;
    (htmlFormulas || []).forEach(function (formula) {
      const key = normalizeSource(formula.source);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(formula);
      addedHtml++;
    });

    return { formulas: result, addedHtml: addedHtml };
  }

  function formatFormula(formula, format) {
    const mode = format || 'markdown';
    let source = stripOuterDelimiters(formula && formula.source);
    if (!source) return '';
    const type = formula && formula.type === 'display' ? 'display' : 'inline';

    if (mode === 'raw') return source;

    if (mode === 'markdown') {
      if (type === 'display') {
        source = unwrapEquationEnv(source);
        return '$$\n' + source + '\n$$';
      }
      return '$' + source + '$';
    }

    if (mode === 'paren') {
      if (type === 'display') {
        source = unwrapEquationEnv(source);
        return '\\[\n' + source + '\n\\]';
      }
      return '\\(' + source + '\\)';
    }

    const wrapper = formula && formula.wrapper;
    if (wrapper === 'double') return '$$\n' + source + '\n$$';
    if (wrapper === 'bracket') return '\\[\n' + source + '\n\\]';
    if (wrapper === 'dollar') return '$' + source + '$';
    if (wrapper === 'paren') return '\\(' + source + '\\)';
    if (wrapper === 'env') return source;
    if (wrapper === 'code') return '```latex\n' + source + '\n```';
    return type === 'display' ? '$$\n' + source + '\n$$' : '$' + source + '$';
  }

  function getPreviewSource(source) {
    let result = stripOuterDelimiters(source);
    result = result.replace(/\\label\s*\{[^{}]*\}/g, '');
    result = result.replace(/\\(?:nonumber|notag)\b/g, '');
    result = unwrapEquationEnv(result);
    result = result.replace(/^\\begin\{eqnarray\*?\}/, '\\begin{aligned}')
      .replace(/\\end\{eqnarray\*?\}$/, '\\end{aligned}');
    result = result.replace(/^\\begin\{multline\*?\}/, '\\begin{gathered}')
      .replace(/\\end\{multline\*?\}$/, '\\end{gathered}');
    return result;
  }

  return {
    extractFromText: extractFromText,
    extractFromHtml: extractFromHtml,
    findCodeFences: findCodeFences,
    findTable: findTable,
    mergeFormulas: mergeFormulas,
    formatFormula: formatFormula,
    getPreviewSource: getPreviewSource,
    normalizeSource: normalizeSource,
    stripOuterDelimiters: stripOuterDelimiters
  };
});
