import schedule from './newYorkRates.json' with {type:'json'};

const nycCounties = new Set(['36005','36047','36061','36081','36085']);
const stateRate = {level:'state', code:'NY', name:'New York State', ppm:40000};
const transit = {level:'district', code:'MCTD', name:'Metropolitan Commuter Transportation District', ppm:3750};

export function newYorkComponents(geo, day) {
  if (day < schedule.effective || day > schedule.through || geo.Counties?.length !== 1) return [];
  const county = geo.Counties[0];
  if (!/^36\d{3}$/.test(county.GEOID) || !county.NAME) return [];
  if (Object.entries(geo).some(([layer,areas])=>/american indian|tribal|reservation/i.test(layer) && areas?.length)) return [];
  const incorporated = geo['Incorporated Places'] || [];
  if (nycCounties.has(county.GEOID)) {
    if (incorporated.length !== 1 || incorporated[0].GEOID !== '3651000') return [];
    return [stateRate, {level:'city',code:'NYC',name:'New York City',county:county.NAME,
      reporting_code:schedule.nyc.code,ppm:schedule.nyc.ppm-stateRate.ppm-transit.ppm},transit];
  }

  const countyName = county.NAME.replace(/ County$/, '');
  let jurisdiction = Object.hasOwn(schedule.counties,countyName) && schedule.counties[countyName];
  if (!jurisdiction || incorporated.length > 1 || incorporated[0]?.GEOID === '3651000') return [];
  let city;
  const exceptions = schedule.cities[countyName];
  if (exceptions) {
    // These counties have separate city reporting codes. A postal city can also be a town.
    const subdivisions = geo['County Subdivisions'];
    if (subdivisions?.length !== 1 || !subdivisions[0].GEOID?.startsWith(county.GEOID)) return [];
    const subdivision = /^(.+) (city|town)$/i.exec(subdivisions[0].NAME || '');
    if (!subdivision) return [];
    const incorporatedCity = /^(.+) city$/i.exec(incorporated[0]?.NAME || '')?.[1];
    if (subdivision[2].toLowerCase() === 'city') {
      if (incorporatedCity !== subdivision[1]) return [];
      if (Object.hasOwn(exceptions,incorporatedCity)) {
        city = incorporatedCity;
        jurisdiction = exceptions[city];
      }
    } else if (incorporatedCity) return [];
  }
  const local = {level:'combined_local',code:jurisdiction.code,reporting_code:jurisdiction.code,
    name:city || county.NAME,county:county.NAME,ppm:jurisdiction.ppm-stateRate.ppm};
  if (jurisdiction.mctd) {
    // Pub 718 includes MCTD in the combined local rate. Preserve its known share once.
    local.districts = [transit.name];
    local.included_rates = [{code:transit.code,ppm:transit.ppm}];
  }
  return [stateRate, local];
}
