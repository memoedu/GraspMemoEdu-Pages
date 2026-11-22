import {calculate, CalculationError} from './calculator-engine.js?v=a84a3c1c58c18aee';

self.onmessage = async ({data}) => {
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
