import {calculatorWorksheets} from './calculator-policy.js?v=7391113e33abe624';
import {openCalculator} from './calculator-panel.js?v=7391113e33abe624';

const icons = {
  expression: 'M5 3h14v18H5zM8 7h8M8 11h1m3 0h1m3 0h1m-9 4h1m3 0h1m3 0h1m-9 3h1m3 0h1m3 0h1',
  graph: 'M4 3v17h17M7 15c4 0 3-8 7-8s3 6 7 6',
  integral: 'M17 4c-3-3-5 1-5 6v4c0 5-2 9-5 6M5 15h4m6-6h4',
  matrix: 'M8 4H4v16h4m8-16h4v16h-4M8 8h2m4 0h2M8 12h2m4 0h2M8 16h2m4 0h2',
  probability: 'M4 4h16v16H4zM8 8h.1m7.9 0h.1M12 12h.1M8 16h.1m7.9 0h.1',
  statistics: 'M4 20h17M7 16v-5m5 5V5m5 11V8',
  modular: 'M5 8a8 8 0 0 1 14-1l2 3m-1-5 1 5-5-1M19 16a8 8 0 0 1-14 1l-2-3m1 5-1-5 5 1',
  symbolic: 'M4 8h7m-7 4h7m4-4 5 6m0-6-5 6M6 17h12',
  machine_learning: 'M4 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0Zm0 10a2 2 0 1 0 4 0 2 2 0 1 0-4 0Zm12-5a2 2 0 1 0 4 0 2 2 0 1 0-4 0ZM8 8l8 3m-8 5 8-3',
  physics: 'M13 3 5 14h6l-1 7 9-12h-6z',
  chemistry: 'M9 3h6m-5 0v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8',
  signal: 'M3 13h3l2-6 4 12 4-14 2 8h3',
  programmer: 'M8 6l-6 6 6 6m8-12 6 6-6 6m-2-14-4 16',
  astronomy: 'M19 15A8 8 0 1 1 9 5a7 7 0 0 0 10 10ZM18 5v6m-3-3h6',
  geography: 'M12 21s-6-5-6-11a6 6 0 0 1 12 0c0 6-6 11-6 11Zm0-11h.1',
  finance: 'M4 20h16M6 15l5-5 4 2 5-7m-5 0h5v5',
  optimization: 'M4 20h16M5 20V4m0 9 7-7 6 8m-6-8h.1M5 16h15',
  ecology: 'M19 4c1 9-1 14-7 14-4 0-6-3-6-6 0-6 6-7 13-8ZM4 21l10-10',
};

const toolGroups = [
  ['常用计算', 'General calculation', ['expression', 'graph', 'integral', 'symbolic']],
  ['数据与统计', 'Data and statistics', ['matrix', 'probability', 'statistics', 'machine_learning']],
  ['离散计算与信号', 'Discrete computation and signals', ['modular', 'programmer', 'signal']],
  ['自然科学', 'Natural sciences', ['physics', 'chemistry', 'astronomy', 'ecology']],
  ['应用建模', 'Applied modeling', ['geography', 'finance', 'optimization']],
];

export function calculatorToolGroups(config, english, session = {saved: new Map(), history: [], degrees: false, memory: new Map()}) {
  const available = new Map(calculatorWorksheets(config).map(worksheet => {
    const [id, zh, en] = worksheet;
    return [id, {id, label: english ? en : zh, icon: icons[id], open(launcher) {
      openCalculator(launcher, config, worksheet, english, session);
    }}];
  }));
  return toolGroups.map(([zh, en, ids]) => ({
    label: english ? en : zh,
    tools: ids.map(id => available.get(id)).filter(Boolean),
  })).filter(group => group.tools.length);
}
