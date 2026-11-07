import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLinkState} from '../src/lib/authRecovery.js';
test('expired email links at the Site URL enter recovery error handling',()=>{
 assert.deepEqual(recoveryLinkState('', '#error=access_denied&error_code=otp_expired'),{requested:true,failed:true});
});
test('recovery links preserve intent without copying any credential into state',()=>{
 assert.deepEqual(recoveryLinkState('', '#access_token=private&refresh_token=private&type=recovery'),{requested:true,failed:false});
 assert.deepEqual(recoveryLinkState('?recovery=1',''),{requested:true,failed:false});
});
test('ordinary sign-in and navigation stay unchanged',()=>{
 assert.deepEqual(recoveryLinkState('?return=/checkout','#main-content'),{requested:false,failed:false});
 assert.deepEqual(recoveryLinkState('','#type=signup'),{requested:false,failed:false});
});
test('redirected errors retain their safe recovery state',()=>{
 assert.deepEqual(recoveryLinkState('?recovery=1&link_error=1',''),{requested:true,failed:true});
});
