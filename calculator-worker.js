import {calculate, CalculationError, warmCalculator} from './calculator-engine.js?v=1187821e4225531a';

self.onmessage = async ({data}) => {
  if (data.warmup) { await warmCalculator(data.module, data.expression).catch(() => {}); return; }
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
