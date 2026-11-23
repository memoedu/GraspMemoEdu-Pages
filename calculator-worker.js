import {calculate, CalculationError, warmCalculator} from './calculator-engine.js?v=38bdd9ea02fafb0e';

self.onmessage = async ({data}) => {
  if (data.warmup) { await warmCalculator(data.module, data.expression).catch(() => {}); return; }
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
