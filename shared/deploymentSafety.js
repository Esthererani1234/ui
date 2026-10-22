export const PRODUCTION_DATABASE_HOST='jwquqphzsnnijopabuhn.supabase.co';

export function isProductionPreview(environment,databaseUrl){
 if(environment!=='preview')return false;
 try{return new URL(databaseUrl).hostname===PRODUCTION_DATABASE_HOST;}catch{return true;}
}

export function previewReadAllowed(input,init={}){
 const url=new URL(typeof input==='string'?input:input.url);
 const method=String(init.method || input.method || 'GET').toUpperCase();
 return ['GET','HEAD'].includes(method) && url.protocol==='https:' &&
  url.hostname===PRODUCTION_DATABASE_HOST &&
  (/^\/rest\/v1\/(products|app_settings)$/.test(url.pathname) || url.pathname.startsWith('/storage/v1/object/public/'));
}

export function previewPaymentsAllowed(environment,databaseUrl,stripeKey){
 return environment!=='preview' || (!isProductionPreview(environment,databaseUrl) && /^(sk|rk)_test_/.test(stripeKey || ''));
}
