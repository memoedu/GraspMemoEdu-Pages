import {calculate, CalculationError} from './calculator-engine.js?v=ac18bacda6f39812';

self.onmessage = async ({data}) => {
  try {
    self.postMessage({result: await calculate(data)});
  } catch (error) {
    self.postMessage({error: error instanceof CalculationError ? error.code : 'invalid'});
  }
};
