const starts = /\$\$?|\\(?:\(|\[|begin\{)/g;
const environments = /^(?:align(?:at)?|aligned(?:at)?|array|[bpvBV]?matrix|cases|equation|gather(?:ed)?|multline|smallmatrix|split)\*?$/;

export function escapedAt(text, index) {
  let start = index;
  while (text[start - 1] === '\\') start--;
  return (index - start) % 2 === 1;
}

export function mathAt(text, from = 0, {allowUnbalanced = false} = {}) {
  if (escapedAt(text, from)) return null;
  const opening = text.slice(from, from + 2);
  if (text.startsWith('\\begin{', from)) {
    const name = /^\\begin\{([^{}]+)\}/.exec(text.slice(from))?.[1];
    if (!name || !environments.test(name)) return null;
    const tags = /\\(begin|end)\{([^{}]+)\}/g;
    tags.lastIndex = from + 8 + name.length;
    let depth = 1, match;
    while ((match = tags.exec(text))) {
      if (match[2] !== name || escapedAt(text, match.index)) continue;
      depth += match[1] === 'begin' ? 1 : -1;
      if (!depth) return {from, to: tags.lastIndex, raw: text.slice(from, tags.lastIndex),
        latex: text.slice(from, tags.lastIndex), display: true};
    }
    return null;
  }

  const open = opening === '$$' || opening === '\\(' || opening === '\\[' ? opening : text[from];
  const close = {'$$': '$$', '\\(': '\\)', '\\[': '\\]', '$': '$'}[open];
  if (!close) return null;
  const begin = from + open.length;
  const spanEndingAt = end => ({from, to: end + close.length, raw: text.slice(from, end + close.length),
    latex: text.slice(begin, end), display: open === '$$' || open === '\\['});
  let unbalancedEnd;
  for (let i = begin, depth = 0; i < text.length; i++) {
    if (text[i] === '\n' && (open === '$' || open === '\\(')) {
      if (text[i + 1] === '\n') break;
      if (open === '$' && !/\\begin\{/.test(text.slice(begin, i + 1))
          && !/^[\t ]*\\begin\{/.test(text.slice(i + 1))) break;
    }
    if (text.startsWith(close, i)) {
      if (depth) {
        unbalancedEnd ??= i;
        continue;
      }
      const latex = text.slice(begin, i);
      if (!latex.trim()) return null;
      if (open === '$' && /^\s*[+-]?\d[\d,.]*(?:\s+|[.!?]\s*)\p{L}{2}/u.test(latex)) return null;
      // The next currency amount can follow a conjunction or punctuation.
      if (open === '$' && /^\s*\d/.test(latex) && /\s$/.test(latex) && /\d/.test(text[i + 1] || '')) return null;
      return spanEndingAt(i);
    }
    if (text[i] === '\\') i++;
    else if (text[i] === '{') depth++;
    else if (text[i] === '}' && depth) depth--;
  }
  return allowUnbalanced && unbalancedEnd !== undefined ? spanEndingAt(unbalancedEnd) : null;
}

export function* mathSpans(text, options) {
  const markers = new RegExp(starts);
  let match;
  while ((match = markers.exec(text))) {
    const span = mathAt(text, match.index, options);
    if (span) {
      markers.lastIndex = span.to;
      yield span;
    }
  }
}
