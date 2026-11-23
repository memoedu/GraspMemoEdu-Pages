import {expressionCompletions} from './calculator-policy.js?v=8f429bf0142eb1a4';

export const formulaToken = /(\\?[a-z_][a-z_0-9]*|[+−*×/÷^!(),.π√=\-])$/i;

const functionTemplate = (name, head = name) => ({
  label: name, keys: [name, '\\' + name],
  latex: head + '\\left(#?\\right)', sample: head + '()',
});
const template = (name, latex, sample = latex.replaceAll('#?', '\\square'), keys = [name, '\\' + name]) =>
  ({label: name, keys, latex, sample});

const explicit = [
  functionTemplate('f'), functionTemplate('g'), functionTemplate('h'),
  template('frac', '\\frac{#?}{#?}'), template('sqrt', '\\sqrt{#?}'),
  template('floor', '\\left\\lfloor#?\\right\\rfloor', '\\lfloor\\square\\rfloor'),
  template('ceil', '\\left\\lceil#?\\right\\rceil', '\\lceil\\square\\rceil'),
  template('sum', '\\sum_{#?}^{#?}'), template('int', '\\int_{#?}^{#?}'),
  template('alpha', '\\alpha'), template('beta', '\\beta'), template('theta', '\\theta'),
  template('pi', '\\pi', '\\pi', ['pi', '\\pi', 'π']),
  template('le', '\\le'), template('ge', '\\ge'), template('neq', '\\ne', '\\ne', ['ne', 'neq', '\\ne', '\\neq']),
  template('log-base', '\\log_{#?}\\left(#?\\right)', '\\log_{\\square}()', ['log_', 'logₐ', '\\log_']),
];

const special = new Map(explicit.map(item => [item.label, item]));
const operators = {'*': '\\times', '/': '\\div', '^': '^{#?}', '_': '_{#?}', '!': '!',
  '-': '-', '+': '+', '=': '=', '(': '(', ')': ')', ',': ',', '.': '.'};
const standardFunctions = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp']);
const symbols = {pi: '\\pi', hbar: '\\hbar', g0: 'g_{0}', k_B: 'k_{B}', N_A: 'N_{A}', q_e: 'q_{e}'};
const functionHead = name => standardFunctions.has(name) ? '\\' + name : '\\operatorname{' + name + '}';
// A calculator completion inserts its native prefix. A formula template also supplies its argument slots.
export function nativeFormulaSample(value) {
  if (value === 'log_') return '\\log_{\\square}';
  if (value.endsWith('(') && /^[A-Za-z][A-Za-z0-9]*\($/.test(value)) {
    const name = value.slice(0, -1);
    return (name === 'log10' ? '\\log_{10}' : functionHead(name)) + '(';
  }
  if (value === '^') return '\\mathord{\\char94}';
  return symbols[value] ?? operators[value] ?? (/^[a-z0-9]+$/i.test(value) ? value : '');
}
export function matchesCompletion(item, term) {
  const prefix = term.toLowerCase();
  if (item.latex === term && term !== '!') return false;
  // Keep the spelled-out function available from "fa". Its postfix operator is keyed only by "!".
  if (item.label === 'factorial' && prefix.replace(/^\\/, '').length < 2) return false;
  return (item.keys || [item.value, item.label]).some(key => key.toLowerCase().startsWith(prefix));
}
const shared = expressionCompletions().flatMap(({label, value, keys}) => {
  if (value === 'log_' || special.has(label) || /^\d$/.test(value)) return [];
  if (value.endsWith('(')) {
    const name = value.slice(0, -1);
    if (special.has(name)) return [];
    if (name === 'abs') return [template(name, '\\left|#?\\right|')];
    if (name === 'log10') return [functionTemplate(name, '\\log_{10}')];
    return [functionTemplate(name, functionHead(name))];
  }
  const latex = symbols[value] ?? operators[value] ?? (/^[A-Za-z]+$/.test(value) ? value : '');
  return latex ? [template(value, latex, undefined, keys || [value])] : [];
});

export const formulaTemplates = [...explicit, ...shared, template('_', '_{#?}', undefined, ['_'])];

export function followingArgument(source, offset) {
  if (source[offset] !== '(') return null;
  let depth = 1;
  for (let end = offset + 1; end < source.length; end++) {
    if (source[end] === '(') depth++;
    if (source[end] === ')' && --depth === 0) return {body: source.slice(offset + 1, end), end: end + 1};
  }
  return null;
}

// Prose and exact-match answers share a text field. Only recognised mathematical runs
// go to MathLive's parser. Ordinary words, URLs, and their original offsets stay intact.
const mathWords = new Set([...formulaTemplates.map(item => item.label.toLowerCase()), 'arcsin', 'arccos', 'arctan', 'lim']);
export function bareMathRuns(value) {
  if (value.length > 4000) return [];
  const runs = [];
  // Split on prose words and punctuation. A TeX control word and its arguments are one run.
  const pieces = /\\[A-Za-z]+|[A-Za-z]+|[0-9]+|[ \t]+|[α-ωΑ-Ωπ√∞≤≥≠±×÷−+*/^_!=()[\]{}.,|<>-]/gy;
  let start = 0, end = 0;
  function finish() {
    const raw = value.slice(start, end).trim();
    const standalone = raw && raw === value.trim();
    const operand = /[a-z\dα-ω\\√∞]/i.test(raw);
    const notation = /[\\α-ωΑ-Ω√∞≤≥≠±×÷−+*/^_!=()[\]{}|<>-]/.test(raw);
    if (raw && (standalone && (operand || notation) || operand && notation)) {
      const from = start + value.slice(start, end).indexOf(raw);
      runs.push({from, to: from + raw.length, raw});
    }
  }
  while (end < value.length) {
    pieces.lastIndex = end;
    const token = pieces.exec(value)?.[0];
    if (!token || /^[A-Za-z]{2,}$/.test(token) && !mathWords.has(token.toLowerCase())) {
      finish(); end += token?.length || 1; start = end;
    } else {
      end += token.length;
      // Prose inside \text{...}, \operatorname{...} and nested TeX arguments
      // belongs to the control word. Preserve its exact extent for replacement.
      if (token.startsWith('\\')) {
        while (value[end] === '{' || value[end] === '[') {
          const open = value[end], close = open === '{' ? '}' : ']';
          let depth = 1, cursor = end + 1;
          for (; cursor < value.length && depth; cursor++) {
            if (value[cursor] === '\\') cursor++;
            else if (value[cursor] === open) depth++;
            else if (value[cursor] === close) depth--;
          }
          end = cursor;
        }
      }
    }
  }
  finish();
  return runs;
}

// Preserve complete delimited fragments and untouched prose exactly in drafts.
const formulaPattern = /(?<!\\)(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$))/g;
export function formulaSpans(value) {
  return [...value.matchAll(formulaPattern)].map(match => ({
    from: match.index, to: match.index + match[0].length, raw: match[0],
    latex: match[1] ?? match[2] ?? match[3] ?? match[4], display: !!(match[1] ?? match[2]),
  }));
}
