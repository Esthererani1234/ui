// Store purchase floors. Statutory product eligibility is checked separately.
export const bullionMinimums = {
  NY: {name: 'New York', cents: 100001},
  CA: {name: 'California', cents: 200000},
  CT: {name: 'Connecticut', cents: 100000, until: '2027-06-30'},
  MA: {name: 'Massachusetts', cents: 100000},
  MD: {name: 'Maryland', cents: 100001},
};

export function businessDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function storeFloor(state, day) {
  const rule = Object.hasOwn(bullionMinimums,state) ? bullionMinimums[state] : null;
  return rule && (!rule.until || day <= rule.until) ? rule.cents : 0;
}

export function minimumMessage(state, cents) {
  const dollars = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
  return `Our minimum purchase for ${bullionMinimums[state]?.name || state} orders is ${dollars} in qualifying metals.`;
}

export function belowOrderMinimum(state, subtotal, day) {
  const floor = storeFloor(state, day);
  return Number.isSafeInteger(subtotal) && subtotal >= 0 && subtotal < floor
    ? minimumMessage(state, floor) : '';
}
