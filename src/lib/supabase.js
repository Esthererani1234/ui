import { createClient } from "@supabase/supabase-js";
import {isProductionPreview,previewReadAllowed} from '../../shared/deploymentSafety.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://jwquqphzsnnijopabuhn.supabase.co";
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_UmuOpNm2x13dOqlv1jL3Og_XSQtFuHV";
export const readOnlyPreview=isProductionPreview(__DEPLOYMENT_ENV__,supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseKey, {
  ...(readOnlyPreview ? {global:{fetch:(input,init)=>{
    if(!previewReadAllowed(input,init))return Promise.reject(new Error('Account actions are disabled in this preview. Use the live website.'));
    return fetch(input,init);
  }}} : {}),
  auth: {
    persistSession: !readOnlyPreview,
    autoRefreshToken: !readOnlyPreview,
    detectSessionInUrl: !readOnlyPreview,
  },
});

export const hasSupabase = Boolean(supabaseUrl && supabaseKey);
