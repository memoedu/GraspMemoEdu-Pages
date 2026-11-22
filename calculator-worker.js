import {calculate, CalculationError} from './calculator-engine.js?v=c690e85f04a2d459';

self.onmessage = async ({data}) => {
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
