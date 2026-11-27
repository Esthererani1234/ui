import {destinationRates} from './destinationRates.js';
import {washingtonAddress} from './washington.js';
import {newMexicoAddress} from './newMexico.js';

export const streetRateResolvers = {
  WA: washingtonAddress, NM: newMexicoAddress,
  VT: destinationRates, HI: destinationRates, ME: destinationRates, DC: destinationRates, NY: destinationRates,
};
