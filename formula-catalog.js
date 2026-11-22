import {expressionCompletions} from './calculator-policy.js?v=7f75039d97260881';

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
const operators = {'*': '\\times', '/': '\\div', '^': '\\square^{#?}', '!': '\\square!',
  '-': '-', '+': '+', '=': '=', '(': '(', ')': ')', ',': ',', '.': '.'};
const standardFunctions = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'abs']);
const shared = expressionCompletions().flatMap(({label, value, keys}) => {
  if (value === 'log_' || special.has(label) || /^\d$/.test(value)) return [];
  if (value.endsWith('(')) {
    const name = value.slice(0, -1);
    if (special.has(name)) return [];
    if (name === 'abs') return [template(name, '\\left|#?\\right|')];
    if (name === 'log10') return [functionTemplate(name, '\\log_{10}')];
    const head = standardFunctions.has(name) ? '\\' + name : '\\operatorname{' + name + '}';
    return [functionTemplate(name, head)];
  }
  const latex = operators[value] ?? (/^[A-Za-z]+$/.test(value) ? value : '');
  return latex ? [template(label, latex, undefined, keys || [label, value])] : [];
});

export const formulaTemplates = [...explicit, ...shared];

// Preserve complete delimited fragments and untouched prose exactly in drafts.
const formulaPattern = /(?<!\\)(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$))/g;
export function formulaSpans(value) {
  return [...value.matchAll(formulaPattern)].map(match => ({
    from: match.index, to: match.index + match[0].length, raw: match[0],
    latex: match[1] ?? match[2] ?? match[3] ?? match[4], display: !!(match[1] ?? match[2]),
  }));
}
