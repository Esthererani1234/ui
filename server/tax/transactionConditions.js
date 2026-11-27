// A dynamic quote establishes metal pricing for the reviewed, ungraded bullion
// listings. A proof finish, a fixed-price offer or special order terms need
// evidence for the sale itself. The database checks the original quote math.
const standardCoins=new Set(['AGE-1OZ-BU-RY','MAPLE-1OZ-BU-RY','SML-1OZ-BU-RY']);

export function transactionEligibility(rule,line,net,state,day,review,needs) {
  const test=rule.value_test;
  const recorded=line.sale_evidence;
  const basis=recorded?.basis;
  const ordinary=line.special_terms===false && standardCoins.has(rule.catalog_sku) && line.metal_priced===true && net===line.gross;
  switch(test) {
    case 'az_bullion_content':
      if(state!=='AZ' || rule.form!=='bar')return review('The Arizona bar classification needs verification.');
      if(basis==='form_pricing')return false;
      if(basis==='metal_pricing' || (!basis && line.special_terms===false && line.metal_priced===true))return true;
      return needs('Verify whether the Arizona bar derives its value from the refined metal.');
    case 'az_monetized_sale':
      if(state!=='AZ' || rule.form!=='coin')return review('The Arizona coin classification needs verification.');
      if(basis==='jewelry_or_art_manufacture')return false;
      if(basis==='ordinary_coin_sale' || (!basis && line.special_terms===false))return true;
      return needs('Verify whether the Arizona coin was sold for manufacture into jewelry or art.');
    case 'id_monetized_sale':
      if(state!=='ID')return review('The Idaho coin rule is assigned to another jurisdiction.');
      if(basis==='jewelry_or_art_manufacture')return false;
      if(basis==='ordinary_coin_sale' || (!basis && line.special_terms===false))return true;
      return needs('Review the intended use of the Idaho coin sale.');
    case 'al_metal_pricing':
      if(state!=='AL')return review('The Alabama coin rule is assigned to another jurisdiction.');
      if(basis==='numismatic_pricing')return false;
      if(basis==='metal_pricing' || (!basis && ordinary))return true;
      return needs('Verify whether the Alabama coin price depends on metal content or collectible value.');
    case 'ct_proof_coin':
      if(state!=='CT')return review('The Connecticut proof rule is assigned to another jurisdiction.');
      if(['metal_pricing','rare_or_antique'].includes(basis))return true;
      if(basis==='ordinary_collectible')return false;
      return needs('Verify whether this Connecticut proof sale qualifies as rare, antique or traded for its metal.');
    case 'ok_proof_coin':
      if(state!=='OK')return review('The Oklahoma proof rule is assigned to another jurisdiction.');
      if(['metal_pricing','investment_sale'].includes(basis))return true;
      if(basis==='noninvestment_collectible')return false;
      return needs('Verify the investment or metal-price basis of the Oklahoma proof sale.');
    case 'nj_coin_alternatives': {
      if(state!=='NJ')return review('The New Jersey coin rule is assigned to another jurisdiction.');
      if(basis==='metal_pricing' || (!basis && ordinary))return true;
      if(!basis && rule.catalog_sku==='GOTS-GBP-1OZ-RY-001' && rule.market_day===day && rule.market_source?.startsWith('https://') &&
          Number.isSafeInteger(rule.market_unit_cents) && rule.market_unit_cents>0)return rule.market_unit_cents>=100000;
      if(basis==='numismatic_pricing'){
        if(recorded.fmv_cents==null || !Number.isSafeInteger(recorded.fmv_cents) || recorded.fmv_cents<1 || recorded.valuation_day!==day)
          return needs('Verify the individual coin value on the New Jersey sale date.');
        return recorded.fmv_cents>=100000;
      }
      return needs('Verify the bullion or numismatic basis of the New Jersey coin sale.');
    }
    case 'sovereign_commodity_bar':
      if(!['AR','KY','MS'].includes(state))return review('The bar rule is assigned to another jurisdiction.');
      if(basis==='sovereign_use_metal_price')return true;
      if(basis==='sovereign_use_collectible_price')return state!=='KY';
      if(['no_qualifying_sovereign_use','form_pricing'].includes(basis))return false;
      return needs('Verify the government commodity use and pricing basis for this bar.');
    default:
      return undefined;
  }
}
