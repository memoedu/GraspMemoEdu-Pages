import {assignableVariable, constants, expressionExtensions, functions, normalizeVariableName, operators, permitsConstant,
  permitsExtension, permitsKey, permitsModule, toolOperation}
  from './calculator-policy.js?v=b166183de20b7ca0';

export class CalculationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const ensure = (value, code = 'invalid') => {
  if (!value) throw new CalculationError(code);
};
const checkKey = (config, key, tier) => ensure(permitsKey(config, key, tier), 'restricted');
const core = () => import('./vendor/calculator/core.mjs?v=b166183de20b7ca0');
const advanced = () => import('./vendor/calculator/advanced.mjs?v=b166183de20b7ca0');
const applied = () => import('./vendor/calculator/applied.mjs?v=b166183de20b7ca0');
const symbolicEngine = () => import('./vendor/calculator/symbolic.mjs?v=b166183de20b7ca0');
const moduleLoaders = {
  integral: advanced, probability: advanced, statistics: advanced, modular: advanced, programmer: advanced,
  symbolic: symbolicEngine, machine_learning: applied, chemistry: applied, signal: applied,
  astronomy: applied, geography: applied, finance: applied, optimization: applied,
};

function inputText(value, limit = 4096) {
  ensure(typeof value === 'string' && value.trim() && value.length <= limit);
  return value.trim();
}

function checkNotation(source, config) {
  const tokens = source.matchAll(/[\p{L}_][\p{L}\p{M}\p{Nd}_₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[(),]/gu);
  for (const [token] of tokens) {
    if (token === '(' || token === ')' || token === ',') {
      checkKey(config, {'(': 'open', ')': 'close', ',': 'comma'}[token]);
    } else if (/^[.0-9]/.test(token)) {
      for (const digit of new Set(token.match(/\d/g))) checkKey(config, 'digit_' + digit);
      if (token.includes('.')) checkKey(config, 'decimal');
      if (/[eE]/.test(token)) checkKey(config, 'exponent_notation', 2);
    }
  }
}

const commonNotation = value => inputText(value, 1024).replaceAll('×', '*')
  .replaceAll('÷', '/').replaceAll('−', '-');

function storageExpression(input, config) {
  const text = commonNotation(input);
  const separator = text.indexOf('=');
  if (separator < 0) return {expression: text};
  checkKey(config, 'memory_registers');
  const register = normalizeVariableName(text.slice(0, separator));
  const expression = text.slice(separator + 1).trim();
  ensure(assignableVariable(register) && expression && !expression.includes('='), 'restricted');
  return {expression, register};
}

// Small arithmetic expressions are evaluated before the worker or math bundle is needed.
// Token, depth and permission limits mirror the existing expression engine.
export function calculateImmediate(input, config, memory = {}, answer) {
  if (!permitsModule(config, 'expression') || !permitsKey(config, 'evaluate')) return null;
  const {expression, register} = storageExpression(input, config);
  const tokens = [];
  const lexer = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|([\p{L}][\p{L}\p{M}\p{Nd}_₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*)|([+*/^()-]))\s*/guy;
  while (lexer.lastIndex < expression.length) {
    const next = lexer.exec(expression);
    if (!next || tokens.length >= 30) return null;
    if (next[2]) {
      const name = normalizeVariableName(next[2]);
      if (answerSymbols.has(name) && permitsKey(config, 'ans') && Number.isFinite(answer)) tokens.push(answer);
      else {
        if (!permitsKey(config, 'memory_registers') || !assignableVariable(name)
            || !Object.hasOwn(memory ?? {}, name) || !Number.isFinite(memory[name])) return null;
        tokens.push(memory[name]);
      }
    } else tokens.push(next[1] === undefined ? next[3] : Number(next[0]));
  }
  let cursor = 0, invalid = false;
  const used = new Set();
  function term() {
    const token = tokens[cursor++];
    let value;
    if (typeof token === 'number') {
      if (!Number.isFinite(token)) invalid = true;
      value = token;
    } else {
      used.add(token);
      if (token === '+') return term();
      if (token === '-') return -term();
      if (token !== '(') { invalid = true; return NaN; }
      value = sum();
      if (tokens[cursor++] !== ')') invalid = true;
    }
    if (tokens[cursor] === '^') {
      cursor++;
      used.add('^');
      const exponent = term();
      if (value < 0 && !Number.isInteger(exponent)) invalid = true;
      return value ** exponent;
    }
    return value;
  }
  function product() {
    let value = term();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++];
      used.add(operator);
      const right = term();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++];
      used.add(operator);
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const numeric = sum();
  if (invalid || cursor !== tokens.length) return null;
  checkNotation(expression, config);
  for (const operator of used) if (operator !== '(') checkKey(config, operators[operator]);
  ensure(Number.isFinite(numeric), 'domain');
  // Math.js rounds the shortest decimal representation at 14 significant digits.
  const [mantissa, exponent] = Math.abs(numeric).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const significant = Number(digits.slice(0, 14)) + Number(digits[14] >= '5');
  const rounded = digits.length <= 14 ? numeric
    : Math.sign(numeric) * Number(significant + 'e' + (Number(exponent) - 13));
  if (!Number.isFinite(rounded)) return null;
  const magnitude = Math.abs(rounded);
  const text = magnitude && (magnitude < 0.001 || magnitude >= 1e5) ? rounded.toExponential() : String(rounded);
  return {text, numeric, ...(register ? {register} : {})};
}

export function warmCalculator(module, expression = '') {
  const loaders = new Set([core]);
  if (Object.hasOwn(moduleLoaders, module)) loaders.add(moduleLoaders[module]);
  if (module === 'expression') {
    for (const [, functionName] of expression.matchAll(/\b([a-z][a-z_0-9]*)\s*\(/gi)) {
      const relatedModule = expressionExtensions.get(functionName)?.[0];
      if (Object.hasOwn(moduleLoaders, relatedModule)) loaders.add(moduleLoaders[relatedModule]);
    }
  }
  return Promise.all([...loaders].map(load => load()));
}
const answerSymbols = new Set(['Ans', 'ans', 'answer']);

function storedValue(math, value, config, extensions) {
  if (Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    ensure(extensions && levelsAllowArrays(config), 'restricted');
    return Array.isArray(value[0]) ? matrix(value) : list(value);
  }
  checkKey(config, 'complex', 2);
  ensure(Number.isFinite(value?.re) && Number.isFinite(value?.im), 'domain');
  return math.complex(value.re, value.im);
}

function expressionPlan(math, value, config, {variable, answer, degrees = false, symbolic = false, freeSymbols = false,
  extensions = false, names, bindings, memory = {}, expanding = []} = {}) {
  const subscriptDigits = '₀₁₂₃₄₅₆₇₈₉';
  const original = commonNotation(value).normalize('NFC').replace(/_\{([\p{L}\p{Nd}]+)\}/gu, '_$1');
  ensure(!original.includes('__gmeVar'), 'restricted');
  checkNotation(original, config);
  const rewritten = original.replace(
    /(?<![A-Za-z_])log(?:_(?:\{([^{}]+)\}|([A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?))|([₀-₉]+))\s*\(/g,
    (match, expression, simple, digits) => {
      if (extensions && simple && expressionExtensions.has('log_' + simple)) return match;
      const base = expression || simple || [...digits].map(digit => subscriptDigits.indexOf(digit)).join('');
      checkNotation(base, config);
      return 'logBase((' + base + '),';
    },
  );
  const aliases = new Map();
  const source = rewritten.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{M}\p{Nd}_₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*(?:_\{[\p{L}\p{Nd}]+\})?/gu, token => {
    if (token === 'π') return 'pi';
    if (/^[\d.]|^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return token;
    const name = normalizeVariableName(token);
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return name;
    if (symbolic) return token;
    const alias = '__gmeVar' + aliases.size;
    aliases.set(alias, name);
    return alias;
  });
  let remaining = 180;
  const compose = (args, apply) => extensions
    ? x => Promise.all(args.map(async read => read(x))).then(apply)
    : x => apply(args.map(read => read(x)));
  function compile(node, depth) {
    ensure(--remaining >= 0 && depth <= 32, 'limit');
    if (node.isParenthesisNode) return compile(node.content, depth + 1);
    if (node.isConstantNode) {
      ensure(Number.isFinite(node.value));
      return () => node.value;
    }
    if (node.isSymbolNode) {
      const name = aliases.get(node.name) ?? node.name;
      if (name === variable) return x => x;
      if (answerSymbols.has(name) && !symbolic) {
        checkKey(config, 'ans');
        ensure(answer != null);
        const value = storedValue(math, answer, config, extensions);
        return () => value;
      }
      if (name === 'i') {
        checkKey(config, 'complex', 2);
        return () => math.complex(0, 1);
      }
      if (!symbolic && permitsKey(config, 'memory_registers') && assignableVariable(name)
          && Object.hasOwn(memory ?? {}, name)) {
        const entry = memory[name];
        if (typeof entry?.expression === 'string') {
          ensure(expanding.length < 4 && !expanding.includes(name) && entry.expression.length <= 256, 'limit');
          return expressionPlan(math, entry.expression, config, {variable, answer, degrees, freeSymbols, extensions,
            names, bindings, memory, expanding: [...expanding, name]}).evaluate;
        }
        const stored = storedValue(math, entry, config, extensions);
        return () => stored;
      }
      if (freeSymbols && assignableVariable(name)) return () => undefined;
      if (names && assignableVariable(name)) {
        checkKey(config, 'assign_variables', 2);
        names.add(name);
        ensure(names.size <= 12, 'limit');
        return () => {
          ensure(bindings?.has(name), 'unassigned');
          return bindings.get(name);
        };
      }
      ensure(permitsConstant(config, name), 'restricted');
      ensure(!symbolic || ['pi', 'e'].includes(name), 'restricted');
      return () => constants[name][3];
    }
    if (node.isArrayNode && extensions && levelsAllowArrays(config)) {
      ensure(node.items.length > 0, 'domain');
      const args = node.items.map(child => compile(child, depth + 1));
      return compose(args, values => Array.isArray(values[0]) ? matrix(values) : list(values));
    }
    if (node.isOperatorNode) {
      ensure(Object.hasOwn(operators, node.op) && !node.isPercentage, 'restricted');
      checkKey(config, operators[node.op], node.op === '!' ? 2 : 1);
      const args = node.args.map(child => compile(child, depth + 1));
      return compose(args, values => {
        ensure(values.every(value => !Array.isArray(value)), 'domain');
        if (node.op === '!') ensure(Number.isInteger(values[0]) && values[0] >= 0 && values[0] <= 170, 'domain');
        return math[node.fn](...values);
      });
    }
    if (node.isFunctionNode && node.fn.isSymbolNode) {
      const name = node.fn.name;
      const extension = extensions && expressionExtensions.get(name);
      if (extension) {
        const [module, fields] = extension;
        ensure(permitsExtension(config, module, name), 'restricted');
        ensure(fields.length === node.args.length);
        const args = node.args.map(child => compile(child, depth + 1));
        return compose(args, values => runOperation(math, name,
          Object.fromEntries(fields.map(([field], index) => [field, values[index]])), config, {asExpression: true}));
      }
      const basedLog = name === 'logBase' || name === 'log' && node.args.length === 2;
      ensure(basedLog || Object.hasOwn(functions, name), 'restricted');
      const [key, tier, minimum, maximum = minimum] = basedLog ? ['log_base', 1, 2] : functions[name];
      checkKey(config, key, tier);
      ensure(node.args.length >= minimum && node.args.length <= maximum);
      const args = node.args.map(child => compile(child, depth + 1));
      const implementation = {ln: 'log', nCr: 'combinations', nPr: 'permutations'}[name] || name;
      return compose(args, values => {
        ensure(values.every(value => !Array.isArray(value)), 'domain');
        if (basedLog) {
          const [argument, base] = name === 'logBase' ? values.reverse() : values;
          ensure(Number.isFinite(base) && base > 0 && base !== 1, 'domain');
          return math.log(argument, base);
        }
        if (['factorial', 'combinations', 'permutations'].includes(implementation)) {
          ensure(values.every(a => Number.isInteger(a) && a >= 0 && a <= 170)
            && (values.length < 2 || values[0] >= values[1]), 'domain');
        }
        if (degrees && ['sin', 'cos', 'tan'].includes(name)) values[0] *= Math.PI / 180;
        const result = math[implementation](...values);
        return degrees && ['asin', 'acos', 'atan'].includes(name) ? result * 180 / Math.PI : result;
      });
    }
    throw new CalculationError('restricted');
  }
  const tree = math.parse(source);
  const evaluate = compile(tree, 0);
  if (symbolic && /\blogBase\s*\(/.test(source)) {
    tree.traverse(node => {
      if (node.isFunctionNode && node.fn.name === 'logBase') {
        node.fn.name = 'log';
        node.args.reverse();
      }
    });
    return {source: tree.toString(), evaluate};
  }
  return {source, evaluate};
}

const levelsAllowArrays = config => permitsModule(config, 'matrix') || permitsModule(config, 'machine_learning')
  || permitsModule(config, 'finance');

function numericText(value) {
  if (typeof value === 'number') {
    ensure(Number.isFinite(value), 'domain');
    return value;
  }
  const source = inputText(value, 96);
  ensure(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source));
  const result = Number(source);
  ensure(Number.isFinite(result), 'domain');
  return result;
}

function integer(value, minimum, maximum) {
  ensure(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'domain');
  return value;
}

const positive = value => {
  ensure(value > 0, 'domain');
  return value;
};

function list(value, maximum = 1024) {
  if (Array.isArray(value)) {
    ensure(value.length > 0 && value.length <= maximum && value.every(Number.isFinite), 'domain');
    return value;
  }
  const parts = inputText(value, 12000).split(/[,，\s]+/);
  ensure(parts.length <= maximum, 'limit');
  return parts.map(numericText);
}

function matrix(value) {
  const data = Array.isArray(value) ? value : JSON.parse(inputText(value, 12000));
  ensure(Array.isArray(data) && data.length > 0 && data.length <= 32 && Array.isArray(data[0]));
  const width = data[0].length;
  ensure(width > 0 && width <= 32 && data.every(row =>
    Array.isArray(row) && row.length === width && row.every(Number.isFinite)));
  return data;
}

const pairs = input => {
  const x = list(input.x), y = list(input.y);
  ensure(x.length === y.length);
  return [x, y];
};
const mean = x => x.reduce((sum, n) => sum + n / x.length, 0);

function formatted(math, value) {
  if (typeof value === 'number') {
    ensure(Number.isFinite(value), 'domain');
    return math.format(value, {precision: 14});
  }
  if (value?.isComplex) {
    ensure(Number.isFinite(value.re) && Number.isFinite(value.im), 'domain');
    return math.format(value, {precision: 14});
  }
  if (Array.isArray(value)) return '[' + value.map(item => formatted(math, item)).join(', ') + ']';
  return String(value);
}

function rows(...entries) {
  return {entries};
}

function modularPower(math, bigInteger, input, config) {
  const source = commonNotation(input.expression);
  const modulusText = inputText(input.modulus, 2048);
  ensure(/^[0-9]+$/.test(modulusText));
  checkNotation(source, config);
  checkNotation(modulusText, config);
  const modulus = BigInt(modulusText);
  ensure(modulus > 0n, 'domain');
  ensure(/^[\d()+*^\s-]+$/.test(source));
  const numbers = [];
  // Replace integer literals before the parser can round them to a Number.
  const tree = math.parse(source.replace(/\d+/g, value => 'n' + (numbers.push(BigInt(value)) - 1)));
  let budget = 200;
  function read(node, reduce, depth = 0) {
    ensure(--budget > 0 && depth <= 36, 'limit');
    if (node.isParenthesisNode) return read(node.content, reduce, depth + 1);
    if (node.isSymbolNode && /^n\d+$/.test(node.name)) {
      const value = numbers[Number(node.name.slice(1))];
      return reduce ? value % modulus : value;
    }
    ensure(node.isOperatorNode && ['+', '-', '*', '^'].includes(node.op), 'restricted');
    checkKey(config, operators[node.op]);
    const a = read(node.args[0], reduce, depth + 1);
    const b = node.args.length > 1 ? read(node.args[1], reduce && node.op !== '^', depth + 1) : null;
    let value;
    if (node.op === '^') {
      ensure(b >= 0n, 'domain');
      ensure(b.toString(2).length <= 8192, 'limit');
      if (reduce) return BigInt(bigInteger(a.toString()).modPow(b.toString(), modulusText).toString());
      ensure(b <= 8192n && BigInt(a.toString(2).length) * b <= 8192n, 'limit');
      value = a ** b;
    } else if (node.op === '*') value = a * b;
    else if (node.op === '-') value = b === null ? -a : a - b;
    else value = b === null ? a : a + b;
    if (reduce) return value % modulus;
    ensure(value.toString(2).length <= 8192, 'limit');
    return value;
  }
  return ((read(tree, true) % modulus + modulus) % modulus).toString();
}

function plot(evaluate, lower, upper) {
  const points = Array.from({length: 481}, (_, i) => {
    const x = lower + (upper - lower) * i / 480;
    try {
      const y = evaluate(x);
      return [x, Number.isFinite(y) ? y : null];
    } catch {
      return [x, null];
    }
  });
  ensure(points.some(([, y]) => y !== null), 'domain');
  return {plot: points};
}

function definiteIntegral(integrate, evaluate, lower, upper) {
  let calls = 0, converged = true;
  const previousWarn = console.warn;
  try {
    // The upstream library reports its recursion-limit status via console.warn.
    console.warn = () => { converged = false; };
    const value = integrate(x => {
      ensure(++calls <= 24000, 'limit');
      const y = evaluate(x);
      ensure(Number.isFinite(y), 'domain');
      return y;
    }, lower, upper, 1e-9, 18);
    ensure(converged, 'convergence');
    return value;
  } finally {
    console.warn = previousWarn;
  }
}

export async function storedExpression(source, config, name, memory) {
  checkKey(config, 'memory_registers');
  ensure(typeof source === 'string' && source.length <= 256 && !source.includes('='), 'restricted');
  const expression = source.trim();
  ensure(expression && assignableVariable(name), 'restricted');
  expressionPlan(await core(), expression, config, {freeSymbols: true, extensions: false,
    memory: {...memory, [name]: {expression}}, expanding: [name]});
  return {expression};
}

export async function calculate({config, module, operation, input = {}, degrees = false, answer, memory}) {
  ensure(permitsModule(config, module), 'restricted');
  if (module === 'expression' && operation === 'assign_variables') {
    checkKey(config, 'evaluate');
    checkKey(config, operation, 2);
    const names = new Set();
    const {expression} = storageExpression(input.expression, config);
    expressionPlan(await core(), expression, config, {degrees, answer, names, memory, extensions: true});
    return {variables: [...names]};
  }
  ensure(module === 'expression' && operation === 'evaluate' || toolOperation(module, operation), 'restricted');
  checkKey(config, operation);
  const storage = operation === 'evaluate' ? storageExpression(input.expression, config) : null;
  if (storage) {
    const immediate = calculateImmediate(input.expression, config, memory, answer);
    if (immediate) return immediate;
  }
  const [math] = await warmCalculator(module, input.expression);
  const context = {degrees, answer, memory};
  if (operation === 'evaluate') {
    const names = new Set(), bindings = new Map();
    const expression = expressionPlan(math, storage.expression, config, {...context, names, bindings, extensions: true});
    const supplied = input.assignments ?? {};
    ensure(typeof supplied === 'object' && !Array.isArray(supplied) && Object.keys(supplied).length <= 12);
    for (const name of names) {
      ensure(Object.hasOwn(supplied, name) && typeof supplied[name] === 'string' && supplied[name].trim(), 'unassigned');
      const assigned = await expressionPlan(math, supplied[name], config, {...context, extensions: true}).evaluate();
      ensure(Number.isFinite(assigned) || Array.isArray(assigned) || assigned?.isComplex, 'domain');
      if (assigned?.isComplex) storedValue(math, assigned, config, true);
      bindings.set(name, assigned);
    }
    const value = await expression.evaluate();
    if (value?.isComplex) checkKey(config, 'complex', 2);
    const text = formatted(math, value);
    const metadata = storage.register ? {register: storage.register} : {};
    if (value?.isComplex) return {text, complex: {re: value.re, im: value.im}, ...metadata};
    if (Array.isArray(value)) return {text, array: value, ...metadata};
    return {text, ...(Number.isFinite(value) ? {numeric: value} : {}), ...metadata};
  }
  const value = await runOperation(math, operation, input, config, context);
  if (value?.plot) return value;
  if (Array.isArray(value?.entries)) {
    const scalar = value.entries.length === 1 && value.entries[0][1];
    return Number.isFinite(scalar) ? {...value, numeric: scalar} : value;
  }
  if (operation === 'modular_power' && Number.isSafeInteger(Number(value))) return {text: value, numeric: Number(value)};
  const text = formatted(math, value);
  if (Array.isArray(value)) return {text, array: value};
  return {text, ...(Number.isFinite(value) ? {numeric: value} : {})};
}

async function runOperation(math, operation, input, config, context) {
  const n = name => numericText(input[name]);
  const numbers = () => list(input.x);
  const plan = flags => expressionPlan(math, input.expression, config, {...context, ...flags});
  let value;
  switch (operation) {
    case 'plot': {
      const lower = n('lower'), upper = n('upper');
      ensure(lower < upper && Number.isFinite(upper - lower), 'domain');
      return plot(plan({variable: 'x'}).evaluate, lower, upper);
    }
    case 'definite_integral': {
      const evaluate = plan({variable: 'x'}).evaluate;
      const lower = n('lower'), upper = n('upper');
      ensure(Number.isFinite(upper - lower), 'domain');
      value = lower === upper ? 0 : definiteIntegral((await advanced()).integrate, evaluate, lower, upper);
      break;
    }
    case 'matrix_multiply': value = math.multiply(matrix(input.a), matrix(input.b)); break;
    case 'determinant': value = math.det(matrix(input.a)); break;
    case 'transpose': value = math.transpose(matrix(input.a)); break;
    case 'matrix_inverse': value = math.inv(matrix(input.a)); break;
    case 'linear_system': {
      const vector = Array.isArray(input.b) ? input.b : inputText(input.b).replace(/^\[([^\[\]]+)\]$/, '$1');
      value = math.lusolve(matrix(input.a), list(vector, 32)).flat();
      break;
    }
    case 'normal_cdf': value = (await advanced()).normal.cdf(n('x'), n('mean'), positive(n('sd'))); break;
    case 'normal_quantile': value = (await advanced()).normal.quantile(n('p'), n('mean'), positive(n('sd'))); break;
    case 'binomial_pmf':
    case 'binomial_cdf': {
      const {binomial} = await advanced();
      const trials = integer(n('n'), 0, 1000000), x = integer(n('x'), -1000000, 1000000);
      value = binomial[operation === 'binomial_pmf' ? 'pmf' : 'cdf'](x, trials, n('p'));
      break;
    }
    case 'poisson_pmf':
      value = (await advanced()).poisson.pmf(integer(n('x'), 0, 1000000), positive(n('rate')));
      break;
    case 'student_t_cdf': value = (await advanced()).studentT.cdf(n('x'), positive(n('df'))); break;
    case 'describe': {
      const x = numbers();
      return rows(['n', x.length], ['mean', math.mean(x)], ['median', math.median(x)],
        ['population_sd', math.std(x, 'uncorrected')], ['min', Math.min(...x)], ['max', Math.max(...x)]);
    }
    case 'linear_regression': {
      const [x, y] = pairs(input);
      ensure(x.length >= 2 && x.some(a => a !== x[0]), 'domain');
      const {SimpleLinearRegression} = await advanced();
      const result = new SimpleLinearRegression(x, y);
      ensure(Number.isFinite(result.slope) && Number.isFinite(result.intercept), 'domain');
      return rows(['slope', result.slope], ['intercept', result.intercept],
        ['r2', y.every(a => a === y[0]) ? null : result.score(x, y).r2]);
    }
    case 'modular_power':
      value = modularPower(math, (await advanced()).bigInteger, input, config);
      break;
    case 'antiderivative':
    case 'solve':
    case 'differentiate':
    case 'simplify': {
      const variable = input.variable === undefined ? 'x' : inputText(input.variable, 12);
      ensure(/^[A-Za-z][A-Za-z_]*$/.test(variable) && assignableVariable(variable));
      const pieces = inputText(input.expression, 400).split('=');
      ensure(pieces.length === 1 || operation === 'solve' && pieces.length === 2);
      const text = pieces.map(piece => expressionPlan(math, piece, config, {
        variable, symbolic: true, freeSymbols: operation === 'simplify',
      }).source).join('=');
      const {nerdamer} = await symbolicEngine();
      const result = operation === 'antiderivative' ? nerdamer.integrate(text, variable, 0)
        : operation === 'differentiate' ? nerdamer.diff(text, variable)
        : operation === 'solve' ? nerdamer.solve(text, variable) : nerdamer.simplify(text);
      value = result?.toString();
      ensure(value && !/\b(?:integrate|solve)\(/i.test(value), 'unsupported');
      if (operation === 'antiderivative') value += ' + C';
      break;
    }
    default:
      return appliedCalculation(math, operation, input, n, context.asExpression);
  }
  return value;
}

async function appliedCalculation(math, operation, input, n, asExpression) {
  let value;
  switch (operation) {
    case 'sigmoid':
    case 'softplus':
    case 'relu': {
      const transform = operation === 'relu' ? x => Math.max(0, x) : (await applied())[operation];
      value = typeof input.x === 'number' ? transform(n('x')) : list(input.x).map(transform);
      break;
    }
    case 'softmax':
    case 'log_softmax':
    case 'cross_entropy': {
      const x = list(input.x);
      const largest = Math.max(...x), shifted = x.map(a => a - largest);
      const logSum = Math.log(shifted.reduce((sum, a) => sum + Math.exp(a), 0));
      const log = shifted.map(a => a - logSum);
      value = operation === 'softmax' ? log.map(Math.exp) : operation === 'log_softmax' ? log
        : -log[integer(n('label'), 1, x.length) - 1];
      break;
    }
    case 'mse': {
      const [x, y] = pairs(input);
      value = mean(x.map((a, i) => (a - y[i]) ** 2));
      break;
    }
    case 'cosine_similarity': {
      const [x, y] = pairs(input);
      const scaleX = positive(Math.max(...x.map(Math.abs)));
      const scaleY = positive(Math.max(...y.map(Math.abs)));
      const a = x.map(v => v / scaleX), b = y.map(v => v / scaleY);
      value = a.reduce((sum, v, i) => sum + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
      break;
    }
    case 'standardize':
    case 'min_max': {
      const x = list(input.x);
      const center = operation === 'standardize' ? mean(x) : Math.min(...x);
      const scale = operation === 'standardize'
        ? Math.sqrt(mean(x.map(a => (a - center) ** 2))) : Math.max(...x) - center;
      ensure(Number.isFinite(scale) && scale > 0, 'domain');
      value = x.map(a => (a - center) / scale);
      break;
    }
    case 'classification': {
      const {ConfusionMatrix} = await applied();
      const actual = inputText(input.a, 8000).split(/[,，\s]+/);
      const predicted = inputText(input.b, 8000).split(/[,，\s]+/);
      const labels = [...new Set([...actual, ...predicted])];
      ensure(actual.length === predicted.length && actual.length <= 1024 && labels.length <= 16);
      const cm = ConfusionMatrix.fromLabels(actual, predicted, {labels});
      return rows(['labels', labels], ['matrix', labels.map(a => labels.map(b => cm.getCount(a, b)))],
        ['accuracy', cm.getAccuracy()], ['precision', labels.map(x => cm.getPositivePredictiveValue(x))],
        ['recall', labels.map(x => cm.getTruePositiveRate(x))], ['f1', labels.map(x => cm.getF1Score(x))]);
    }
    case 'pca': {
      const {PCA} = await applied();
      const x = matrix(input.a);
      ensure(x.length > 1 && x.some(row => row.some((n, i) => n !== x[0][i])), 'domain');
      const pca = new PCA(x);
      return rows(['explained_variance', pca.getExplainedVariance()], ['scores', pca.predict(x).to2DArray()]);
    }
    case 'convert_units': value = math.unit(inputText(input.value, 120)).to(inputText(input.unit, 60)).format({precision: 13}); break;
    case 'ohms_law': {
      const current = n('voltage') / positive(n('resistance'));
      return asExpression ? current : rows(['current_a', current]);
    }
    case 'rc_time': {
      const time = positive(n('resistance')) * positive(n('capacitance'));
      return asExpression ? time : rows(['time_s', time]);
    }
    case 'ideal_gas': {
      const pressure = positive(n('amount')) * constants.R[3] * positive(n('temperature')) / positive(n('volume'));
      return asExpression ? pressure : rows(['pressure_pa', pressure]);
    }
    case 'balance': value = (await applied()).balance(inputText(input.expression, 260)).equation; break;
    case 'dilution': {
      const initial = positive(n('initial')), final = positive(n('final')), concentration = n('concentration');
      ensure(final >= initial && concentration >= 0, 'domain');
      value = concentration * (initial / final);
      break;
    }
    case 'fft': {
      const {FFT} = await applied();
      const x = list(input.x), rate = positive(n('rate'));
      ensure(x.length >= 2 && (x.length & (x.length - 1)) === 0, 'domain');
      const fft = new FFT(x.length), spectrum = fft.createComplexArray();
      fft.realTransform(spectrum, x);
      const bins = x.length / 2 + 1;
      return rows(['frequency_hz', Array.from({length: bins}, (_, i) => i * rate / x.length)],
        ['amplitude', Array.from({length: bins}, (_, i) =>
          Math.hypot(spectrum[2 * i], spectrum[2 * i + 1]) / x.length * (i === 0 || i === bins - 1 ? 1 : 2))]);
    }
    case 'base_convert': {
      const {bigInteger} = await advanced();
      const digits = inputText(input.value, 512), from = integer(n('from'), 2, 36), to = integer(n('to'), 2, 36);
      ensure(/^-?[A-Z0-9]+$/i.test(digits));
      value = bigInteger(digits.toLowerCase(), from).toString(to).toUpperCase();
      break;
    }
    case 'bit_and':
    case 'bit_xor': {
      const raw = [inputText(input.a, 512), inputText(input.b, 512)];
      ensure(raw.every(x => /^-?\d+$/.test(x)));
      const [a, b] = raw.map(BigInt);
      value = (operation === 'bit_and' ? a & b : a ^ b).toString();
      break;
    }
    case 'moon_phase': {
      const day = inputText(input.date, 10);
      ensure(/^\d{4}-\d{2}-\d{2}$/.test(day));
      const date = new Date(day + 'T00:00:00Z');
      ensure(Number.isFinite(date.valueOf()) && date.toISOString().startsWith(day));
      return rows(['degrees', (await applied()).MoonPhase(date)]);
    }
    case 'geodesic': {
      const lat1 = n('lat1'), lat2 = n('lat2'), lon1 = n('lon1'), lon2 = n('lon2');
      ensure(Math.abs(lat1) <= 90 && Math.abs(lat2) <= 90 && Math.abs(lon1) <= 180 && Math.abs(lon2) <= 180);
      const answer = (await applied()).geodesic.Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2);
      return rows(['distance_m', answer.s12], ['bearing_deg', answer.azi1]);
    }
    case 'future_value': {
      const rate = n('rate');
      ensure(rate > -1, 'domain');
      value = (await applied()).FV(rate, integer(n('periods'), 0, 1000000), 0, -n('present'));
      break;
    }
    case 'net_present_value': {
      const rate = n('rate'), [initial, ...later] = list(input.x, 200);
      ensure(rate > -1, 'domain');
      value = later.length ? initial + (await applied()).NPV(rate, later) : initial;
      break;
    }
    case 'internal_rate': {
      const x = list(input.x, 200);
      ensure(x.some(a => a < 0) && x.some(a => a > 0), 'domain');
      value = (await applied()).IRR(x);
      ensure(Number.isFinite(value) && value > -1, 'convergence');
      const residual = x.reduce((sum, cash, i) => sum + cash / (1 + value) ** i, 0);
      ensure(Math.abs(residual) <= Math.max(...x.map(Math.abs)) * 1e-7, 'convergence');
      break;
    }
    case 'linear_program': {
      const model = JSON.parse(inputText(input.model, 8000));
      ensure(model && typeof model === 'object' && Object.keys(model).every(key =>
        ['optimize', 'opType', 'constraints', 'variables'].includes(key))
        && /^[a-z][a-z0-9_]{0,24}$/i.test(model.optimize)
        && ['max', 'min'].includes(model.opType));
      const safeName = key => /^[a-z][a-z0-9_]{0,24}$/i.test(key) && !Object.hasOwn(Object.prototype, key);
      for (const group of [model.variables, model.constraints]) {
        ensure(group && !Array.isArray(group) && typeof group === 'object'
          && Object.keys(group).length > 0 && Object.keys(group).length <= 24);
        ensure(Object.entries(group).every(([key, row]) => safeName(key) && row && !Array.isArray(row)
          && Object.keys(row).length > 0 && Object.entries(row).every(([name, value]) =>
            safeName(name) && Number.isFinite(value))));
      }
      ensure(safeName(model.optimize));
      const result = (await applied()).solver.Solve(model);
      ensure(result.feasible && result.bounded, 'domain');
      return rows(...Object.entries(result).filter(([, number]) => Number.isFinite(number)));
    }
    case 'diversity': {
      const x = list(input.x).map(a => integer(a, 0, Number.MAX_SAFE_INTEGER));
      const total = positive(math.sum(x));
      const proportions = x.filter(Boolean).map(n => n / total);
      return rows(['richness', proportions.length], ['shannon', -math.sum(proportions.map(p => p * Math.log(p)))],
        ['simpson', 1 - math.sum(proportions.map(p => p * p))]);
    }
    default: throw new CalculationError('restricted');
  }
  return value;
}
