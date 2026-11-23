// Keep the visible question separate from the focused field's original text.
const contexts = new WeakMap();
const domains = {
  coordinates: /坐标|有序(?:数)?对|coordinate|ordered pair/i,
  vectors: /向量|矢量|vector/i, calculus: /积分|微分|导数|梯度|integral|derivative|gradient/i,
  fractions: /分式|分数|分母|分子|fraction/i, geometry: /三角形|圆周|几何|triangle|geometry/i,
  functions: /函数|映射|function/i, sequences: /数列|递推|sequence|recurrence/i,
};

export function setVoiceContext(element, question, style = 'mixed') {
  if (!element) return;
  contexts.delete(element);
  if (!question) return;
  const template = document.createElement('template');
  const parts = [question, ...(question.multi_step?.steps || [])];
  template.innerHTML = parts.map(part => typeof part.html === 'string' ? part.html : '').join('<br>');
  const shown = template.content;
  for (const hidden of shown.querySelectorAll('script,style,template,[hidden],[inert],[aria-hidden="true"],input,textarea,select')) hidden.remove();
  for (const styled of shown.querySelectorAll('[style]')) {
    if (styled.style.display === 'none' || styled.style.visibility === 'hidden') styled.remove();
  }
  for (const details of shown.querySelectorAll('details:not([open])')) details.replaceWith(details.querySelector('summary')?.textContent || '');
  const math = [];
  for (const node of shown.querySelectorAll('[data-tex],[data-math-source],math')) {
    const tex = node.getAttribute('data-tex') || node.getAttribute('data-math-source') ||
      node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) { math.push(tex); node.replaceWith(' \\(' + tex + '\\) '); }
  }
  for (const image of shown.querySelectorAll('img')) image.replaceWith(image.alt || '');
  for (const block of shown.querySelectorAll('p,li,br,div,tr,h1,h2,h3,h4')) block.after('\n');
  const stem = (parts.some(part => part.html) ? shown.textContent : question.question || '').replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  for (const match of stem.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g)) {
    math.push(match.slice(1).find(Boolean) || '');
  }
  const topics = Object.keys(domains).filter(key => domains[key].test(stem));
  const symbols = new Set();
  const collect = source => {
    const clean = source.replace(/\\(?:text|operatorname|begin|end)\{[^}]*\}|\\[A-Za-z]+/g, ' ');
    for (const m of clean.matchAll(/(?<![a-zA-Z])([a-zA-Z])(?:\s*([_^])\s*(?:\{([a-zA-Z]{1,8}|\d{1,4})\}|([a-zA-Z]{1,8}|\d{1,4})))?(?![a-zA-Z])/g)) {
      symbols.add(m[2] ? m[1] + m[2] + '{' + (m[3] || m[4]) + '}' : m[1]);
    }
  };
  math.forEach(collect);
  for (const part of stem.matchAll(/(?<![A-Za-z])[A-Za-z](?![A-Za-z_^])/g)) symbols.add(part[0]);
  // Some imported, visible stems use plain text for variables and their scripts.
  for (const part of stem.matchAll(/(?<![A-Za-z])[A-Za-z]\s*[_^]\s*(?:\{[A-Za-z0-9]{1,8}\}|[A-Za-z0-9]{1,8})/g)) collect(part[0]);
  const dimensions = topics.includes('coordinates') ? /三维|空间直角|three.dimension|\b3d\b|[（(][^(),，]{1,7}[,，][^(),，]{1,7}[,，][^(),，]{1,7}[)）]/i.test(stem) ? 3 : 2 : 0;
  contexts.set(element, {stem, domains: topics, symbols: [...symbols].slice(0, 32), dimensions, style});
}

export function voiceContext(element) {
  const owner = element?.form || element?.closest('form, .questionCalculator, .questionWorkspace');
  return contexts.get(owner) || contexts.get(element) || contexts.get(element?.closest('.questionCalculator'));
}

export function dictationContext(target) {
  if (target.answer) return target.context;
  const value = target.value ?? target.field.value;
  const {from, to} = target;
  const range = target.readText ? target.readText() :
    {before: value.slice(0, from), selected: value.slice(from, to), after: value.slice(to)};
  const limit = 4096;
  // Keep the text nearest the cursor and both ends of a long replacement.
  const textbox = {before: range.before.slice(-limit), after: range.after.slice(0, limit),
    selected: range.selected.length <= limit ? range.selected :
      range.selected.slice(0, 2047) + '…' + range.selected.slice(-2048)};
  for (const key of Object.keys(textbox)) {
    textbox[key] = textbox[key].replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
  }
  return {...target.context, ...(target.math && {style: 'math'}),
    ...(Object.values(textbox).some(Boolean) && {textbox})};
}

export function inheritVoiceContext(element, owner) {
  const context = contexts.get(owner);
  if (context) contexts.set(element, context);
}
