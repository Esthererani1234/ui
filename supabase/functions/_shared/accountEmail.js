import {escapeEmail} from './orderEmail.js';
export const ACCOUNT_EMAIL_EVENTS={
 account_signin:['New verified sign-in','Your account was signed in after phone verification.'],
 account_password_changed:['Your password was changed','The password for your Gold On The Spot account was changed.'],
 account_email_changed:['Your email address was changed','The email address on your Gold On The Spot account was changed.'],
};
export function renderAccountEmail({event,details}) {
 const copy=ACCOUNT_EMAIL_EVENTS[event];if(!copy)throw new Error('Unsupported account notification');
 const [title,description]=copy;
 const when=new Date(details.occurred_at);
 if(!Number.isFinite(when.getTime()))throw new Error('Account event timestamp missing');
 const timestamp=new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'short',timeZone:'America/New_York'}).format(when)+' (Eastern Time)';
 const help='If this was you, no action is needed. If you did not do this, open goldonthespot.com directly, reset your password, and contact support@goldonthespot.com immediately. Never share your password or verification codes.';
 const esc=escapeEmail;
 return {subject:`${title} | Gold On The Spot`,text:`GOLD ON THE SPOT\n\n${title}\n\n${description}\n${timestamp}\n\n${help}\n\nAccount security: https://goldonthespot.com/account?tab=security`,
 html:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#edf1f3;color:#132f40;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:600px;background:white"><tr><td style="padding:28px;background:#082638;border-bottom:4px solid #c59a43;color:white;font:bold 26px Georgia,serif">Gold On The Spot</td></tr><tr><td style="padding:28px"><p style="color:#936d21;font-size:12px">ACCOUNT SECURITY</p><h1 style="font:bold 28px Georgia,serif">${esc(title)}</h1><p style="line-height:1.7">${esc(description)}</p><p style="color:#526773">${esc(timestamp)}</p><p style="line-height:1.7">${esc(help)}</p><p><a href="https://goldonthespot.com/account?tab=security" style="display:inline-block;padding:14px 22px;background:#c59a43;color:#082638;text-decoration:none;font-weight:bold">Review account security</a></p></td></tr></table></td></tr></table></body></html>`};
}
