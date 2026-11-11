import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vendor = path.join(root, 'vendor', 'katex');
const fontsDir = path.join(vendor, 'fonts');

const read = (file) => fs.readFileSync(file, 'utf8');

let katexCss = read(path.join(vendor, 'katex.min.css'));
let katexJs = read(path.join(vendor, 'katex.min.js'));

katexCss = katexCss.replace(
  /src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\),url\([^)]+\.woff\) format\("woff"\),url\([^)]+\.ttf\) format\("truetype"\)/g,
  (match, fontFile) => {
    const data = fs.readFileSync(path.join(fontsDir, fontFile));
    return 'src:url(data:font/woff2;base64,' + data.toString('base64') + ') format("woff2")';
  }
);

if (katexCss.includes('url(fonts/')) {
  throw new Error('KaTeX CSS still contains external font references.');
}

katexCss = katexCss.replace(/\/\*# sourceMappingURL=.*?\*\//g, '');
katexJs = katexJs.replace(/^\/\/# sourceMappingURL=.*$/gm, '');

const license = read(path.join(vendor, 'LICENSE')).trim().replace(/--/g, '- -');
const licenseComment = '<!--\nKaTeX is bundled under the MIT License.\n\n' + license + '\n-->';

const appCss = read(path.join(root, 'src', 'styles.css'));
const parserJs = read(path.join(root, 'src', 'parser.js'));
const appJs = read(path.join(root, 'src', 'app.js'));
let html = read(path.join(root, 'src', 'index.html'));

const replacements = {
  '<!--__KATEX_CSS__-->': '<style id="katex-css">' + katexCss + '</style>',
  '<!--__APP_CSS__-->': '<style id="app-css">' + appCss + '</style>',
  '<!--__KATEX_JS__-->': '<script id="katex-js">' + katexJs + '</script>',
  '<!--__PARSER_JS__-->': '<script id="parser-js">' + parserJs + '</script>',
  '<!--__APP_JS__-->': '<script id="app-js">' + appJs + '</script>'
};

for (const [placeholder, content] of Object.entries(replacements)) {
  if (!html.includes(placeholder)) {
    throw new Error('Missing placeholder: ' + placeholder);
  }
  html = html.replace(placeholder, () => content);
}

html = html.replace('<head>', () => '<head>\n  ' + licenseComment);

const output = path.join(root, 'formula-extractor.html');
fs.writeFileSync(output, html, 'utf8');
console.log('Built ' + output);

const pagesOutput = path.join(root, 'index.html');
fs.writeFileSync(pagesOutput, html, 'utf8');
console.log('Built ' + pagesOutput);
console.log('Size: ' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB');
