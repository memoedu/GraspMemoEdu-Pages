import {calculate, CalculationError} from './calculator-engine.js?v=3f8c0aacb32aa0ad';

self.onmessage = async ({data}) => {
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
