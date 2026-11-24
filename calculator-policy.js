export const levels = ['none', 'basic', 'scientific', 'advanced', 'cas'];
export const memoryRegisters = ['A', 'B', 'C', 'D', 'E', 'F'];
const subscripts = '₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ';
const plainSubscripts = '0123456789aehijklmnoprstuvx';
const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const reserved = new Set(['Ans', 'ans', 'answer', 'i', 'Infinity', 'NaN', 'true', 'false', 'null', 'undefined', 'logBase']);

export function normalizeVariableName(name) {
  return name.trim().normalize('NFC')
    .replace(/_\{([\p{L}\p{Nd}]+)\}/gu, '_$1')
    .replace(/[₀-₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+/gu, value => '_' + [...value].map(char => plainSubscripts[subscripts.indexOf(char)]).join(''))
    .replace(/\^(?:\{(\d+)\}|(\d+))$/u, (_, grouped, digits) => [...(grouped || digits)].map(digit => superscripts[digit]).join(''));
}

export function assignableVariable(name) {
  return /^[\p{L}][\p{L}\p{M}\p{Nd}_⁰¹²³⁴⁵⁶⁷⁸⁹]{0,23}$/u.test(name) && name !== 'π'
    && !reserved.has(name) && (!Object.hasOwn(constants, name) || name === 'G') && !Object.hasOwn(functions, name);
}

const baseModules = ['expression'];
const scientificModules = ['constants'];
const advancedModules = ['graph', 'integral', 'matrix', 'probability', 'statistics'];
const optionalModules = ['modular', 'machine_learning', 'physics', 'chemistry', 'signal', 'programmer',
  'astronomy', 'geography', 'finance', 'optimization', 'ecology'];

export function permitsModule(config, module) {
  const tier = levels.indexOf(config?.level);
  if (tier < 1 || config.disable_modules?.includes(module)) return false;
  return baseModules.includes(module)
    || tier >= 2 && scientificModules.includes(module)
    || tier >= 2 && module === 'graph' && config.enable_modules?.includes(module)
    || tier >= 3 && advancedModules.includes(module)
    || tier >= 3 && optionalModules.includes(module) && config.enable_modules?.includes(module)
    || tier === 4 && module === 'symbolic';
}

export function permitsKey(config, key, tier = 1) {
  return levels.indexOf(config?.level) >= tier && !config.disable_keys?.includes(key);
}

export const permitsCustomFunctions = config => permitsKey(config, 'memory_registers')
  && permitsKey(config, 'define_function', 2) && permitsKey(config, 'open') && permitsKey(config, 'close');

export const constants = {
  pi: ['π', '圆周率', 'Pi', Math.PI, ''],
  e: ['e', '欧拉数', 'Euler’s number', Math.E, ''],
  c: ['c', '真空光速', 'Speed of light', 299792458, 'm/s'],
  h: ['h', '普朗克常数', 'Planck constant', 6.62607015e-34, 'J·s'],
  hbar: ['ℏ', '约化普朗克常数', 'Reduced Planck constant', 1.054571817e-34, 'J·s'],
  g0: ['g₀', '标准重力加速度', 'Standard gravity', 9.80665, 'm/s²'],
  G: ['G', '万有引力常数', 'Gravitational constant', 6.67430e-11, 'm³/(kg·s²)'],
  k_B: ['kᵦ', '玻尔兹曼常数', 'Boltzmann constant', 1.380649e-23, 'J/K'],
  N_A: ['Nₐ', '阿伏伽德罗常数', 'Avogadro constant', 6.02214076e23, 'mol⁻¹'],
  q_e: ['e₀', '元电荷', 'Elementary charge', 1.602176634e-19, 'C'],
  R: ['R', '摩尔气体常数', 'Molar gas constant', 8.31446261815324, 'J/(mol·K)'],
};

export function permitsConstant(config, key) {
  return Object.hasOwn(constants, key) && permitsKey(config, 'constant_' + key.toLowerCase(),
    key === 'pi' || key === 'e' ? 1 : 2)
    && (key === 'pi' || key === 'e' || permitsModule(config, 'constants'));
}

export const operators = {
  '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '^': 'power', '!': 'factorial',
};

export const functions = {
  log: ['ln', 1, 1, 2], log10: ['log10', 1, 1], ln: ['ln', 1, 1], sqrt: ['sqrt', 1, 1],
  abs: ['abs', 1, 1], exp: ['exp', 2, 1], cbrt: ['cbrt', 2, 1],
  sin: ['sin', 2, 1], cos: ['cos', 2, 1], tan: ['tan', 2, 1],
  asin: ['asin', 2, 1], acos: ['acos', 2, 1], atan: ['atan', 2, 1],
  sinh: ['sinh', 2, 1], cosh: ['cosh', 2, 1], tanh: ['tanh', 2, 1],
  floor: ['floor', 2, 1], ceil: ['ceil', 2, 1], round: ['round', 2, 1, 2],
  factorial: ['factorial', 2, 1], nCr: ['combinations', 2, 2], nPr: ['permutations', 2, 2],
  combinations: ['combinations', 2, 2], permutations: ['permutations', 2, 2],
};

export const keypad = [
  ['digit_7', '7', '7'], ['digit_8', '8', '8'], ['digit_9', '9', '9'], ['divide', '÷', '/'], ['clear', 'AC', ''],
  ['digit_4', '4', '4'], ['digit_5', '5', '5'], ['digit_6', '6', '6'], ['multiply', '×', '*'], ['ans', 'Ans', 'ans'],
  ['digit_1', '1', '1'], ['digit_2', '2', '2'], ['digit_3', '3', '3'], ['subtract', '−', '-'], ['comma', ',', ','],
  ['digit_0', '0', '0'], ['decimal', '.', '.'], ['exponent_notation', 'EXP', 'E', 2], ['add', '+', '+'], ['evaluate', '=', ''],
  ['open', '(', '('], ['close', ')', ')'], ['constant_pi', 'π', 'pi'], ['constant_e', 'e', 'e'], ['backspace', '⌫', ''],
  ['sqrt', '√', 'sqrt('], ['power', 'xʸ', '^'], ['ln', 'ln', 'ln('], ['log10', 'log₁₀', 'log10('], ['abs', '|x|', 'abs('],
  ['sin', 'sin', 'sin(', 2], ['cos', 'cos', 'cos(', 2], ['tan', 'tan', 'tan(', 2], ['exp', 'exp', 'exp(', 2], ['factorial', 'x!', '!', 2],
  ['asin', 'sin⁻¹', 'asin(', 2], ['acos', 'cos⁻¹', 'acos(', 2], ['atan', 'tan⁻¹', 'atan(', 2], ['combinations', 'nCr', 'nCr(', 2], ['permutations', 'nPr', 'nPr(', 2],
];

export const basedLogKey = ['log_base', 'logₐ', 'log_'];

export const permitsBasedLog = config => permitsKey(config, basedLogKey[0]) &&
  permitsKey(config, 'open') && permitsKey(config, 'close');

export function keyCompletions(keys, config) {
  const aliases = {'*': '×', '/': '÷', '-': '−', 'sqrt(': '√', 'log_': 'logₐ'};
  return keys.flatMap(([id, , value, tier]) => permitsKey(config, id, tier) && value
    ? [{label: value.replace(/\($/, '') || value, value, keys: aliases[value] ? [value, aliases[value]] : [value]}] : []);
}

export function expressionCompletions(config = {level: 'scientific'}, {previousAnswer = true, variable, equation, extensions = false} = {}) {
  const entries = Object.entries(functions).flatMap(([name, [id, tier]]) =>
    permitsKey(config, id, tier) && permitsKey(config, 'open') ? [{label: name, value: name + '('}] : []);
  const allowedKeys = keypad.filter(([id, , insertion]) => !id.startsWith('constant_')
    && (id !== 'ans' || previousAnswer) && (!insertion.endsWith('(') || permitsKey(config, 'open')));
  if (permitsBasedLog(config)) allowedKeys.push(basedLogKey);
  entries.push(...keyCompletions(allowedKeys, config));
  for (const [name, [label]] of Object.entries(constants)) {
    if (permitsConstant(config, name)) entries.push({label: name === label ? label : name + ' · ' + label, value: name, keys: [name, label]});
  }
  if (previousAnswer && permitsKey(config, 'ans')) entries.push({label: 'answer', value: 'answer'});
  if (permitsKey(config, 'complex', 2) && !variable) entries.push({label: 'i', value: 'i'});
  if (variable) entries.push({label: variable, value: variable});
  if (equation) entries.push({label: '=', value: '='});
  if (extensions) {
    for (const [name, [module]] of expressionExtensions) {
      if (permitsExtension(config, module, name)) entries.push({label: name, value: name + '('});
    }
  }
  const unique = new Map();
  for (const entry of entries) {
    const first = unique.get(entry.value);
    if (!first) unique.set(entry.value, entry);
    else first.keys = [...(first.keys || [first.label, first.value]), ...(entry.keys || [entry.label, entry.value])];
  }
  return [...unique.values()];
}

// The same catalog drives navigation, input forms, and worker authorization.
export const tools = [
  ['graph', '函数绘图', 'Graph', [['plot', '绘制 y=f(x)', 'Plot y=f(x)', [
    ['expression', '函数 f(x)', 'Function f(x)', 'sin(x)'], ['lower', 'x 最小值', 'x minimum', '-10'], ['upper', 'x 最大值', 'x maximum', '10']]]]],
  ['integral', '数值积分', 'Integral', [['definite_integral', '定积分', 'Definite integral', [
    ['expression', '被积函数 f(x)', 'Integrand f(x)', 'x^2'], ['lower', '下限', 'Lower bound', '0'], ['upper', '上限', 'Upper bound', '1']]]]],
  ['matrix', '矩阵', 'Matrices', [
    ['matrix_multiply', '矩阵乘法 A·B', 'Multiply A·B', [['a', '矩阵 A', 'Matrix A', '[[1,2],[3,4]]'], ['b', '矩阵 B', 'Matrix B', '[[2,0],[0,2]]']]],
    ['determinant', '行列式', 'Determinant', [['a', '矩阵 A', 'Matrix A', '[[1,2],[3,4]]']]],
    ['transpose', '转置', 'Transpose', [['a', '矩阵 A', 'Matrix A', '[[1,2],[3,4]]']]],
    ['matrix_inverse', '逆矩阵', 'Inverse matrix', [['a', '矩阵 A', 'Matrix A', '[[1,2],[3,4]]']]],
    ['linear_system', '线性方程组 Ax=b', 'Linear system Ax=b', [['a', '矩阵 A', 'Matrix A', '[[1,2],[3,4]]'], ['b', '向量 b', 'Vector b', '[5,11]']]],
  ]],
  ['probability', '概率分布', 'Probability', [
    ['normal_cdf', '正态累计概率', 'Normal CDF', [['x', 'x', 'x', '1.96'], ['mean', '均值 μ', 'Mean μ', '0'], ['sd', '标准差 σ', 'Standard deviation σ', '1']]],
    ['normal_quantile', '正态分位数', 'Normal quantile', [['p', '概率 p', 'Probability p', '0.975'], ['mean', '均值 μ', 'Mean μ', '0'], ['sd', '标准差 σ', 'Standard deviation σ', '1']]],
    ['binomial_pmf', '二项点概率', 'Binomial PMF', [['x', '成功次数 k', 'Successes k', '3'], ['n', '试验次数 n', 'Number of trials n', '10'], ['p', '单次成功概率 p', 'Success probability p', '0.5']]],
    ['binomial_cdf', '二项累计概率', 'Binomial CDF', [['x', '成功次数 k', 'Successes k', '3'], ['n', '试验次数 n', 'Number of trials n', '10'], ['p', '单次成功概率 p', 'Success probability p', '0.5']]],
    ['poisson_pmf', '泊松点概率', 'Poisson PMF', [['x', '次数 k', 'Count k', '2'], ['rate', '均值 λ', 'Rate λ', '3']]],
    ['student_t_cdf', 'Student t 累计概率', 'Student t CDF', [['x', 't 值', 't value', '2'], ['df', '自由度', 'Degrees of freedom', '12']]],
  ]],
  ['statistics', '统计与回归', 'Statistics', [
    ['describe', '描述统计', 'Descriptive statistics', [['x', '数据', 'Data', '1,2,3,4']]],
    ['linear_regression', '一元线性回归', 'Linear regression', [['x', '自变量 x', 'Predictors x', '1,2,3'], ['y', '因变量 y', 'Responses y', '2,4,6']]],
  ]],
  ['modular', '精确模幂', 'Modular powers', [['modular_power', '计算余数', 'Compute remainder', [
    ['expression', '整数幂表达式', 'Integer power expression', '(-7)^12345678901234567890'], ['modulus', '正整数模数', 'Positive modulus', '101']]]]],
  ['symbolic', '符号运算', 'CAS', [
    ['antiderivative', '不定积分', 'Antiderivative', [['expression', '被积函数', 'Integrand', 'x^2'], ['variable', '变量', 'Variable', 'x']]],
    ['solve', '解方程', 'Solve equation', [['expression', '方程', 'Equation', 'x^2=2'], ['variable', '变量', 'Variable', 'x']]],
    ['differentiate', '求导', 'Differentiate', [['expression', '函数', 'Function', 'x^3'], ['variable', '变量', 'Variable', 'x']]],
    ['simplify', '化简', 'Simplify', [['expression', '表达式', 'Expression', '(x+1)^2-x^2']]],
  ]],
];

const vector = (id, zh, en, example) => [id, zh, en, example];
const logits = vector('x', '输入值 / logits', 'Inputs / logits', '1000,1001,1002');
const pair = [vector('x', '向量 x', 'Vector x', '1,2,3'), vector('y', '向量 y', 'Vector y', '3,2,1')];
tools.push(
  ['machine_learning', '机器学习', 'Machine learning', [
    ['sigmoid', 'Sigmoid', 'Sigmoid', [logits]], ['softplus', 'Softplus', 'Softplus', [logits]],
    ['relu', 'ReLU', 'ReLU', [logits]], ['softmax', 'Softmax', 'Softmax', [logits]],
    ['log_softmax', 'Log-Softmax', 'Log-Softmax', [logits]],
    ['cross_entropy', '交叉熵（logits）', 'Cross-entropy (logits)', [logits, ['label', '正确类别（从 1 开始）', 'Target class (1-based)', '3']]],
    ['mse', '均方误差', 'Mean squared error', pair], ['cosine_similarity', '余弦相似度', 'Cosine similarity', pair],
    ['standardize', 'Z-score 标准化', 'Z-score scaling', [pair[0]]], ['min_max', 'Min–Max 归一化', 'Min–max scaling', [pair[0]]],
    ['classification', '分类指标', 'Classification metrics', [['a', '真实标签', 'Actual labels', 'cat,dog,cat'], ['b', '预测标签', 'Predicted labels', 'cat,cat,cat']]],
    ['pca', '主成分分析', 'Principal component analysis', [['a', '样本矩阵（每行一个样本）', 'Sample matrix (one row per sample)', '[[1,3],[2,4],[3,5]]']]],
  ]],
  ['physics', '物理与工程', 'Physics and engineering', [
    ['convert_units', '单位换算', 'Convert units', [['value', '带单位的数值', 'Quantity with unit', '9.8 m/s^2'], ['unit', '目标单位', 'Target unit', 'cm/s^2']]],
    ['ohms_law', '欧姆定律', 'Ohm’s law', [['voltage', '电压 (V)', 'Voltage (V)', '12'], ['resistance', '电阻 (Ω)', 'Resistance (Ω)', '4']]],
    ['rc_time', 'RC 时间常数', 'RC time constant', [['resistance', '电阻 (Ω)', 'Resistance (Ω)', '10000'], ['capacitance', '电容 (F)', 'Capacitance (F)', '0.0001']]],
    ['ideal_gas', '理想气体压强', 'Ideal gas pressure', [['amount', '物质的量 (mol)', 'Amount (mol)', '1'], ['temperature', '温度 (K)', 'Temperature (K)', '273.15'], ['volume', '体积 (m³)', 'Volume (m³)', '0.0224']]],
  ]],
  ['chemistry', '化学', 'Chemistry', [
    ['balance', '化学方程式配平', 'Balance equation', [['expression', '反应式', 'Reaction', 'Fe + O2 -> Fe2O3']]],
    ['dilution', '稀释浓度', 'Diluted concentration', [['concentration', '初始浓度 (mol/L)', 'Initial concentration (mol/L)', '1'], ['initial', '初始体积 (L)', 'Initial volume (L)', '0.1'], ['final', '稀释后体积 (L)', 'Final volume (L)', '0.25']]],
  ]],
  ['signal', '信号与频谱', 'Signal and spectrum', [['fft', '实数 FFT', 'Real FFT', [['x', '等间隔采样值（长度为 2 的幂）', 'Equally spaced samples (power-of-two length)', '0,1,0,-1'], ['rate', '采样率 (Hz)', 'Sample rate (Hz)', '4']]]]],
  ['programmer', '进制与位运算', 'Bases and bits', [
    ['base_convert', '进制转换', 'Convert base', [['value', '整数', 'Integer', 'FF'], ['from', '原进制', 'Input base', '16'], ['to', '输出进制', 'Output base', '2']]],
    ['bit_and', '位与', 'Bitwise AND', [['a', '十进制整数 A', 'Decimal integer A', '12'], ['b', '十进制整数 B', 'Decimal integer B', '10']]],
    ['bit_xor', '位异或', 'Bitwise XOR', [['a', '十进制整数 A', 'Decimal integer A', '12'], ['b', '十进制整数 B', 'Decimal integer B', '10']]],
  ]],
  ['astronomy', '天文', 'Astronomy', [['moon_phase', '月相角', 'Lunar phase angle', [['date', 'UTC 日期', 'UTC date', '2026-11-22']]]]],
  ['geography', '地理', 'Geography', [['geodesic', '椭球测地距离', 'Ellipsoidal geodesic distance', [
    ['lat1', '起点纬度 (°)', 'Start latitude (°)', '22.55'], ['lon1', '起点经度 (°)', 'Start longitude (°)', '114.05'],
    ['lat2', '终点纬度 (°)', 'End latitude (°)', '39.90'], ['lon2', '终点经度 (°)', 'End longitude (°)', '116.40']]]]],
  ['finance', '金融数学', 'Financial mathematics', [
    ['future_value', '复利终值', 'Future value', [['rate', '每期利率（小数）', 'Rate per period (decimal)', '0.03'], ['periods', '期数', 'Periods', '5'], ['present', '本金', 'Principal', '1000']]],
    ['net_present_value', '净现值（含第 0 期）', 'Net present value (including period 0)', [['rate', '每期利率（小数）', 'Rate per period (decimal)', '0.05'], ['x', '现金流', 'Cash flows', '-100,40,50,60']]],
    ['internal_rate', '内部收益率', 'Internal rate of return', [['x', '现金流', 'Cash flows', '-100,40,50,60']]],
  ]],
  ['optimization', '运筹优化', 'Optimization', [['linear_program', '线性规划', 'Linear program', [[
    'model', '模型', 'Model', '{"optimize":"profit","opType":"max","constraints":{"capacity":{"max":100}},"variables":{"x":{"capacity":10,"profit":5}}}']]]]],
  ['ecology', '群落统计', 'Community ecology', [['diversity', '群落多样性', 'Community diversity', [['x', '各类群数量', 'Category abundances', '4,3,2,1']]]]],
);

export function toolOperation(module, operation) {
  return tools.find(spec => spec[0] === module)?.[3].find(item => item[0] === operation);
}

// Numeric operations accept normal expression arguments in the same order as the worksheet fields.
const callableOperations = {
  matrix_multiply: ['matrix', 'matrix'], determinant: ['matrix'], transpose: ['matrix'],
  matrix_inverse: ['matrix'], linear_system: ['matrix', 'vector'],
  normal_cdf: [], normal_quantile: [], binomial_pmf: [], binomial_cdf: [], poisson_pmf: [], student_t_cdf: [],
  sigmoid: ['vector'], softplus: ['vector'], relu: ['vector'], softmax: ['vector'], log_softmax: ['vector'],
  cross_entropy: ['vector'], mse: ['vector', 'vector'], cosine_similarity: ['vector', 'vector'],
  standardize: ['vector'], min_max: ['vector'],
  ohms_law: [], rc_time: [], ideal_gas: [], dilution: [],
  future_value: [], net_present_value: ['number', 'vector'], internal_rate: ['vector'],
};

export const expressionExtensions = new Map(tools.flatMap(([module, , , operations]) =>
  operations.filter(([id]) => Object.hasOwn(callableOperations, id)).map(([id, , , fields]) =>
    [id, [module, fields.map(([field, , , example], index) =>
      [field, callableOperations[id][index] === 'vector' && !example.startsWith('[') ? '[' + example + ']' : example])]])));

export function permitsExtension(config, module, key) {
  return permitsModule(config, module) && permitsKey(config, key) && permitsKey(config, 'open') && permitsKey(config, 'close');
}

const standaloneModules = new Set(['graph', 'statistics', 'symbolic', 'machine_learning']);
const standaloneOperation = (module, operation) => module === 'symbolic' ? operation !== 'simplify'
  : module === 'machine_learning' ? ['classification', 'pca'].includes(operation) : standaloneModules.has(module);

function availableTools(config, include) {
  return tools.filter(([module]) => permitsModule(config, module)).flatMap(([module, zh, en, operations]) => {
    const visible = operations.filter(([key]) => include(module, key));
    return visible.some(([key]) => permitsKey(config, key)) ? [[module, zh, en, visible]] : [];
  });
}

export function scientificCategories(config) {
  return availableTools(config, (module, key) => !standaloneOperation(module, key) && !['simplify', 'modular_power'].includes(key));
}

export function calculatorWorksheets(config) {
  if (!permitsModule(config, 'expression') || !permitsKey(config, 'evaluate')) return availableTools(config, () => true);
  const title = config.level === 'basic' ? ['基础计算器', 'Basic calculator'] : ['科学计算器', 'Scientific calculator'];
  const standalone = availableTools(config, standaloneOperation).map(([module, zh, en, operations]) => module === 'machine_learning'
    ? [module, '机器学习分析', 'Machine learning analysis', operations] : [module, zh, en, operations]);
  return [['expression', ...title], ...standalone];
}
