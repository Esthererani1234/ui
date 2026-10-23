import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)||0);
const label=v=>String(v||'').replaceAll('_',' ');
export async function createOrderInvoice(order,items) {
 const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle(`Invoice ${order.order_number}`);doc.setAuthor('Gold On The Spot');
 let page,y;const ink=rgb(.04,.15,.21),gold=rgb(.68,.49,.16);
 const safe=value=>Array.from(String(value??'').replace(/[\r\n\t]/g,' ')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 function newPage(){page=doc.addPage([612,792]);y=742;page.drawText('GOLD ON THE SPOT',{x:44,y,size:20,font:bold,color:ink});y-=22;page.drawText('goldonthespot.com  |  support@goldonthespot.com',{x:44,y,size:9,font,color:ink});y-=24;page.drawLine({start:{x:44,y},end:{x:568,y},thickness:2,color:gold});y-=28;}
 function line(value,{size=11,strong=false}={}){
  const f=strong?bold:font;let part='';
  for(const char of safe(value)){if(f.widthOfTextAtSize(part+char,size)>520){draw(part);part='';}part+=char;}draw(part);
  function draw(text){if(y<60)newPage();page.drawText(text,{x:44,y,size,font:f,color:ink});y-=size+7;}
 }
 newPage();line(`ORDER INVOICE  ${order.order_number}`,{size:17,strong:true});
 line(`Order date: ${new Date(order.created_at).toLocaleDateString('en-US',{timeZone:'America/New_York'})}`);
 line(`Payment: ${label(order.payment_status)}  |  Order: ${label(order.status)}`,{strong:true});
 line(`Payment method: ${label(order.payment_method)}`);y-=12;
 const shipping=order.shipping_address||{},address=shipping.address||shipping;
 line('CUSTOMER / SHIP TO',{strong:true});
 for(const v of [shipping.name||[order.first_name,order.last_name].filter(Boolean).join(' '),address.address_line_1||address.line1,address.address_line_2||address.line2,[address.city,address.state,address.postal_code].filter(Boolean).join(', '),address.country,order.email])if(v)line(v);
 y-=12;line('ITEMS',{strong:true});
 for(const item of items){line(item.product_name,{strong:true});line(`Qty ${item.quantity}  x  ${money(item.unit_price)}  =  ${money(item.line_total)}${item.sku?'  |  SKU '+item.sku:''}`);y-=6;}
 y-=10;line(`Subtotal: ${money(order.subtotal)}`);line(`Shipping: ${money(order.shipping_amount)}`);
 for(const [name,key] of [['Insurance','insurance_amount'],['Payment fee','payment_surcharge'],['Tax','tax_amount']])if(order[key]!=null&&Number(order[key])!==0)line(`${name}: ${money(order[key])}`);
 line(`ORDER TOTAL: ${money(order.total)} USD`,{strong:true,size:15});y-=12;
 line('This invoice records your order. Payment status above reflects the current order record.',{size:9});
 line('An unpaid invoice is not proof of payment. Cancellation and refund are separate statuses.',{size:9});
 line('For bank wires, open your signed-in order for current instructions and payment eligibility.',{size:9});
 for(const [i,p] of doc.getPages().entries())p.drawText(`Page ${i+1} of ${doc.getPageCount()}`,{x:44,y:28,size:8,font,color:ink});
 return doc.save();
}
