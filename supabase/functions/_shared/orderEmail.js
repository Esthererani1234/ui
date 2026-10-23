// Shared by the Node admin API and Deno email worker. No browser imports.
export const EMAIL_EVENTS = {
  placed: ['Order received', 'We have your order.', 'Thank you for choosing Gold On The Spot. Your order has been recorded. Payment must be confirmed before fulfillment begins.'],
  awaiting_payment: ['Awaiting payment', 'Your order is awaiting payment.', 'Open your order to review the payment instructions and deadline. We will email you again once payment is confirmed.'],
  wire_instructions: ['Order received — Wire payment instructions', 'Thank you. We received your order.', 'Please send a bank wire for the exact USD amount below and include your payment reference. Do not send an ACH transfer. Your payment is still awaiting confirmation.'],
  paid: ['Payment received', 'Thank you. Payment received.', 'Your payment has been confirmed. We will keep you updated as your order moves through review, preparation, and shipping.'],
  processing: ['Preparing your order', 'Your order is being prepared.', 'Our team is preparing your precious metals for shipment. We will send another update when your order ships.'],
  shipped: ['Order shipped', 'Your order is on its way.', 'Your order has been marked shipped. Review the tracking details below and open your order for the latest information.'],
  delivered: ['Order delivered', 'Your order is marked delivered.', 'Your order has been marked delivered. Thank you for choosing Gold On The Spot. If your package has not arrived, please contact us through your account.'],
  cancelled: ['Order cancelled', 'Your order has been cancelled.', 'This order will not continue through fulfillment. Cancellation and refund are separate updates; if a refund is issued, we will send a refund confirmation.'],
  refunded: ['Payment refunded', 'Your refund has been recorded.', 'The payment for this order has been marked refunded. The time it takes to appear depends on your bank or payment provider.'],
  tracking: ['Tracking updated', 'Your tracking details have been updated.', 'Use the updated tracking reference below. Your account always shows the latest order and delivery details.'],
};
const SITE = 'https://goldonthespot.com';
export const escapeEmail = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(value) || 0);
function imageUrl(value) {
  try {
    const url = new URL(value, SITE);
    return url.protocol === 'https:' && !url.username && !url.password && ['goldonthespot.com','www.goldonthespot.com','jwquqphzsnnijopabuhn.supabase.co'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}
const paymentLabel = method => ({card:'Credit / debit card',wire:'Bank wire',crypto:'Cryptocurrency'}[method] || 'See order details');
function renderWireInstructions(order, wire) {
  const invalid = () => Object.assign(new Error('Complete wire instructions are required'), {code:'wire_instructions_unavailable'});
  const required = ['bank_name','beneficiary_name','routing_number','account_number'];
  if (!wire || required.some(key => typeof wire[key] !== 'string' || !wire[key].trim()) ||
      !/^\d{9}$/.test(wire.routing_number) || !/^\d{4,34}$/.test(wire.account_number) ||
      (wire.swift_code != null && typeof wire.swift_code !== 'string') ||
      (wire.bank_address != null && typeof wire.bank_address !== 'string')) throw invalid();
  const total = String(order.total ?? '');
  const reference = order.payment_reference || order.order_number;
  const due = new Date(order.payment_due_at);
  if (!/^\d+(\.\d{1,2})?$/.test(total) || Number(total) <= 0 || !Number.isSafeInteger(Math.round(Number(total)*100)) ||
      typeof reference !== 'string' || !reference.trim() || typeof order.payment_due_at !== 'string' ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(order.payment_due_at) || Number.isNaN(due.getTime())) throw invalid();
  const deadline = new Intl.DateTimeFormat('en-US', {month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(due);
  const details = [
    ['Wire amount', `${cash(total)} USD`], ['Payment reference', reference],
    ['Payment deadline', `${deadline} (America/New_York)`],
    ['Bank', wire.bank_name], ['Beneficiary', wire.beneficiary_name],
    ['Domestic wire ABA routing number', wire.routing_number], ['Account number', wire.account_number],
    ...(wire.swift_code?.trim() ? [['SWIFT / BIC (international wires only)', wire.swift_code]] : []),
    ...(wire.bank_address?.trim() ? [['Bank address', wire.bank_address]] : []),
  ];
  const security = 'Before sending funds, sign in to your account at goldonthespot.com and verify these bank details, the amount, reference, and deadline against your order. If anything differs, contact customer care through your signed-in account before sending. Do not act on emailed requests to change bank details.';
  const timing = 'Ask your bank to send a wire, not ACH, and include the payment reference exactly as shown. This email is a payment request, not confirmation of payment or a guarantee of delivery. Your account shows the latest order status.';
  const agreementText = order.wire_agreement_text;
  const agreementVersion = order.wire_agreement_version;
  const agreement = [agreementVersion != null && String(agreementVersion).trim() ? `Agreement version: ${agreementVersion}` : '',
    typeof agreementText === 'string' && agreementText.trim() ? agreementText : ''].filter(Boolean);
  const esc = escapeEmail;
  return {
    html: `<tr><td style="padding:22px 28px;background:#f8f4e9;border-top:1px solid #e7d8b5;border-bottom:1px solid #e7d8b5;"><h2 style="font:700 22px Georgia,serif;margin:0 0 16px;">Bank wire instructions</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${details.map(([key,value])=>`<tr><td style="padding:7px 12px 7px 0;font-size:12px;vertical-align:top;color:#526773;">${esc(key)}</td><td style="padding:7px 0;font-size:13px;font-weight:700;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap;">${esc(value)}</td></tr>`).join('')}</table><p style="font-size:13px;line-height:1.8;">${esc(timing)}</p><p style="font-size:13px;line-height:1.8;"><strong>Verify securely before sending.</strong> ${esc(security)}</p>${agreement.length ? `<h3 style="font:700 18px Georgia,serif;">Your wire agreement copy</h3><div style="font-size:12px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;">${agreement.map(esc).join('<br><br>')}</div>` : ''}</td></tr>`,
    text: ['BANK WIRE INSTRUCTIONS',...details.map(([key,value])=>`${key}: ${value}`),timing,security,...(agreement.length ? ['Your wire agreement copy',...agreement] : [])].join('\n\n'),
  };
}
export function renderOrderEmail({ event, order, items = [], wire }) {
  const copy = EMAIL_EVENTS[event];
  if (!copy) throw new Error('Unsupported email event');
  const [label, heading, message] = copy;
  const number = String(order.order_number || '');
  const link = `${SITE}/account?tab=orders&order=${encodeURIComponent(number)}`;
  const esc = escapeEmail;
  const wireInstructions = event === 'wire_instructions' ? renderWireInstructions(order, wire) : null;
  const address = order.shipping_address || {};
  const addressLines = [address.name, address.address_line_1 || address.line1, address.address_line_2 || address.line2, [address.city,address.state,address.postal_code].filter(Boolean).join(', '), address.country].filter(Boolean);
  const date = new Date(order.created_at);
  const placed = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/New_York'});
  const rows = items.map(item => {
    const photo = imageUrl(item.product_image_url || item.products?.image_url || item.products?.image_urls?.[0]);
    const visual = photo ? `<img src="${esc(photo)}" width="72" height="72" alt="${esc(item.product_name)}" style="display:block;width:72px;height:72px;object-fit:contain;border:0;" />` : '<span style="font:700 26px Georgia,serif;color:#a67c22;">G</span>';
    return `<tr><td width="84" style="padding:18px 8px 18px 0;border-bottom:1px solid #e6e9ec;vertical-align:top;"><table role="presentation" width="72" height="72" style="background:#f7f8f8;"><tr><td align="center">${visual}</td></tr></table></td><td style="padding:18px 8px 18px 0;border-bottom:1px solid #e6e9ec;vertical-align:top;"><div style="font-size:14px;font-weight:700;line-height:1.5;">${esc(item.product_name)}</div><div style="color:#63727b;font-size:12px;line-height:1.7;margin-top:5px;">Quantity ${esc(item.quantity)} · ${cash(item.unit_price)} each</div>${item.sku ? `<div style="color:#63727b;font-size:11px;line-height:1.6;">SKU ${esc(item.sku)}</div>` : ''}</td><td align="right" style="padding:18px 0;border-bottom:1px solid #e6e9ec;vertical-align:top;font-size:13px;font-weight:700;white-space:nowrap;">${cash(item.line_total)}</td></tr>`;
  }).join('');
  const totals = [['Items',order.subtotal],['Shipping',order.shipping_amount],...(Number(order.insurance_amount)>0?[['Insurance',order.insurance_amount]]:[]),...(Number(order.payment_surcharge)>0?[['Payment fee',order.payment_surcharge]]:[])];
  const tracking = order.tracking_number && ['shipped','delivered','tracking'].includes(event) ? `<tr><td style="padding:20px 28px;background:#f8f4e9;border-top:1px solid #e7d8b5;border-bottom:1px solid #e7d8b5;"><div style="font-size:11px;letter-spacing:1px;font-weight:700;color:#7c5d20;">TRACKING REFERENCE</div><div style="font-size:16px;line-height:1.5;font-weight:700;overflow-wrap:anywhere;word-break:break-all;margin-top:6px;">${esc(order.tracking_number)}</div><div style="font-size:12px;line-height:1.6;color:#63727b;margin-top:5px;">Carrier scans may take time to update.</div></td></tr>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(label)} · ${esc(number)}</title></head><body style="margin:0;padding:0;background:#edf1f3;color:#132f40;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(label)} for ${esc(number)}. ${esc(message)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf1f3;"><tr><td align="center" style="padding:24px 8px;"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce3e7;">
<tr><td style="padding:30px 28px;background:#082638;border-bottom:4px solid #c59a43;"><div style="font:700 26px Georgia,'Times New Roman',serif;color:#ffffff;">Gold On The Spot<span style="color:#d9b86b;">.</span></div><div style="margin-top:9px;color:#dfc891;font-size:10px;font-weight:700;letter-spacing:2px;">PRECIOUS METALS · PRICED RIGHT</div></td></tr>
<tr><td style="padding:28px 28px 22px;"><div style="font-size:11px;font-weight:700;color:#936d21;letter-spacing:1.5px;text-transform:uppercase;">${esc(label)}</div><h1 style="font:700 30px/1.2 Georgia,'Times New Roman',serif;color:#082638;margin:14px 0 20px;">${esc(heading)}</h1><p style="font-size:14px;line-height:1.8;margin:0 0 8px;">Hello${order.first_name ? ` ${esc(order.first_name)}` : ''},</p><p style="font-size:14px;line-height:1.8;color:#526773;margin:0;">${esc(message)}</p></td></tr>
${tracking}${wireInstructions?.html || ''}
<tr><td style="padding:4px 28px 24px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:16px 0;border-top:1px solid #e6e9ec;border-bottom:1px solid #e6e9ec;font-size:12px;line-height:1.7;"><span style="color:#63727b;">ORDER NUMBER</span><br><strong>${esc(number)}</strong></td><td align="right" style="padding:16px 0;border-top:1px solid #e6e9ec;border-bottom:1px solid #e6e9ec;font-size:12px;line-height:1.7;"><span style="color:#63727b;">PLACED</span><br>${esc(placed)}</td></tr></table><h2 style="font:700 20px Georgia,serif;margin:24px 0 0;">Your order</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows || '<tr><td style="padding:16px 0;font-size:13px;">View your account for item details.</td></tr>'}</table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;">${totals.map(([name,value])=>`<tr><td style="font-size:13px;color:#63727b;padding:5px 0;">${name}</td><td align="right" style="font-size:13px;padding:5px 0;">${cash(value)}</td></tr>`).join('')}<tr><td style="padding:14px 0;font-size:16px;font-weight:700;border-top:1px solid #dce3e7;">Order total</td><td align="right" style="padding:14px 0;font-size:20px;font-weight:700;border-top:1px solid #dce3e7;">${cash(order.total)}</td></tr></table><p style="margin:4px 0 0;color:#63727b;font-size:12px;line-height:1.7;">Payment method: ${paymentLabel(wireInstructions ? 'wire' : order.payment_method)}<br>All amounts in USD.</p></td></tr>
${addressLines.length ? `<tr><td style="padding:0 28px 24px;"><div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#63727b;margin-bottom:8px;">DELIVERY ADDRESS</div><div style="font-size:13px;line-height:1.8;">${addressLines.map(esc).join('<br>')}</div></td></tr>` : ''}
<tr><td align="center" style="padding:4px 28px 28px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#c59a43" style="border-radius:3px;"><a href="${esc(link)}" style="display:inline-block;padding:16px 32px;color:#082638;font-size:14px;font-weight:700;text-decoration:none;">View your order</a></td></tr></table><p style="font-size:11px;line-height:1.6;color:#63727b;margin:14px 0 0;">Sign in securely to view the latest status and details.</p></td></tr>
<tr><td style="padding:22px 28px;background:#f6f8f9;border-top:1px solid #e6e9ec;"><p style="font-size:13px;line-height:1.7;margin:0 0 8px;"><strong>Questions about your order?</strong><br><a href="${SITE}/support" style="color:#23566e;">Contact customer care</a> and include ${esc(number)}.</p><p style="font-size:11px;line-height:1.7;color:#63727b;margin:0;">We will never ask for your password, verification code, or full card details by email. This is a service update about your order.</p></td></tr></table><p style="font-size:11px;color:#71808a;line-height:1.6;margin:20px 0 0;">Gold On The Spot · <a href="${SITE}" style="color:#71808a;">goldonthespot.com</a></p></td></tr></table></body></html>`;
  const text = ['GOLD ON THE SPOT',heading,`Hello${order.first_name ? ` ${order.first_name}` : ''},`,message,wireInstructions?.text,`Order: ${number}`,`Placed: ${placed}`,...items.map(i=>`${i.product_name} — Quantity ${i.quantity} × ${cash(i.unit_price)} = ${cash(i.line_total)}`),...totals.map(([k,v])=>`${k}: ${cash(v)}`),`Order total: ${cash(order.total)} USD`,`Payment method: ${paymentLabel(wireInstructions ? 'wire' : order.payment_method)}`,tracking ? `Tracking: ${order.tracking_number}` : '',...addressLines,`View your order: ${link}`,`Customer care: ${SITE}/support`,'We will never ask for your password, verification code, or full card details by email.'].filter(Boolean).join('\n\n');
  return {subject:`${label} · ${number.replace(/[\r\n]/g,' ')} | Gold On The Spot`,html,text};
}
export function sampleOrder() {
  // Deliberately fictitious bank data keeps the existing admin preview path usable.
  return {wire:{bank_name:'Example Bank — PREVIEW ONLY, DO NOT SEND FUNDS',beneficiary_name:'Sample Beneficiary',routing_number:'000000000',account_number:'0000000000',bank_address:'123 Example Street, New York, NY 10001'},order:{payment_due_at:'2026-10-23T21:00:00Z',payment_reference:'GOTS-PREVIEW',order_number:'GOTS-PREVIEW',first_name:'Customer',created_at:'2026-10-22T12:00:00Z',payment_method:'card',subtotal:4000,shipping_amount:0,payment_surcharge:160,total:4160,tracking_number:'SAMPLE-TRACKING',shipping_address:{name:'Sample Customer',line1:'123 Example Street',city:'New York',state:'NY',postal_code:'10001',country:'US'}},items:[{product_name:'1 oz American Gold Buffalo',sku:'GOLD-BUFFALO-1OZ',quantity:1,unit_price:4000,line_total:4000,product_image_url:SITE+'/images/buffalo-hero-480-v1.webp'}]};
}
