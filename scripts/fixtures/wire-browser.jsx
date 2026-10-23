import React from 'react';
import {createRoot} from 'react-dom/client';
import {PaymentAction} from '../../src/pages/AccountPage.jsx';
import {supabase} from '../../src/lib/supabase';
supabase.auth.getSession=async()=>({data:{session:{access_token:'fixture-not-a-real-token'}}});
createRoot(document.getElementById('root')).render(<PaymentAction order={{id:42,payment_method:'wire'}} autoOpen={true}/>);
