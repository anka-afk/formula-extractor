const assert = require('node:assert/strict');
const Parser = require('../src/parser.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (error) {
    console.error('FAIL - ' + name);
    console.error(error.message);
    process.exitCode = 1;
  }
}

test('extracts inline and display delimiters in order', () => {
  const text = String.raw`设 $x^2+y^2=1$，并且
$$\frac{a}{b}$$
以及 \[
E=mc^2
\]
和 \(a+b\)。
\begin{align}
a &= b+c \\
d &= e
\end{align}`;
  const result = Parser.extractFromText(text);
  assert.equal(result.formulas.length, 5);
  assert.deepEqual(result.formulas.map((f) => f.type), ['inline', 'display', 'display', 'inline', 'display']);
  assert.equal(result.formulas[0].source, 'x^2+y^2=1');
  assert.equal(result.formulas[1].source, '\\frac{a}{b}');
  assert.equal(result.formulas[4].wrapper, 'env');
});

test('ignores currency amounts', () => {
  const result = Parser.extractFromText('成本是 $5 和 $10，不应识别。');
  assert.equal(result.formulas.length, 0);
});

test('ignores escaped dollars', () => {
  const result = Parser.extractFromText(String.raw`价格 \$5，公式 $x$。`);
  assert.equal(result.formulas.length, 1);
  assert.equal(result.formulas[0].source, 'x');
});

test('ignores unclosed currency-like dollars without warning', () => {
  const result = Parser.extractFromText('成本 $5，公式 $x$。');
  assert.equal(result.formulas.length, 1);
  assert.equal(result.warnings.length, 0);
});

test('skips inline code by default and includes it on request', () => {
  const text = '`$x$` 和 $y$';
  assert.equal(Parser.extractFromText(text).formulas.length, 1);
  assert.equal(Parser.extractFromText(text, { includeCode: true }).formulas.length, 2);
});

test('skips normal fenced code and extracts math fences', () => {
  const text = '```js\nconst x = "$a$";\n```\n$b$';
  assert.equal(Parser.extractFromText(text).formulas.length, 1);
  assert.equal(Parser.extractFromText(text, { includeCode: true }).formulas.length, 2);

  const mathFence = '```latex\nx^2+y^2\n```';
  const result = Parser.extractFromText(mathFence);
  assert.equal(result.formulas.length, 1);
  assert.equal(result.formulas[0].origin, 'code');
  assert.equal(result.formulas[0].source, 'x^2+y^2');
});

test('handles display math containing environments', () => {
  const result = Parser.extractFromText('$$\\begin{cases} a & b \\\\ c & d \\end{cases}$$');
  assert.equal(result.formulas.length, 1);
  assert.equal(result.formulas[0].type, 'display');
  assert.match(result.formulas[0].source, /^\\begin\{cases\}/);
});

test('warns on unclosed inline math', () => {
  const result = Parser.extractFromText('这里有个未闭合的 $x');
  assert.equal(result.formulas.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('dedupes by default', () => {
  const text = '$x$ 和 $x$';
  assert.equal(Parser.extractFromText(text).formulas.length, 1);
  assert.equal(Parser.extractFromText(text, { dedupe: false }).formulas.length, 2);
});

test('captures context around formulas', () => {
  const result = Parser.extractFromText('前文内容 $x$ 后文内容');
  assert.match(result.formulas[0].contextBefore, /前文内容/);
  assert.match(result.formulas[0].contextAfter, /后文内容/);
});

test('formats for markdown, parentheses, raw and original wrappers', () => {
  const inline = { source: 'x', type: 'inline', wrapper: 'dollar' };
  const display = { source: 'a+b', type: 'display', wrapper: 'double' };
  const env = { source: '\\begin{align}a&=b\\end{align}', type: 'display', wrapper: 'env' };
  assert.equal(Parser.formatFormula(inline, 'markdown'), '$x$');
  assert.equal(Parser.formatFormula(display, 'markdown'), '$$\na+b\n$$');
  assert.equal(Parser.formatFormula(inline, 'paren'), '\\(x\\)');
  assert.equal(Parser.formatFormula(display, 'paren'), '\\[\na+b\n\\]');
  assert.equal(Parser.formatFormula(display, 'raw'), 'a+b');
  assert.equal(Parser.formatFormula(env, 'original'), '\\begin{align}a&=b\\end{align}');
});

test('unwraps equation environment for markdown output', () => {
  const formula = {
    source: '\\begin{equation}a=b\\end{equation}',
    type: 'display',
    wrapper: 'env'
  };
  assert.equal(Parser.formatFormula(formula, 'markdown'), '$$\na=b\n$$');
});

test('preview source strips unsupported labels', () => {
  const source = '\\begin{equation}a=b \\label{eq:test}\\end{equation}';
  assert.equal(Parser.getPreviewSource(source), 'a=b');
});

test('merges rich-text formulas without duplicating text formulas', () => {
  const text = Parser.extractFromText('$x$');
  const html = [
    { source: 'x', type: 'inline', wrapper: 'html', origin: 'html' },
    { source: 'y=1', type: 'display', wrapper: 'html', origin: 'html' }
  ];
  const merged = Parser.mergeFormulas(text.formulas, html);
  assert.equal(merged.formulas.length, 2);
  assert.equal(merged.addedHtml, 1);
  assert.equal(merged.formulas[1].source, 'y=1');
});

test('parses markdown tables with alignment and rows', () => {
  const text = '前言\n\n| 方法 | 目标 | 说明 |\n| :--- | :---: | ---: |\n| PPO | $x$ | 稳定 |\n| DPO | $y$ | 简单 |\n\n后记';
  const table = Parser.findTable(text, 0, text.length);
  assert.ok(table);
  assert.equal(table.header.length, 3);
  assert.deepEqual(table.align, ['left', 'center', 'right']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].cells[2].text, '简单');
  assert.match(table.markdown, /^\| 方法 \| 目标 \| 说明 \|/);
});

test('tables keep escaped pipes and pipes inside code spans', () => {
  const text = '| a | b |\n| --- | --- |\n| x \\| y | `p | q` |';
  const table = Parser.findTable(text, 0, text.length);
  assert.ok(table);
  assert.equal(table.rows[0].cells.length, 2);
  assert.equal(table.rows[0].cells[0].text, 'x | y');
  assert.equal(table.rows[0].cells[1].text, '`p | q`');
});

test('requires matching column counts in the delimiter row', () => {
  const text = '| a | b |\n| --- |\n';
  assert.equal(Parser.findTable(text, 0, text.length), null);
});

test('does not mistake setext headings for tables', () => {
  const text = '标题\n---\n正文';
  assert.equal(Parser.findTable(text, 0, text.length), null);
});

test('does not mistake lists containing pipes for tables', () => {
  const text = '- a | b\n- --- | ---\n';
  assert.equal(Parser.findTable(text, 0, text.length), null);
});

test('table cell offsets point at trimmed cell content', () => {
  const text = '| $a$ | b |\n| --- | --- |';
  const table = Parser.findTable(text, 0, text.length);
  const firstCell = table.header[0];
  assert.equal(text.slice(firstCell.start, firstCell.end), '$a$');
  assert.equal(firstCell.start, 2);
});

console.log('\n' + passed + ' tests passed');
