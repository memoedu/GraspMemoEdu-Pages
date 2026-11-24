import {escapedAt, mathSpans} from './math-syntax.js?v=a7d489286149768a';

const namespace = 'http://www.w3.org/1998/Math/MathML';
const greek = /[Α-Ωα-ω]/;
const letter = /[A-Za-zΑ-Ωα-ω]/;
const functions = /^(?:arcsin|arccos|arctan|sin|cos|tan|cot|sec|csc|log|ln)(?=[(A-Za-zΑ-Ωα-ω0-9])/;

function tokenAt(text, index) {
  const tail = text.slice(index), fn = tail.match(functions);
  if (fn) return {kind: 'function', value: fn[0], size: fn[0].length};
  const number = tail.match(/^\d+(?:\.\d+)?/);
  if (number) return {kind: 'number', value: number[0], size: number[0].length};
  if (letter.test(tail[0] || '')) {
    if (/[A-Za-z]/.test(tail[0]) && /[A-Za-z]/.test(tail[1] || '')) return null;
    const match = tail.match(/^([A-Za-zΑ-Ωα-ω])(?:_(\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?(?:\^(\{[+-]?[A-Za-z0-9]+\}|[+-]?[A-Za-z0-9]+))?/);
    if (match) return {kind: 'identifier', value: match[1], sub: match[2]?.replace(/[{}]/g, ''),
      sup: match[3]?.replace(/[{}]/g, ''), size: match[0].length};
  }
  if (/^[=<>≤≥≠+−\-*/×·±,()[\]]/.test(tail)) return {kind: 'operator', value: tail[0], size: 1};
  return null;
}

export function literalMathSegments(text) {
  const segments = []; let cursor = 0, index = 0;
  while (index < text.length) {
    if (!/[A-Za-zΑ-Ωα-ω0-9(]/.test(text[index]) || letter.test(text[index - 1] || '')
      || /[\\/:._]/.test(text[index - 1] || '')) { index++; continue; }
    const tokens = []; let end = index, depth = 0;
    while (end < text.length) {
      const gap = text.slice(end).match(/^\s+/)?.[0] || '';
      const token = tokenAt(text, end + gap.length);
      if (!token) break;
      if ('(['.includes(token.value)) depth++;
      if (')]'.includes(token.value)) { if (!depth) break; depth--; }
      tokens.push(token); end += gap.length + token.size;
    }
    // A dangling operator/comma belongs to surrounding prose, not the formula.
    while (tokens.at(-1)?.kind === 'operator' && ![')', ']'].includes(tokens.at(-1).value)) {
      end -= tokens.pop().size;
      while (/\s/.test(text[end - 1] || '')) end--;
    }
    const identifiers = tokens.filter(token => token.kind === 'identifier');
    const mathematical = identifiers.some(token => token.sub || token.sup || greek.test(token.value))
      || identifiers.length && tokens.some(token => token.kind === 'operator' && /[=<>≤≥≠+−\-*/×·±]/.test(token.value));
    if (!mathematical || depth || end <= index) { index++; continue; }
    if (cursor < index) segments.push({text: text.slice(cursor, index)});
    segments.push({text: text.slice(index, end), tokens}); cursor = index = end;
  }
  if (cursor < text.length) segments.push({text: text.slice(cursor)});
  return segments;
}

function mathNode(name, value) {
  const element = document.createElementNS(namespace, name);
  if (value !== undefined) element.textContent = value;
  return element;
}

function formula(segment) {
  const math = mathNode('math'), row = mathNode('mrow');
  math.setAttribute('display', 'inline'); math.setAttribute('aria-label', segment.text);
  math.classList.add('literalMath'); math.append(row);
  for (const token of segment.tokens) {
    let item = mathNode(token.kind === 'number' ? 'mn' : token.kind === 'operator' ? 'mo' : 'mi', token.value);
    if (token.kind === 'function') item.setAttribute('mathvariant', 'normal');
    if (token.sub || token.sup) {
      const base = item; item = mathNode(token.sub && token.sup ? 'msubsup' : token.sub ? 'msub' : 'msup'); item.append(base);
      for (const script of [token.sub, token.sup].filter(Boolean)) item.append(mathNode(/^[-+]?\d+$/.test(script) ? 'mn' : 'mi', script));
    }
    row.append(item);
  }
  return math;
}

const protectedContent = 'mjx-container,math,svg,code,pre,kbd,samp,a,script,style,textarea,input,select,[data-tex],[data-math-source],.katex,[contenteditable="true"]';
const pendingText = new WeakSet();
const pendingDisplays = new WeakSet();
const mountedSvg = new WeakSet();
const glyphCodepoints = new WeakMap();
let fragmentNumber = 0, renderer;

function loadRenderer() {
  renderer ||= import('./vendor/formula/editor.mjs?v=a7d489286149768a').catch(error => { renderer = null; throw error; });
  return renderer;
}

function mathText(text, spans, renderLatex, requireComplete = false) {
  const fragment = document.createDocumentFragment();
  let from = 0;
  for (const span of spans) {
    const node = document.createElement('span');
    if (!renderLatex(node, span.latex, span.display)) {
      if (requireComplete) return null;
      continue;
    }
    node.dataset.mathSource = span.raw;
    node.className = span.display ? 'runtimeMath mathDisplay' : 'runtimeMath mathInline';
    fragment.append(text.slice(from, span.from), node);
    from = span.to;
  }
  if (!from) return null;
  fragment.append(text.slice(from));
  return fragment;
}

export function renderPlainMath(element, text = element.textContent) {
  const spans = [...mathSpans(text)];
  if (!spans.length) return;
  void loadRenderer().then(({renderLatex}) => {
    if (element.textContent !== text || element.querySelector('[data-math-source]')) return;
    const fragment = mathText(text, spans, renderLatex);
    if (fragment) element.replaceChildren(fragment);
  }).catch(() => {});
}

function scopeGlyphs(root) {
  const svgs = [...root.querySelectorAll('svg')].filter(svg => !mountedSvg.has(svg));
  if (!svgs.length) return;
  const ids = new Map(), prefix = 'rendered-math-' + ++fragmentNumber + '-';
  let count = 0;
  for (const svg of svgs) {
    mountedSvg.add(svg);
    // MathJax cache identifiers can repeat in separate mounts of stored HTML.
    for (const glyph of svg.querySelectorAll('defs :is([id^="MJX-"],[id^="rendered-math-"])')) {
      const old = glyph.id;
      const codepoint = /^MJX-.*-([A-F0-9]{2,6})$/i.exec(old)?.[1];
      if (codepoint) glyphCodepoints.set(glyph, codepoint);
      glyph.id = prefix + ++count;
      if (!ids.has(old)) ids.set(old, glyph.id);
    }
  }
  if (!ids.size) return;
  for (const svg of svgs) for (const use of svg.querySelectorAll('use')) {
    const href = use.getAttribute('href');
    const xlink = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href?.startsWith('#') && ids.has(href.slice(1))) use.setAttribute('href', '#' + ids.get(href.slice(1)));
    if (xlink?.startsWith('#') && ids.has(xlink.slice(1))) use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + ids.get(xlink.slice(1)));
  }
}

const mathEscape = text => text.replace(/[#$%&_{}]/g, '\\$&')
  .replaceAll('−', '-').replaceAll('\u2061', ' ').replaceAll('\u2062', '');
const presentationOnly = new Set(['defs', 'rect', 'line', 'annotation', 'annotation-xml']);

function presentationLatex(node) {
  const tag = node.getAttribute('data-mml-node') || node.localName;
  if (tag === 'use' || tag === 'path') {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href') || '';
    const glyph = href.startsWith('#') ? node.ownerDocument.getElementById(href.slice(1)) : null;
    const code = node.getAttribute('data-c') || glyphCodepoints.get(glyph) ||
      /^#MJX-.*-([A-F0-9]{2,6})$/i.exec(href)?.[1];
    const point = /^[A-F0-9]{2,6}$/i.test(code || '') ? parseInt(code, 16) : 0;
    return point >= 32 && point <= 0x10ffff ? mathEscape(String.fromCodePoint(point)) : '';
  }
  const children = node.childElementCount
    ? [...node.children].filter(child => !presentationOnly.has(child.localName)).map(presentationLatex)
    : [mathEscape(node.textContent)];
  const [base = '', sub = '', upper = ''] = children;
  switch (tag) {
    case 'mfrac': return '\\frac{' + base + '}{' + sub + '}';
    case 'msup': return '{' + base + '}^{' + sub + '}';
    case 'msub': return '{' + base + '}_{' + sub + '}';
    case 'msubsup': return '{' + base + '}_{' + sub + '}^{' + upper + '}';
    case 'msqrt': return '\\sqrt{' + children.join('') + '}';
    case 'mroot': return '\\sqrt[' + sub + ']{' + base + '}';
    case 'mover': return '\\overset{' + sub + '}{' + base + '}';
    case 'munder': return '\\underset{' + sub + '}{' + base + '}';
    case 'munderover': return '\\overset{' + upper + '}{\\underset{' + sub + '}{' + base + '}}';
    case 'mtable': return '\\begin{matrix}' + children.join(' \\\\ ') + '\\end{matrix}';
    case 'mtr': case 'mlabeledtr': return children.join(' & ');
    case 'mtext': return '\\text{' + children.join('') + '}';
    default: return children.join('');
  }
}

// Recover the formula represented by older SVG and MathML without source attributes.
export function presentationMathSource(node) {
  const math = node.matches('math') ? node : node.querySelector('math,svg [data-mml-node="math"]');
  if (!math) return '';
  const latex = presentationLatex(math).trim();
  if (!latex) return '';
  const display = node.matches('[display="true"],[display="block"]');
  return display ? '\\[' + latex + '\\]' : '\\(' + latex + '\\)';
}

function storedLatex(math) {
  const source = math.closest('[data-tex]');
  const tex = source && source.querySelectorAll('mjx-container').length <= 1
    ? source.getAttribute('data-tex')
    : math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  const value = tex?.trim();
  if (!value) return '';
  const first = mathSpans(value).next().value;
  return first?.raw === value ? first.latex : value;
}

// Archived lessons include SVG glyph paths. Render their stored TeX with
// the same selectable KaTeX HTML used for plain TeX and Thread UI.
export function installSelectableMath(root = document.body) {
  const archived = 'mjx-container[jax="SVG"]';
  const seen = new WeakSet();
  function candidates(node, batch) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches(archived)) batch.add(node);
    for (const math of node.querySelectorAll(archived)) batch.add(math);
  }
  function render(batch) {
    const pending = [...batch].filter(math => !seen.has(math));
    if (!pending.length) return;
    pending.forEach(math => seen.add(math));
    void loadRenderer().then(({renderLatex}) => {
      for (const math of pending) {
        if (!root.contains(math) || !math.matches(archived)) continue;
        const source = storedLatex(math);
        const display = math.getAttribute('display') === 'true';
        const content = document.createElement('span');
        if (!source || !renderLatex(content, source, display)) {
          const semantic = math.querySelector('mjx-assistive-mml math');
          const recovered = presentationMathSource(math);
          if (semantic) {
            const native = semantic.cloneNode(true);
            if (display) native.setAttribute('display', 'block');
            content.append(native);
          } else if (!recovered || !renderLatex(content, recovered.slice(2, -2), display)) continue;
          if (!source && recovered) math.dataset.mathSource = recovered;
        }
        math.setAttribute('jax', 'HTML');
        math.replaceChildren(...content.childNodes);
      }
    }).catch(() => pending.forEach(math => seen.delete(math)));
  }
  const initial = new Set();
  candidates(root, initial);
  render(initial);
  new MutationObserver(records => {
    const batch = new Set();
    for (const record of records) for (const node of record.addedNodes) candidates(node, batch);
    render(batch);
  }).observe(root, {childList: true, subtree: true});
}

// Some older imports put the matrix in a display node between two paragraphs
// and left the enclosing inline formula's delimiters as text. Keep the matrix
// SVG and restore the inline sequence when its original boundaries survive.
function joinSplitMath(root) {
  const legacy = '.mathDisplay:not([data-tex]) > mjx-container[display="true"]';
  for (const math of root.querySelectorAll(legacy)) {
    if (pendingDisplays.has(math)) continue;
    const display = math.parentElement, before = display.previousElementSibling;
    const start = before?.matches('p') && before.lastChild;
    if (start?.nodeType !== Node.TEXT_NODE) continue;
    const dollars = [...start.data.matchAll(/\$/g)].filter(match => !escapedAt(start.data, match.index));
    if (dollars.length !== 1) continue;
    const offset = dollars[0].index, prefix = start.data.slice(offset + 1);
    if (prefix.trim() && !/\\[A-Za-z]|[_^=]/.test(prefix)) continue;
    const parts = [{text: start, from: offset, raw: start.data.slice(offset), latex: prefix}], blocks = [];
    let current = display, end;
    while (current?.firstElementChild?.matches(legacy)) {
      const after = current.nextElementSibling;
      if (!after?.matches('p') || after.firstChild?.nodeType !== Node.TEXT_NODE) break;
      const text = after.firstChild;
      const close = [...text.data.matchAll(/\$/g)].find(match => !escapedAt(text.data, match.index));
      const tail = text.data.slice(0, close?.index);
      blocks.push(current, after);
      if (close) {
        parts.push({text, from: 0, raw: tail + '$', latex: tail});
        end = after;
        break;
      }
      if (after.childNodes.length !== 1 || !/\\[A-Za-z]|[_^=]/.test(tail)) break;
      parts.push({text, from: 0, raw: tail, latex: tail});
      current = after.nextElementSibling;
    }
    if (!end) continue;
    for (const block of blocks) if (block.matches('.mathDisplay')) pendingDisplays.add(block.firstElementChild);
    void loadRenderer().then(({renderLatex}) => {
      if (before.nextElementSibling !== display || blocks.some(block => block.parentNode !== before.parentNode)
          || parts.some(part => !part.text.parentNode || !part.text.data.startsWith(part.raw, part.from))) return;
      const pieces = parts.map(({raw, latex}) => {
        const fragment = document.createElement('span');
        fragment.dataset.mathSource = raw;
        const source = latex.trim();
        if (!source) fragment.hidden = true;
        else if (!renderLatex(fragment, /^[\^_]/.test(source) ? '{}' + source : source, false)) return null;
        return fragment;
      });
      if (pieces.some(piece => !piece)) return;
      for (const [index, {text, from, raw}] of parts.entries()) {
        const after = text.splitText(from);
        after.deleteData(0, raw.length);
        after.before(pieces[index]);
      }
      for (const block of blocks) {
        while (before.nextSibling && before.nextSibling !== block) before.append(before.nextSibling);
        if (block.matches('.mathDisplay')) {
          block.classList.replace('mathDisplay', 'mathInline');
          block.firstElementChild.removeAttribute('display');
          before.append(block);
        } else {
          before.append(...block.childNodes);
          block.remove();
        }
      }
    }).catch(() => {});
  }
}

export function prepareMathContent(root, {literal = false} = {}) {
  scopeGlyphs(root);
  const source = root.textContent;
  if (!/[$\\]/.test(source) && (!literal || !/[Α-Ωα-ω_^=<>≤≥≠+−*\/×·±-]/.test(source))) return root;
  joinSplitMath(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), plain = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.data;
    const hasLatex = /[$\\]/.test(text);
    if ((!hasLatex && !literal) || !node.parentElement || node.parentElement.closest(protectedContent) || pendingText.has(node)) continue;
    if (hasLatex) {
      const spans = [...mathSpans(text)];
      if (!spans.length) continue;
      pendingText.add(node);
      void loadRenderer().then(({renderLatex}) => {
        if (!node.parentNode || node.data !== text) return;
        const fragment = mathText(text, spans, renderLatex);
        if (fragment) node.replaceWith(fragment);
      }).catch(() => {}).finally(() => pendingText.delete(node));
      continue;
    }
    if (literal) plain.push(node);
  }
  for (const node of plain) {
    const segments = literalMathSegments(node.data);
    if (!segments.some(segment => segment.tokens)) continue;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) fragment.append(segment.tokens ? formula(segment) : document.createTextNode(segment.text));
    node.replaceWith(fragment);
  }
  return root;
}

export function optionUsesMath(item) {
  return /(?:mjx-container|<math\b)/i.test(item.html || '') || !mathSpans(item.text || '').next().done;
}

export function setOptionContent(element, item) {
  const text = item?.text || '';
  if (!item?.html) element.textContent = text;
  else {
    // The HTML field is compiled and sanitized on import.
    element.innerHTML = item.html;
    const spans = [...mathSpans(text)];
    const singleFormula = spans.length === 1 && spans[0].raw === text.trim();
    // Older Math Academy options split an environment out of its enclosing
    // inline formula. Re-render from the option source if only fragment
    // paragraphs and the compiled formulas are present.
    if (spans.length && element.querySelector('.mathDisplay > mjx-container')
        && element.textContent.includes('$')
        && !element.querySelector('img,a,code,pre,table')
        && (singleFormula || [...element.children].every(child => child.matches('p,.mathDisplay,.mathInline'))
          && !element.querySelector('em,strong,ul,ol'))) {
      const first = element.firstChild;
      void loadRenderer().then(({renderLatex}) => {
        if (element.firstChild !== first) return;
        const fragment = mathText(text, spans, renderLatex, true);
        if (fragment) element.replaceChildren(fragment);
      }).catch(() => {});
      scopeGlyphs(element);
      return element;
    }
  }
  return prepareMathContent(element, {literal: true});
}
