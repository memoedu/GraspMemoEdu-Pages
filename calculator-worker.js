import {calculate, CalculationError} from './calculator-engine.js?v=712f67980d6162a6';

self.onmessage = async ({data}) => {
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
