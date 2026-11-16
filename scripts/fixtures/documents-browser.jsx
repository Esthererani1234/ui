import React from 'react';
import {createRoot} from 'react-dom/client';
import {supabase} from '../../src/lib/supabase';
import '../../src/styles.css';
import OrderDocuments from '../../src/components/OrderDocuments';
supabase.auth.getSession=async()=>({data:{session:{access_token:'local-test-only'}}});
createRoot(document.getElementById('root')).render(<OrderDocuments orderId={42}/>);
