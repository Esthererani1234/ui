let credentials;
async function token(fetcher,clientId,clientSecret) {
  if (credentials && credentials.until>Date.now()) return credentials.token;
  const response=await fetcher('https://apis.usps.com/oauth2/v3/token',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),
    signal:AbortSignal.timeout(4500),redirect:'error'});
  if (!response.ok) throw Error('USPS authorization unavailable');
  const data=await response.json();
  if (typeof data.access_token!=='string' || !data.access_token) throw Error('USPS authorization unavailable');
  credentials={token:data.access_token,until:Date.now()+Math.max(0,Math.min(Number(data.expires_in)||0,3600)-60)*1000};
  return data.access_token;
}
export async function postalMatch(address,fetcher=fetch) {
  const target=new URL('https://apis.usps.com/addresses/v3/address');
  const [zip,extra]=address.postal_code.split('-');
  const query={streetAddress:address.address_line_1,secondaryAddress:address.address_line_2,city:address.city,state:address.state,ZIPCode:zip,ZIPPlus4:extra};
  target.search=new URLSearchParams(Object.entries(query).filter(([,v])=>v)).toString();
  const bearer=await token(fetcher,process.env.USPS_CLIENT_ID,process.env.USPS_CLIENT_SECRET);
  const response=await fetcher(target,{headers:{authorization:'Bearer '+bearer},signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
  if(response.status===404 || response.status===400) return {status:'needs_input',message:'Check the street number, city and ZIP code.'};
  if(response.status===401) credentials=undefined;
  if(!response.ok) throw Error('USPS address lookup unavailable');
  return readPostalMatch(await response.json());
}
export function readPostalMatch(data) {
  const status=data.additionalInfo?.DPVConfirmation;
  if(status==='D' || status==='S') return {status:'needs_input',message:status==='D'?'Enter the apartment or suite number.':'Check the apartment or suite number.'};
  if(status!=='Y' || data.additionalInfo?.vacant==='Y') return {status:'needs_input',message:'Check the delivery address and unit number.'};
  const a=data.address;
  if(!a?.streetAddress || !a.city || !a.state || !/^\d{5}$/.test(a.ZIPCode)) throw Error('Incomplete postal response');
  return {address:{address_line_1:a.streetAddress,address_line_2:a.secondaryAddress || '',city:a.city,state:a.state,
    postal_code:a.ZIPCode+(/^\d{4}$/.test(a.ZIPPlus4)?'-'+a.ZIPPlus4:''),country:'US'},precision:'delivery_point'};
}
