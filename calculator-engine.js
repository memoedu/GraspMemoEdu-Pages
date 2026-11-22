import {constants, functions, operators, permitsConstant, permitsKey, permitsModule, toolOperation}
  from './calculator-policy.js?v=3b98cafe4a000f31';

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
const core = () => import('./vendor/calculator/core.mjs?v=3b98cafe4a000f31');
const advanced = () => import('./vendor/calculator/advanced.mjs?v=3b98cafe4a000f31');
const applied = () => import('./vendor/calculator/applied.mjs?v=3b98cafe4a000f31');

function inputText(value, limit = 4096) {
  ensure(typeof value === 'string' && value.trim() && value.length <= limit);
  return value.trim();
}

function checkNotation(source, config) {
  const tokens = source.matchAll(/[A-Za-z_][A-Za-z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[(),]/g);
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

const commonNotation = value => inputText(value, 1024).replaceAll('π', 'pi').replaceAll('×', '*')
  .replaceAll('÷', '/').replaceAll('−', '-');

const reservedSymbols = new Set(['ans', 'i', 'Infinity', 'NaN', 'true', 'false', 'null', 'undefined']);
const assignable = name => /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(name) && !reservedSymbols.has(name)
  && !Object.hasOwn(constants, name) && !Object.hasOwn(functions, name);

function expressionPlan(math, value, config, {variable, answer, degrees = false, symbolic = false, names, bindings} = {}) {
  const source = commonNotation(value);
  checkNotation(source, config);
  let remaining = 180;
  function compile(node, depth) {
    ensure(--remaining >= 0 && depth <= 32, 'limit');
    if (node.isParenthesisNode) return compile(node.content, depth + 1);
    if (node.isConstantNode) {
      ensure(Number.isFinite(node.value));
      return () => node.value;
    }
    if (node.isSymbolNode) {
      if (node.name === variable) return x => x;
      if (node.name === 'ans' && !symbolic) {
        checkKey(config, 'ans');
        ensure(Number.isFinite(answer));
        return () => answer;
      }
      if (node.name === 'i') {
        checkKey(config, 'complex', 2);
        return () => math.complex(0, 1);
      }
      if (names && assignable(node.name)) {
        checkKey(config, 'assign_variables', 2);
        names.add(node.name);
        ensure(names.size <= 12, 'limit');
        return () => {
          ensure(bindings?.has(node.name), 'unassigned');
          return bindings.get(node.name);
        };
      }
      ensure(permitsConstant(config, node.name), 'restricted');
      ensure(!symbolic || ['pi', 'e'].includes(node.name), 'restricted');
      return () => constants[node.name][3];
    }
    if (node.isOperatorNode) {
      ensure(Object.hasOwn(operators, node.op) && !node.isPercentage, 'restricted');
      checkKey(config, operators[node.op], node.op === '!' ? 2 : 1);
      const args = node.args.map(child => compile(child, depth + 1));
      return x => {
        const values = args.map(read => read(x));
        if (node.op === '!') ensure(Number.isInteger(values[0]) && values[0] >= 0 && values[0] <= 170, 'domain');
        return math[node.fn](...values);
      };
    }
    if (node.isFunctionNode && node.fn.isSymbolNode) {
      const name = node.fn.name;
      ensure(Object.hasOwn(functions, name), 'restricted');
      const [key, tier, minimum, maximum = minimum] = functions[name];
      checkKey(config, key, tier);
      ensure(node.args.length >= minimum && node.args.length <= maximum);
      const args = node.args.map(child => compile(child, depth + 1));
      const implementation = {ln: 'log', nCr: 'combinations', nPr: 'permutations'}[name] || name;
      return x => {
        const values = args.map(read => read(x));
        if (['factorial', 'combinations', 'permutations'].includes(implementation)) {
          ensure(values.every(a => Number.isInteger(a) && a >= 0 && a <= 170)
            && (values.length < 2 || values[0] >= values[1]), 'domain');
        }
        if (degrees && ['sin', 'cos', 'tan'].includes(name)) values[0] *= Math.PI / 180;
        const result = math[implementation](...values);
        return degrees && ['asin', 'acos', 'atan'].includes(name) ? result * 180 / Math.PI : result;
      };
    }
    throw new CalculationError('restricted');
  }
  const evaluate = compile(math.parse(source), 0);
  return {source, evaluate};
}

function numericText(value) {
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
  const parts = inputText(value, 12000).split(/[,，\s]+/);
  ensure(parts.length <= maximum, 'limit');
  return parts.map(numericText);
}

function matrix(value) {
  const data = JSON.parse(inputText(value, 12000));
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

export async function calculate({config, module, operation, input = {}, degrees = false, answer}) {
  ensure(permitsModule(config, module), 'restricted');
  if (module === 'expression' && operation === 'assign_variables') {
    checkKey(config, 'evaluate');
    checkKey(config, operation, 2);
    const names = new Set();
    expressionPlan(await core(), input.expression, config, {degrees, answer, names});
    return {variables: [...names]};
  }
  ensure(module === 'expression' && operation === 'evaluate' || toolOperation(module, operation), 'restricted');
  checkKey(config, operation);
  const math = await core();
  const n = name => numericText(input[name]);
  const numbers = () => list(input.x);
  const plan = flags => expressionPlan(math, input.expression, config, {degrees, answer, ...flags});
  let value;
  switch (operation) {
    case 'evaluate': {
      const names = new Set(), bindings = new Map();
      const expression = plan({names, bindings});
      const supplied = input.assignments ?? {};
      ensure(typeof supplied === 'object' && !Array.isArray(supplied) && Object.keys(supplied).length <= 12);
      for (const name of names) {
        ensure(Object.hasOwn(supplied, name) && typeof supplied[name] === 'string' && supplied[name].trim(), 'unassigned');
        const assigned = expressionPlan(math, supplied[name], config, {degrees, answer}).evaluate();
        ensure(Number.isFinite(assigned) || assigned?.isComplex && Number.isFinite(assigned.re) && Number.isFinite(assigned.im), 'domain');
        if (assigned?.isComplex) checkKey(config, 'complex', 2);
        bindings.set(name, assigned);
      }
      value = expression.evaluate();
      if (value?.isComplex) checkKey(config, 'complex', 2);
      return {text: formatted(math, value), ...(Number.isFinite(value) ? {numeric: value} : {})};
    }
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
      const vector = inputText(input.b).replace(/^\[([^\[\]]+)\]$/, '$1');
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
      ensure(/^[A-Za-z][A-Za-z_]*$/.test(variable) && !Object.hasOwn(constants, variable)
        && variable !== 'i' && variable !== 'ans');
      const pieces = inputText(input.expression, 400).split('=');
      ensure(pieces.length === 1 || operation === 'solve' && pieces.length === 2);
      const text = pieces.map(piece => expressionPlan(math, piece, config, {variable, symbolic: true}).source).join('=');
      const {nerdamer} = await import('./vendor/calculator/symbolic.mjs?v=3b98cafe4a000f31');
      const result = operation === 'antiderivative' ? nerdamer.integrate(text, variable, 0)
        : operation === 'differentiate' ? nerdamer.diff(text, variable)
        : operation === 'solve' ? nerdamer.solve(text, variable) : nerdamer.simplify(text);
      value = result?.toString();
      ensure(value && !/\b(?:integrate|solve)\(/i.test(value), 'unsupported');
      if (operation === 'antiderivative') value += ' + C';
      break;
    }
    default:
      return appliedCalculation(math, operation, input, n);
  }
  return {text: formatted(math, value)};
}

async function appliedCalculation(math, operation, input, n) {
  let value;
  switch (operation) {
    case 'sigmoid':
    case 'softplus':
    case 'relu': {
      const x = list(input.x);
      const transform = operation === 'relu' ? x => Math.max(0, x) : (await applied())[operation];
      value = x.map(transform);
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
    case 'ohms_law': return rows(['current_a', n('voltage') / positive(n('resistance'))]);
    case 'rc_time': return rows(['time_s', positive(n('resistance')) * positive(n('capacitance'))]);
    case 'ideal_gas': return rows(['pressure_pa', positive(n('amount')) * constants.R[3] * positive(n('temperature')) / positive(n('volume'))]);
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
  return {text: formatted(math, value)};
}
