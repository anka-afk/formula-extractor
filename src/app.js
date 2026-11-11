(function () {
  'use strict';

  const Parser = window.FormulaParser;
  const STORAGE_KEY = 'formula-extractor:v1';
  const PASTE_CACHE_KEY = 'formula-extractor:paste:v1';
  const PASTE_CACHE_LIMIT = 1500000;
  const FORMATS = ['markdown', 'paren', 'raw', 'original'];

  const els = {
    inputText: document.getElementById('inputText'),
    inputCount: document.getElementById('inputCount'),
    extractBtn: document.getElementById('extractBtn'),
    pasteBtn: document.getElementById('pasteBtn'),
    exampleBtn: document.getElementById('exampleBtn'),
    emptyExampleBtn: document.getElementById('emptyExampleBtn'),
    clearBtn: document.getElementById('clearBtn'),
    includeCode: document.getElementById('includeCode'),
    dedupe: document.getElementById('dedupe'),
    notice: document.getElementById('notice'),
    resultsPanel: document.getElementById('resultsPanel'),
    results: document.getElementById('results'),
    docView: document.getElementById('docView'),
    docTip: document.getElementById('docTip'),
    emptyState: document.getElementById('emptyState'),
    stats: document.getElementById('stats'),
    viewGroup: document.getElementById('viewGroup'),
    filterGroup: document.getElementById('filterGroup'),
    searchInput: document.getElementById('searchInput'),
    formatSelect: document.getElementById('formatSelect'),
    copyAllBtn: document.getElementById('copyAllBtn'),
    exportBtn: document.getElementById('exportBtn'),
    themeToggle: document.getElementById('themeToggle'),
    themeIcon: document.getElementById('themeIcon'),
    cardTemplate: document.getElementById('cardTemplate'),
    exampleText: document.getElementById('exampleText'),
    toast: document.getElementById('toast')
  };

  const state = {
    input: '',
    formulas: [],
    formulasInput: '',
    format: 'markdown',
    view: 'doc',
    filter: 'all',
    search: '',
    includeCode: false,
    dedupe: true,
    theme: '',
    lastPasteHtml: '',
    lastPasteText: ''
  };

  let saveTimer = null;
  let toastTimer = null;

  function normalizeFormula(formula) {
    if (!formula || typeof formula.source !== 'string' || !formula.source.trim()) return null;
    return {
      source: formula.source,
      originalSource: typeof formula.originalSource === 'string' ? formula.originalSource : formula.source,
      type: formula.type === 'display' ? 'display' : 'inline',
      wrapper: typeof formula.wrapper === 'string' ? formula.wrapper : 'text',
      origin: ['text', 'html', 'code'].indexOf(formula.origin) !== -1 ? formula.origin : 'text',
      contextBefore: typeof formula.contextBefore === 'string' ? formula.contextBefore : '',
      contextAfter: typeof formula.contextAfter === 'string' ? formula.contextAfter : '',
      start: Number.isFinite(formula.start) ? formula.start : -1,
      end: Number.isFinite(formula.end) ? formula.end : -1
    };
  }

  function loadState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;

    state.input = typeof saved.input === 'string' ? saved.input : '';
    state.formulasInput = typeof saved.formulasInput === 'string' ? saved.formulasInput : '';
    state.includeCode = !!saved.includeCode;
    state.dedupe = saved.dedupe !== false;
    state.format = FORMATS.indexOf(saved.format) !== -1 ? saved.format : 'markdown';
    state.view = saved.view === 'cards' || saved.view === 'doc' ? saved.view : 'doc';

    if (Array.isArray(saved.formulas)) {
      state.formulas = saved.formulas.map(normalizeFormula).filter(Boolean);
    }

    if (saved.theme === 'dark' || saved.theme === 'light') {
      state.theme = saved.theme;
    }

    try {
      const cached = JSON.parse(sessionStorage.getItem(PASTE_CACHE_KEY) || 'null');
      if (cached && cached.text === state.input && typeof cached.html === 'string') {
        state.lastPasteHtml = cached.html;
        state.lastPasteText = cached.text;
      }
    } catch (error) {
      // The rich paste cache is best-effort only.
    }
  }

  function savePasteCache(html, text) {
    try {
      if (!html || !text || html.length > PASTE_CACHE_LIMIT) {
        sessionStorage.removeItem(PASTE_CACHE_KEY);
        return;
      }
      sessionStorage.setItem(PASTE_CACHE_KEY, JSON.stringify({ text: text, html: html }));
    } catch (error) {
      // Quota or privacy mode can reject sessionStorage writes.
    }
  }

  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          input: state.input,
          formulas: state.formulas,
          formulasInput: state.formulasInput,
          format: state.format,
          view: state.view,
          includeCode: state.includeCode,
          dedupe: state.dedupe,
          theme: state.theme
        }));
      } catch (error) {
        // A very large clipboard can exceed the localStorage quota.
      }
    }, 180);
  }

  function preferredTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    state.theme = resolved;
    document.documentElement.dataset.theme = resolved;
    els.themeIcon.textContent = resolved === 'dark' ? '☀' : '☾';
    els.themeToggle.setAttribute('aria-label', resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    els.themeToggle.title = resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    saveState();
  }

  function updateInputCount() {
    const count = state.input.length;
    els.inputCount.textContent = count.toLocaleString('zh-CN') + ' 字符';
  }

  function setNotice(messages, type) {
    const list = (messages || []).filter(Boolean);
    if (!list.length) {
      els.notice.hidden = true;
      els.notice.textContent = '';
      els.notice.className = 'notice';
      return;
    }
    els.notice.hidden = false;
    els.notice.className = 'notice' + (type === 'warn' ? ' warn' : '');
    els.notice.textContent = list.join(' ');
  }

  function showToast(message, isError) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = 'toast show' + (isError ? ' error' : '');
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2200);
  }

  function legacyCopy(text) {
    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    textarea.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
    return copied;
  }

  async function copyText(text) {
    if (!text) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        // file:// pages or a denied permission can reject the async API.
      }
    }
    return legacyCopy(text);
  }

  function copyFormula(formula, rawOnly) {
    const text = rawOnly
      ? Parser.stripOuterDelimiters(formula.source)
      : Parser.formatFormula(formula, state.format);
    if (!text) {
      showToast('公式为空，无法复制', true);
      return;
    }
    copyText(text).then(function (copied) {
      showToast(copied ? (rawOnly ? '已复制源码' : '已复制公式') : '复制失败，请手动选择源码复制', !copied);
    }).catch(function () {
      showToast('复制失败，请手动选择源码复制', true);
    });
  }

  function copyAll() {
    const parts = state.formulas.map(function (formula) {
      return Parser.formatFormula(formula, state.format);
    }).filter(Boolean);

    if (!parts.length) {
      showToast('还没有可复制的公式', true);
      return;
    }

    copyText(parts.join('\n\n')).then(function (copied) {
      showToast(copied ? '已复制全部 ' + parts.length + ' 个公式' : '复制失败，请手动选择源码复制', !copied);
    }).catch(function () {
      showToast('复制失败，请手动选择源码复制', true);
    });
  }

  function formatFileDate(date) {
    const pad = function (value) { return String(value).padStart(2, '0'); };
    return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function exportMarkdown() {
    const parts = state.formulas.map(function (formula) {
      return Parser.formatFormula(formula, state.format);
    }).filter(Boolean);

    if (!parts.length) {
      showToast('还没有可导出的公式', true);
      return;
    }

    const blob = new Blob([parts.join('\n\n') + '\n'], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'formulas-' + formatFileDate(new Date()) + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('已导出 ' + parts.length + ' 个公式');
  }

  function getVisibleFormulas() {
    const search = state.search.trim().toLowerCase();
    return state.formulas.map(function (formula, index) {
      return { formula: formula, index: index };
    }).filter(function (item) {
      const formula = item.formula;
      if (state.filter === 'inline' && formula.type !== 'inline') return false;
      if (state.filter === 'display' && formula.type !== 'display') return false;
      if (!search) return true;
      return formula.source.toLowerCase().indexOf(search) !== -1;
    });
  }

  function updateStats(visibleCount) {
    const total = state.formulas.length;
    if (!total) {
      els.stats.textContent = state.formulasInput && state.input === state.formulasInput ? '未找到公式' : '等待提取';
      return;
    }

    const inline = state.formulas.filter(function (formula) { return formula.type === 'inline'; }).length;
    const display = total - inline;
    let text = '共 ' + total + ' 个公式 · 行内 ' + inline + ' · 行间 ' + display;
    if (visibleCount !== total) text += ' · 当前显示 ' + visibleCount;
    if (state.input !== state.formulasInput) text += ' · 输入已修改';
    els.stats.textContent = text;
  }

  function updateFilterButtons() {
    els.filterGroup.querySelectorAll('button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.filter === state.filter);
    });
  }

  function autoSizeSource(textarea) {
    textarea.style.height = 'auto';
    const height = Math.min(260, Math.max(42, textarea.scrollHeight + 2));
    textarea.style.height = height + 'px';
    textarea.style.overflowY = textarea.scrollHeight > 260 ? 'auto' : 'hidden';
  }

  function renderPreview(container, formula) {
    container.classList.toggle('is-inline', formula.type === 'inline');
    const source = Parser.getPreviewSource(formula.source);
    if (!source) {
      container.replaceChildren();
      return;
    }
    if (!window.katex) {
      container.textContent = source;
      return;
    }
    try {
      window.katex.render(source, container, {
        displayMode: formula.type === 'display',
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        maxExpand: 1000,
        output: 'htmlAndMathml'
      });
    } catch (error) {
      container.replaceChildren();
      const message = document.createElement('span');
      message.className = 'preview-error';
      message.textContent = '预览失败：' + error.message;
      container.appendChild(message);
    }
  }

  const FORMAT_LABELS = {
    markdown: 'Markdown（$ / $$）',
    paren: 'LaTeX 括号（\\( / \\[）',
    raw: '纯公式',
    original: '原始包装'
  };

  const INLINE_MARK_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

  const HTML_MATH_SOURCE_SELECTOR = 'annotation[encoding*="x-tex"], script[type^="math/tex"], [data-latex], [data-tex]';

  const DOC_ALLOWED_TAGS = new Set([
    'P', 'DIV', 'SPAN', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'INS', 'MARK', 'SMALL',
    'SUB', 'SUP', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'CODE', 'A',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL',
    'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY'
  ]);

  const DOC_DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'LINK', 'META', 'INPUT', 'BUTTON', 'TEXTAREA',
    'SELECT', 'OPTION', 'FORM', 'MJX-CONTAINER'
  ]);

  function makeDocFormula(source, type, renderType) {
    const renderAs = renderType === 'display' || renderType === 'inline' ? renderType : type;
    const span = document.createElement('span');
    span.className = 'doc-formula ' + (renderAs === 'display' ? 'doc-display' : 'doc-inline');
    span.setAttribute('data-doc-formula', '1');
    span.dataset.source = source;
    span.dataset.type = type;
    span.dataset.render = renderAs;
    span.setAttribute('role', 'button');
    span.tabIndex = 0;
    span.title = '点击复制公式';
    return span;
  }

  function buildDocLookup() {
    const byKey = new Map();
    const bySource = new Map();
    state.formulas.forEach(function (formula) {
      const key = formula.type + '::' + Parser.normalizeSource(formula.originalSource);
      if (!byKey.has(key)) byKey.set(key, formula);
      const sourceKey = Parser.normalizeSource(formula.originalSource);
      if (!bySource.has(sourceKey)) bySource.set(sourceKey, formula);
    });
    return { byKey: byKey, bySource: bySource };
  }

  function resolveDocFormula(lookup, source, type) {
    const normalized = Parser.normalizeSource(source);
    return lookup.byKey.get(type + '::' + normalized) || lookup.bySource.get(normalized) || {
      source: source,
      originalSource: source,
      type: type,
      wrapper: 'text',
      origin: 'text'
    };
  }

  function hydrateDocFormulas(root) {
    const lookup = buildDocLookup();
    root.querySelectorAll('[data-doc-formula]').forEach(function (span) {
      const source = span.dataset.source || '';
      if (!source) return;
      const type = span.dataset.type === 'display' ? 'display' : 'inline';
      const renderType = span.dataset.render === 'display' ? 'display' : 'inline';
      const formula = resolveDocFormula(lookup, source, type);
      renderPreview(span, {
        source: formula.source,
        type: renderType
      });

      function copyThis() {
        copyFormula(formula, false);
        span.classList.remove('copied');
        void span.offsetWidth;
        span.classList.add('copied');
      }

      span.addEventListener('click', copyThis);
      span.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        copyThis();
      });
      span.addEventListener('animationend', function () {
        span.classList.remove('copied');
      });
    });
  }

  function appendFormattedLine(parent, line) {
    if (!line) return;
    INLINE_MARK_RE.lastIndex = 0;
    let last = 0;
    let match;
    while ((match = INLINE_MARK_RE.exec(line))) {
      if (match.index > last) {
        parent.appendChild(document.createTextNode(line.slice(last, match.index)));
      }
      const token = match[0];
      if (token.slice(0, 2) === '**') {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else if (token.charAt(0) === '`') {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      } else {
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
        if (link) {
          const a = document.createElement('a');
          a.textContent = link[1];
          a.href = link[2];
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(token));
        }
      }
      last = match.index + token.length;
    }
    if (last < line.length) {
      parent.appendChild(document.createTextNode(line.slice(last)));
    }
  }

  function appendFormattedText(parent, text) {
    if (!text) return;
    const lines = text.split('\n');
    lines.forEach(function (line, index) {
      if (index > 0) parent.appendChild(document.createElement('br'));
      appendFormattedLine(parent, line);
    });
  }

  function appendInlineRange(parent, text, start, end, occurrences) {
    let cursor = start;
    occurrences.forEach(function (occurrence) {
      if (occurrence.start < start || occurrence.end > end) return;
      if (occurrence.start > cursor) {
        appendFormattedText(parent, text.slice(cursor, occurrence.start));
      }
      parent.appendChild(makeDocFormula(occurrence.source, occurrence.type));
      cursor = occurrence.end;
    });
    if (cursor < end) appendFormattedText(parent, text.slice(cursor, end));
  }

  function occurrencesInRange(occurrences, start, end) {
    return occurrences.filter(function (occurrence) {
      return occurrence.start >= start && occurrence.end <= end;
    });
  }

  function getBlockLines(text, start, end) {
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

  function trimLine(text, line) {
    let start = line.start;
    let end = line.end;
    while (start < end && (text.charAt(start) === ' ' || text.charAt(start) === '\t')) start++;
    while (end > start && /[ \t\r]/.test(text.charAt(end - 1))) end--;
    return { start: start, end: end, text: text.slice(start, end) };
  }

  function appendParagraph(body, text, start, end, occurrences) {
    const p = document.createElement('p');
    appendInlineRange(p, text, start, end, occurrences);
    body.appendChild(p);
  }

  function appendListBlock(body, text, start, end, occurrences, ordered) {
    const crossesLines = occurrences.some(function (occurrence) {
      return text.slice(occurrence.start, occurrence.end).indexOf('\n') !== -1;
    });
    if (crossesLines) return false;

    const pattern = ordered ? /^\d{1,9}[.)][ \t]+/ : /^[-*+][ \t]+/;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    let item = null;

    getBlockLines(text, start, end).forEach(function (line) {
      const trimmed = trimLine(text, line);
      if (!trimmed.text) {
        item = null;
        return;
      }
      const marker = pattern.exec(trimmed.text);
      if (marker) {
        item = document.createElement('li');
        appendInlineRange(item, text, trimmed.start + marker[0].length, trimmed.end, occurrences);
        list.appendChild(item);
      } else if (item) {
        item.appendChild(document.createElement('br'));
        appendInlineRange(item, text, trimmed.start, trimmed.end, occurrences);
      } else {
        item = null;
      }
    });

    if (!list.children.length) return false;
    body.appendChild(list);
    return true;
  }

  function appendQuoteBlock(body, text, start, end, occurrences) {
    const crossesLines = occurrences.some(function (occurrence) {
      return text.slice(occurrence.start, occurrence.end).indexOf('\n') !== -1;
    });
    if (crossesLines) return false;

    const quote = document.createElement('blockquote');
    let written = 0;

    getBlockLines(text, start, end).forEach(function (line) {
      const trimmed = trimLine(text, line);
      if (!trimmed.text) return;
      let contentStart = trimmed.start;
      const marker = /^>[ \t]?/.exec(trimmed.text);
      if (marker) contentStart += marker[0].length;
      if (written > 0) quote.appendChild(document.createElement('br'));
      appendInlineRange(quote, text, contentStart, trimmed.end, occurrences);
      written++;
    });

    if (!written) return false;
    body.appendChild(quote);
    return true;
  }

  function appendBlock(body, text, start, end, occurrences) {
    while (start < end && /\s/.test(text.charAt(start))) start++;
    while (end > start && /\s/.test(text.charAt(end - 1))) end--;
    if (start >= end) return;

    const blockText = text.slice(start, end);
    const local = occurrencesInRange(occurrences, start, end);

    const heading = /^(#{1,6})[ \t]+/.exec(blockText);
    if (heading) {
      const element = document.createElement('h' + heading[1].length);
      appendInlineRange(element, text, start + heading[0].length, end, local);
      body.appendChild(element);
      return;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(blockText) && !local.length) {
      body.appendChild(document.createElement('hr'));
      return;
    }

    if (/^[ \t]*[-*+][ \t]+/.test(blockText)) {
      if (!appendListBlock(body, text, start, end, local, false)) {
        appendParagraph(body, text, start, end, local);
      }
      return;
    }

    if (/^[ \t]*\d{1,9}[.)][ \t]+/.test(blockText)) {
      if (!appendListBlock(body, text, start, end, local, true)) {
        appendParagraph(body, text, start, end, local);
      }
      return;
    }

    if (/^[ \t]*>[ \t]?/.test(blockText)) {
      if (!appendQuoteBlock(body, text, start, end, local)) {
        appendParagraph(body, text, start, end, local);
      }
      return;
    }

    appendParagraph(body, text, start, end, local);
  }

  function appendProse(body, text, start, end, occurrences) {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text.charAt(s))) s++;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    if (s >= e) return;

    const local = occurrences.filter(function (occurrence) {
      return occurrence.start < e && occurrence.end > s;
    });
    const blocks = [];
    let blockStart = s;
    let i = s;
    let occurrenceIndex = 0;

    while (i < e) {
      const occurrence = local[occurrenceIndex];
      if (occurrence && occurrence.end <= i) {
        occurrenceIndex++;
        continue;
      }
      if (occurrence && occurrence.start <= i) {
        i = Math.min(occurrence.end, e);
        continue;
      }
      if (text.charAt(i) === '\n') {
        let j = i + 1;
        while (j < e && /[ \t\r]/.test(text.charAt(j))) j++;
        if (j < e && text.charAt(j) === '\n') {
          let k = j + 1;
          while (k < e && /\s/.test(text.charAt(k))) k++;
          blocks.push({ start: blockStart, end: i });
          blockStart = k;
          i = k;
          continue;
        }
      }
      i++;
    }

    blocks.push({ start: blockStart, end: e });
    blocks.forEach(function (block) {
      appendBlock(body, text, block.start, block.end, occurrences);
    });
  }

  function appendCodeRange(parent, text, start, end, occurrences) {
    let cursor = start;
    occurrences.forEach(function (occurrence) {
      if (occurrence.start < start || occurrence.end > end) return;
      if (occurrence.start > cursor) {
        parent.appendChild(document.createTextNode(text.slice(cursor, occurrence.start)));
      }
      parent.appendChild(makeDocFormula(occurrence.source, occurrence.type, 'inline'));
      cursor = occurrence.end;
    });
    if (cursor < end) parent.appendChild(document.createTextNode(text.slice(cursor, end)));
  }

  function appendFence(body, text, fence, occurrences) {
    if (fence.isMath) {
      const source = text.slice(fence.contentStart, fence.contentEnd).trim();
      if (source) body.appendChild(makeDocFormula(source, 'display'));
      return;
    }

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const contentEnd = fence.contentEnd > fence.contentStart && text.charAt(fence.contentEnd - 1) === '\n'
      ? fence.contentEnd - 1
      : fence.contentEnd;

    if (state.includeCode) {
      const local = occurrencesInRange(occurrences, fence.contentStart, contentEnd);
      if (local.length) {
        appendCodeRange(code, text, fence.contentStart, contentEnd, local);
        pre.appendChild(code);
        body.appendChild(pre);
        return;
      }
    }

    code.textContent = text.slice(fence.contentStart, contentEnd);
    pre.appendChild(code);
    body.appendChild(pre);
  }

  function buildDocFromText(text) {
    const body = document.createElement('div');
    body.className = 'doc-body';

    let fences = [];
    try {
      fences = Parser.findCodeFences(text);
    } catch (error) {
      fences = [];
    }

    let occurrences = [];
    try {
      occurrences = Parser.extractFromText(text, {
        includeCode: state.includeCode,
        dedupe: false
      }).formulas.slice().sort(function (a, b) { return a.start - b.start; });
    } catch (error) {
      occurrences = [];
    }

    let cursor = 0;
    fences.forEach(function (fence) {
      if (fence.start > cursor) appendProse(body, text, cursor, fence.start, occurrences);
      appendFence(body, text, fence, occurrences);
      cursor = Math.max(cursor, fence.end);
    });
    if (cursor < text.length) appendProse(body, text, cursor, text.length, occurrences);

    return body;
  }

  function htmlMathSource(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'annotation') return (el.textContent || '').trim();
    return (el.getAttribute('data-latex') || el.getAttribute('data-tex') || '').trim();
  }

  // Chromium's closest() can skip a nearer HTML ancestor when the selector list
  // mixes class selectors with MathML type selectors, so walk the tree manually.
  function closestAncestor(el, predicate) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (predicate(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function isMathDisplayNode(node) {
    if (node.getAttribute('data-display') === 'true') return true;
    if (node.classList) {
      if (node.classList.contains('katex-display') || node.classList.contains('MathJax_Display')) return true;
    }
    return node.tagName.toLowerCase() === 'mjx-container' && node.getAttribute('display') === 'true';
  }

  function isMathWrapperNode(node) {
    if (node.tagName.toLowerCase() === 'mjx-container') return true;
    if (!node.classList) return false;
    return node.classList.contains('katex') ||
      node.classList.contains('MathJax') ||
      node.classList.contains('MathJax_Display');
  }

  function replaceHtmlMath(root) {
    Array.from(root.querySelectorAll(HTML_MATH_SOURCE_SELECTOR)).forEach(function (el) {
      if (!el.isConnected) return;
      const source = htmlMathSource(el);
      if (!source) return;

      const displayNode = closestAncestor(el, isMathDisplayNode);
      const math = closestAncestor(el, function (node) { return node.tagName.toLowerCase() === 'math'; });
      let display = !!displayNode ||
        /mode\s*=\s*display/i.test(el.getAttribute('type') || '') ||
        el.getAttribute('data-display') === 'true' ||
        !!(math && math.getAttribute('display') === 'block');

      let container = display ? displayNode : closestAncestor(el, isMathWrapperNode);
      if (!container) {
        container = closestAncestor(el, function (node) { return node.tagName.toLowerCase() === 'math'; });
      }
      if (!container) container = el;

      container.replaceWith(makeDocFormula(source, display ? 'display' : 'inline'));
    });

    root.querySelectorAll([
      'math', 'mjx-container', 'mjx-assistive-mml',
      '.katex', '.katex-display',
      '.MathJax', '.MathJax_Display', '.MathJax_Preview'
    ].join(', ')).forEach(function (el) {
      el.remove();
    });
  }

  function copySafeDocAttributes(source, target, tag) {
    if (tag === 'A') {
      const href = source.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) {
        target.setAttribute('href', href);
        target.setAttribute('target', '_blank');
        target.setAttribute('rel', 'noopener noreferrer');
      }
      const title = source.getAttribute('title');
      if (title) target.setAttribute('title', title);
    } else if (tag === 'TD' || tag === 'TH') {
      ['colspan', 'rowspan'].forEach(function (name) {
        const value = source.getAttribute(name);
        if (value && /^\d{1,3}$/.test(value)) target.setAttribute(name, value);
      });
    } else if (tag === 'OL') {
      const start = source.getAttribute('start');
      if (start && /^-?\d{1,6}$/.test(start)) target.setAttribute('start', start);
    }
  }

  function sanitizeDocChildren(source, target) {
    Array.from(source.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        target.appendChild(document.createTextNode(node.nodeValue || ''));
        return;
      }
      if (node.nodeType !== 1) return;

      if (node.hasAttribute('data-doc-formula')) {
        const span = document.createElement('span');
        span.className = node.getAttribute('class') || 'doc-formula doc-inline';
        span.setAttribute('data-doc-formula', '1');
        const formulaType = node.getAttribute('data-type') === 'display' ? 'display' : 'inline';
        const renderAttr = node.getAttribute('data-render');
        span.dataset.source = node.getAttribute('data-source') || '';
        span.dataset.type = formulaType;
        span.dataset.render = renderAttr === 'inline' || renderAttr === 'display' ? renderAttr : formulaType;
        span.setAttribute('role', 'button');
        span.tabIndex = 0;
        span.title = '点击复制公式';
        target.appendChild(span);
        return;
      }

      const tag = node.tagName.toUpperCase();
      if (DOC_DROP_TAGS.has(tag)) return;
      if (!DOC_ALLOWED_TAGS.has(tag)) {
        sanitizeDocChildren(node, target);
        return;
      }

      const element = document.createElement(tag.toLowerCase());
      copySafeDocAttributes(node, element, tag);
      sanitizeDocChildren(node, element);
      target.appendChild(element);
    });
  }

  function buildDocFromHtml(html) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch (error) {
      return null;
    }
    if (!doc || !doc.body) return null;

    replaceHtmlMath(doc);
    const body = document.createElement('div');
    body.className = 'doc-body';
    sanitizeDocChildren(doc.body, body);
    return body;
  }

  function renderDoc() {
    els.docView.replaceChildren();
    if (!state.input.trim()) return;

    let body = null;
    if (state.lastPasteHtml && state.lastPasteText === state.input) {
      body = buildDocFromHtml(state.lastPasteHtml);
      if (body) {
        const htmlCount = body.querySelectorAll('[data-doc-formula]').length;
        let textCount = 0;
        try {
          textCount = Parser.extractFromText(state.input, {
            includeCode: state.includeCode,
            dedupe: false
          }).formulas.length;
        } catch (error) {
          textCount = 0;
        }
        const emptyHtml = !body.textContent.trim() && htmlCount === 0;
        const missingMath = textCount > 0 && htmlCount < Math.ceil(textCount / 2);
        if (emptyHtml || missingMath) body = null;
      }
    }

    if (!body) body = buildDocFromText(state.input);
    if (!body.childNodes.length) return;

    if (!body.querySelector('[data-doc-formula]') && state.formulas.length) {
      const note = document.createElement('div');
      note.className = 'doc-note';
      note.textContent = '当前文本中没有可定位的公式源码，原始富文本已不可用。请重新粘贴原始回答，或切到“卡片”视图复制公式。';
      body.appendChild(note);
    }

    els.docView.appendChild(body);
    hydrateDocFormulas(body);
  }

  function updateDocTip() {
    const label = FORMAT_LABELS[state.format] || FORMAT_LABELS.markdown;
    els.docTip.textContent = '点击任意公式即可复制 · 当前格式：' + label;
    els.docTip.hidden = state.view !== 'doc' || !state.formulas.length;
  }

  function wrapperLabel(formula) {
    if (formula.origin === 'html' || formula.origin === 'code') return '';
    if (formula.wrapper === 'double') return '$$';
    if (formula.wrapper === 'bracket') return '\\[ \\]';
    if (formula.wrapper === 'dollar') return '$';
    if (formula.wrapper === 'paren') return '\\( \\)';
    if (formula.wrapper === 'env') {
      const match = /^\\begin\{([^}]+)\}/.exec(formula.source);
      return match ? match[1] : '环境';
    }
    return '';
  }

  function createCard(formula, index) {
    const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
    const indexEl = card.querySelector('.formula-index');
    const typeBadge = card.querySelector('.type-badge');
    const originBadge = card.querySelector('.origin-badge');
    const wrapperEl = card.querySelector('.wrapper-label');
    const contextEl = card.querySelector('.formula-context');
    const previewEl = card.querySelector('.formula-preview');
    const sourceEl = card.querySelector('.formula-source');
    const copyButton = card.querySelector('.copy-one');
    const rawButton = card.querySelector('.copy-raw');

    indexEl.textContent = String(index + 1);
    typeBadge.textContent = formula.type === 'display' ? '行间' : '行内';
    typeBadge.classList.add(formula.type);

    if (formula.origin === 'html') {
      originBadge.hidden = false;
      originBadge.textContent = '富文本';
    } else if (formula.origin === 'code') {
      originBadge.hidden = false;
      originBadge.textContent = '代码块';
      originBadge.classList.add('code');
    }

    const label = wrapperLabel(formula);
    if (label) wrapperEl.textContent = label;
    else wrapperEl.hidden = true;

    const contextParts = [];
    if (formula.contextBefore) contextParts.push('…' + formula.contextBefore);
    if (formula.contextAfter) contextParts.push(formula.contextAfter + '…');
    if (contextParts.length) {
      contextEl.hidden = false;
      contextEl.textContent = contextParts.join(' ');
      contextEl.title = contextParts.join(' ');
    }

    sourceEl.value = formula.source;
    sourceEl.classList.toggle('is-edited', formula.source !== formula.originalSource);
    renderPreview(previewEl, formula);

    let previewTimer = null;
    sourceEl.addEventListener('input', function () {
      formula.source = sourceEl.value;
      sourceEl.classList.toggle('is-edited', formula.source !== formula.originalSource);
      autoSizeSource(sourceEl);
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () {
        renderPreview(previewEl, formula);
      }, 140);
      saveState();
    });

    copyButton.addEventListener('click', function () { copyFormula(formula, false); });
    rawButton.addEventListener('click', function () { copyFormula(formula, true); });

    return card;
  }

  function createNoMatchState() {
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-state compact';
    const title = document.createElement('h3');
    title.textContent = '没有匹配的公式';
    const text = document.createElement('p');
    text.textContent = '试试清空搜索，或切换到“全部”筛选。';
    wrapper.appendChild(title);
    wrapper.appendChild(text);
    return wrapper;
  }

  function updateViewControls() {
    const isDoc = state.view === 'doc';
    els.viewGroup.querySelectorAll('button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === state.view);
    });
    els.filterGroup.hidden = isDoc;
    els.searchInput.closest('.search-box').hidden = isDoc;
    els.docView.hidden = !isDoc;
    els.results.hidden = isDoc;
    updateDocTip();
  }

  function renderCards(visible) {
    els.results.replaceChildren();
    if (!visible.length) {
      els.results.appendChild(createNoMatchState());
      return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach(function (item) {
      fragment.appendChild(createCard(item.formula, item.index));
    });
    els.results.appendChild(fragment);

    els.results.querySelectorAll('.formula-source').forEach(function (textarea) {
      autoSizeSource(textarea);
    });
  }

  function render() {
    const visible = getVisibleFormulas();
    const isDoc = state.view === 'doc';
    updateStats(isDoc ? state.formulas.length : visible.length);
    updateFilterButtons();
    updateViewControls();

    const hasFormulas = state.formulas.length > 0;
    els.emptyState.hidden = hasFormulas;

    if (!hasFormulas) {
      els.results.replaceChildren();
      els.docView.replaceChildren();
      return;
    }

    if (isDoc) {
      els.results.replaceChildren();
      renderDoc();
      return;
    }

    els.docView.replaceChildren();
    renderCards(visible);
  }

  function extract(options) {
    const opts = options || {};
    const text = els.inputText.value;
    state.input = text;
    updateInputCount();

    if (!text.trim()) {
      state.formulas = [];
      state.formulasInput = '';
      state.lastPasteHtml = '';
      state.lastPasteText = '';
      savePasteCache('', '');
      render();
      setNotice(['请先粘贴包含公式的 AI 回答。'], 'warn');
      saveState();
      if (!opts.silent) showToast('输入为空', true);
      return;
    }

    const parsed = Parser.extractFromText(text, {
      includeCode: state.includeCode,
      dedupe: state.dedupe
    });

    let htmlFormulas = [];
    const canUseHtml = state.lastPasteHtml && state.lastPasteText === text;
    if (canUseHtml) {
      try {
        htmlFormulas = Parser.extractFromHtml(state.lastPasteHtml);
      } catch (error) {
        htmlFormulas = [];
      }
    }

    const merged = Parser.mergeFormulas(parsed.formulas, htmlFormulas, { dedupe: state.dedupe });
    state.formulas = merged.formulas.map(function (formula) {
      return normalizeFormula({
        source: formula.source,
        originalSource: formula.source,
        type: formula.type,
        wrapper: formula.wrapper,
        origin: formula.origin,
        contextBefore: formula.contextBefore,
        contextAfter: formula.contextAfter,
        start: formula.start,
        end: formula.end
      });
    }).filter(Boolean);
    state.formulasInput = text;

    const messages = [];
    if (merged.addedHtml > 0) {
      messages.push('已从剪贴板富文本中恢复 ' + merged.addedHtml + ' 个公式。');
    }
    parsed.warnings.forEach(function (warning) {
      messages.push(warning + '。');
    });

    let noticeType = messages.length ? 'info' : '';
    if (!state.formulas.length) {
      let message = '没有找到公式。请确认粘贴的内容包含 LaTeX 分隔符。';
      if (canUseHtml) {
        message += ' 剪贴板富文本中也没有可解析的 MathML/KaTeX 源码；如果原文公式是图片或纯排版字符，需要改用页面抓取方案。';
      }
      messages.push(message);
      noticeType = 'warn';
    } else if (parsed.warnings.length) {
      noticeType = 'warn';
    }

    setNotice(messages, noticeType);
    render();
    saveState();

    if (opts.scroll && state.formulas.length) {
      els.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (!opts.silent) {
      showToast(state.formulas.length ? '提取到 ' + state.formulas.length + ' 个公式' : '没有找到公式', !state.formulas.length);
    }
  }

  function loadExample() {
    const text = (els.exampleText.textContent || '').trim();
    els.inputText.value = text;
    state.input = text;
    state.lastPasteHtml = '';
    state.lastPasteText = '';
    savePasteCache('', '');
    state.search = '';
    state.filter = 'all';
    els.searchInput.value = '';
    updateInputCount();
    updateFilterButtons();
    extract({ scroll: true });
  }

  function clearAll() {
    els.inputText.value = '';
    state.input = '';
    state.formulas = [];
    state.formulasInput = '';
    state.lastPasteHtml = '';
    state.lastPasteText = '';
    savePasteCache('', '');
    state.search = '';
    state.filter = 'all';
    els.searchInput.value = '';
    updateInputCount();
    clearActiveEdits();
    render();
    setNotice([], '');
    saveState();
    els.inputText.focus();
    showToast('已清空');
  }

  function clearActiveEdits() {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('formula-source')) {
      active.blur();
    }
  }

  function handlePaste(event) {
    const target = event.target;
    const isInputTarget = target === els.inputText;
    const editable = target && target.closest
      ? target.closest('textarea, input, select, [contenteditable="true"]')
      : null;
    if (editable && !isInputTarget) return;

    let text = '';
    let html = '';
    try {
      if (event.clipboardData) {
        text = event.clipboardData.getData('text/plain') || '';
        html = event.clipboardData.getData('text/html') || '';
      }
    } catch (error) {
      text = '';
      html = '';
    }

    if (isInputTarget) {
      state.lastPasteHtml = html;
      setTimeout(function () {
        if (!els.inputText.value && html) {
          try {
            const fallback = new DOMParser().parseFromString(html, 'text/html').body.innerText || '';
            if (fallback) els.inputText.value = fallback;
          } catch (error) {
            // Leave the textarea empty.
          }
        }
        state.input = els.inputText.value;
        state.lastPasteText = state.input;
        savePasteCache(state.lastPasteHtml, state.lastPasteText);
        updateInputCount();
        extract({ silent: true });
      }, 0);
      return;
    }

    if (!text && !html) return;
    event.preventDefault();

    if (!text && html) {
      try {
        text = new DOMParser().parseFromString(html, 'text/html').body.innerText || '';
      } catch (error) {
        text = '';
      }
    }

    const insertAt = els.inputText.value.length;
    els.inputText.focus();
    els.inputText.setSelectionRange(insertAt, insertAt);
    els.inputText.setRangeText(text, insertAt, insertAt, 'end');
    state.input = els.inputText.value;
    state.lastPasteHtml = html;
    state.lastPasteText = state.input;
    savePasteCache(state.lastPasteHtml, state.lastPasteText);
    updateInputCount();
    extract({ silent: true });
  }

  async function pasteFromClipboard() {
    let text = '';
    let html = '';

    try {
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (!text && item.types.indexOf('text/plain') !== -1) {
            text = await (await item.getType('text/plain')).text();
          }
          if (!html && item.types.indexOf('text/html') !== -1) {
            html = await (await item.getType('text/html')).text();
          }
        }
      } else if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        text = await navigator.clipboard.readText();
      } else {
        throw new Error('clipboard API unavailable');
      }
    } catch (error) {
      els.inputText.focus();
      showToast('浏览器未授权读取剪贴板，请在输入框中按 Ctrl+V', true);
      return;
    }

    if (!text && !html) {
      showToast('剪贴板里没有文本内容', true);
      return;
    }

    if (!text && html) {
      try {
        text = new DOMParser().parseFromString(html, 'text/html').body.innerText || '';
      } catch (error) {
        text = '';
      }
    }

    els.inputText.value = text;
    state.input = text;
    state.lastPasteHtml = html;
    state.lastPasteText = text;
    savePasteCache(state.lastPasteHtml, state.lastPasteText);
    updateInputCount();
    extract({ scroll: true });
  }

  function bindEvents() {
    els.inputText.addEventListener('input', function () {
      state.input = els.inputText.value;
      updateInputCount();
      updateStats(state.view === 'doc' ? state.formulas.length : getVisibleFormulas().length);
      saveState();
    });

    els.extractBtn.addEventListener('click', function () { extract({ scroll: true }); });
    els.pasteBtn.addEventListener('click', pasteFromClipboard);
    els.exampleBtn.addEventListener('click', loadExample);
    els.emptyExampleBtn.addEventListener('click', loadExample);
    els.clearBtn.addEventListener('click', clearAll);

    els.includeCode.addEventListener('change', function () {
      state.includeCode = els.includeCode.checked;
      saveState();
      if (state.input.trim()) extract({ silent: true });
    });

    els.dedupe.addEventListener('change', function () {
      state.dedupe = els.dedupe.checked;
      saveState();
      if (state.input.trim()) extract({ silent: true });
    });

    els.viewGroup.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-view]');
      if (!button || button.dataset.view === state.view) return;
      state.view = button.dataset.view;
      saveState();
      render();
    });

    els.filterGroup.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;
      state.filter = button.dataset.filter;
      render();
    });

    els.searchInput.addEventListener('input', function () {
      state.search = els.searchInput.value;
      render();
    });

    els.formatSelect.addEventListener('change', function () {
      state.format = els.formatSelect.value;
      saveState();
      updateDocTip();
    });

    els.copyAllBtn.addEventListener('click', copyAll);
    els.exportBtn.addEventListener('click', exportMarkdown);
    els.themeToggle.addEventListener('click', toggleTheme);

    document.addEventListener('paste', handlePaste);

    document.addEventListener('keydown', function (event) {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
      const target = event.target;
      if (target && target.matches && target.matches('.formula-source, .search-box input, select')) return;
      event.preventDefault();
      extract({ scroll: true });
    });
  }

  function init() {
    loadState();
    els.inputText.value = state.input;
    els.includeCode.checked = state.includeCode;
    els.dedupe.checked = state.dedupe;
    els.formatSelect.value = state.format;
    updateInputCount();
    applyTheme(state.theme || document.documentElement.dataset.theme || preferredTheme());
    bindEvents();

    if (state.formulas.length && state.formulasInput === state.input) {
      render();
    } else if (state.input.trim()) {
      extract({ silent: true });
    } else {
      render();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
