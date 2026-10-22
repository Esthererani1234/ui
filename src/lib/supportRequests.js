import { supabase } from './supabase';
import { invokeFunction } from './functionRequest';
export function requestReference(ref,body) {
 const signature=JSON.stringify(body);
 if(ref.current?.signature!==signature)ref.current={signature,id:crypto.randomUUID()};
 return ref.current.id;
}
export const supportRequest=body=>invokeFunction(supabase,'support-operations',body,{timeout:25000});
