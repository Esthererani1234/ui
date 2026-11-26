import {orderTotalCents} from '../tax/orderAmounts.js';
import {officeAddress} from '../../shared/business.js';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
import {money,timeLabel,deliveryRecipient,acknowledgment,serialAcknowledgment,unitText} from '../../shared/deliveryDocs.js';
const titles={invoice:'Customer invoice',packing:'Packing slip',ack:'Delivery acknowledgment',signed:'Delivery acknowledgment'};
const assets=()=>Promise.all(['fonts/DejaVuSans.ttf','fonts/DejaVuSans-Bold.ttf','document-logo.png'].map(n=>readFile(new URL('../assets/'+n,import.meta.url))));
export async function renderDeliveryPdf({order:o,items,delivery:d},kind,id,issued,receipt){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [a,b,c]=await assets(),font=await pdf.embedFont(a,{subset:true}),bold=await pdf.embedFont(b,{subset:true}),logo=await pdf.embedPng(c);
 const ink=rgb(.07,.12,.17),muted=rgb(.31,.36,.4),gold=rgb(.62,.45,.16);
 let p,y;pdf.setTitle(titles[kind]+' · '+o.order_number);pdf.setAuthor('Gold On The Spot');
 function put(s,x,yy,size=10,f=font,color=ink){p.drawText(String(s).replace(/[\x00-\x1f]/g,' '),{x,y:yy,font:f,size,color})}
 function line(x1,x2,yy,color=gold){p.drawLine({start:{x:x1,y:yy},end:{x:x2,y:yy},thickness:.65,color})}
 function page(){p=pdf.addPage([612,792]);p.drawImage(logo,{x:40,y:712,width:44,height:44});put('Gold On The Spot',96,737,19,bold);put('goldonthespot.com   ·   support@goldonthespot.com',97,718,9,font,muted);put(officeAddress.join(' · '),97,703,8,font,muted);line(40,572,692);y=666;put(titles[kind],40,y,20,bold);y-=20;put('Order '+o.order_number+'   ·   '+timeLabel(issued),40,y,9);y-=19;if(kind==='invoice'){put('Invoice INV-'+id,40,y,8,font,muted);y-=17}}
 function need(h){if(y-h<54)page()}
 function para(s,{x=40,width=532,size=10,f=font,color=ink}={}){if(!s)return;const rows=[];let buf='';for(const word of String(s).replace(/\s+/g,' ').trim().split(' ')){if(buf&&f.widthOfTextAtSize(buf+' '+word,size)>width){rows.push(buf);buf=''}for(const ch of (buf?' ':'')+word){if(buf&&f.widthOfTextAtSize(buf+ch,size)>width){rows.push(buf);buf=''}buf+=ch}}if(buf)rows.push(buf);for(const r of rows){need(size+4);put(r,x,y,size,f,color);y-=size+4}}
 function checks(labels){need(30);let x=40;for(const label of labels){p.drawRectangle({x,y:y-1,width:9,height:9,borderColor:ink,borderWidth:.8});put(label,x+14,y,9);x+=14+font.widthOfTextAtSize(label,9)+19}y-=23}
 function section(s){need(32);y-=5;para(s.toUpperCase(),{size:9,f:bold,color:gold})}
 function addr(ad){if(!ad)return;const a=ad.address||ad;para([a.address_line_1||a.line1,a.address_line_2||a.line2,[a.city,a.state,a.postal_code||a.zip].filter(Boolean).join(', '),a.country].filter(Boolean).join(' · '),{size:9})}
 const deliveryForm=kind==='ack'||kind==='signed';
 page();
 if(deliveryForm){
   section(receipt?'Received by':'Recipient');
   const name=receipt?.name || deliveryRecipient(o,d);
   if(name)para(name,{f:bold});
   if(!receipt){
     if(!name)y-=12;
     line(40,415,y,muted);y-=13;
     para(name?'If someone else receives this order, correct the name above before signing.':'Enter the name of the person receiving this order.',{size:8,color:muted});
   }
   addr(o.shipping_address);
 }else{
   section(kind==='invoice'?'Customer / ship to':'Deliver to');
   const customerName=[o.first_name,o.last_name].filter(Boolean).join(' ');
   para(customerName||o.shipping_address?.name,{f:bold});
   if(o.shipping_address?.name&&o.shipping_address.name!==customerName)para(o.shipping_address.name);
   addr(o.shipping_address);
   if(kind==='invoice'&&o.billing_address){section('Billing address');addr(o.billing_address)}
 }
 const financial=kind==='invoice';
 if(financial && o.tax_amount!=null)orderTotalCents(o);
 section('Merchandise');function table(){need(35);line(40,572,y);y-=14;put('DESCRIPTION',40,y,8,bold,muted);put('QTY',financial?360:528,y,8,bold,muted);if(financial){put('UNIT PRICE',404,y,8,bold,muted);put('AMOUNT',506,y,8,bold,muted)}y-=17}
 table();
 for(const i of items){if(y<99){page();table()}const top=y;
 put(i.quantity,financial?360:528,top,9,bold);if(financial){put(money(i.unit_price),404,top,9);put(money(i.line_total),572-bold.widthOfTextAtSize(money(i.line_total),9),top,9,bold)}
 para(i.product_name,{width:financial?308:467,f:bold});
 para(i.description,{size:9,color:muted});para([i.sku,i.metal,i.metal_weight_oz&&i.metal_weight_oz+' troy oz',i.purity].filter(Boolean).join(' · '),{size:8,color:muted});
 for(const u of i.units||[])para(unitText(u),{x:48,width:513,size:9});
 y-=4;line(40,572,y,rgb(.83,.84,.85));y-=13}
 if(financial){for(const [k,n] of [['subtotal','Subtotal'],['discount_amount','Discount'],['tax_amount','Sales tax'],['shipping_amount','Shipping'],['insurance_amount','Insurance'],['payment_surcharge','Payment fee'],['total','Grand total']]){if(o[k]==null||(!Number(o[k])&&!['subtotal','total'].includes(k)))continue;need(20);if(k==='total'){y-=3;p.drawRectangle({x:320,y:y-5,width:252,height:22,color:rgb(.96,.94,.88)})}put(n,328,y,10,k==='total'?bold:font);const amt=money(k==='discount_amount'?-Number(o[k]):k==='subtotal'?Number(o[k])+Number(o.discount_amount||0):o[k]);put(amt,564-bold.widthOfTextAtSize(amt,10),y,10,bold);y-=17}
 para([o.payment_method&&'Payment method: '+o.payment_method.toUpperCase(),o.payment_status&&'Payment status: '+o.payment_status.toUpperCase().replaceAll('_',' ')].filter(Boolean).join('    ·    '),{size:9,f:bold});}
 else if(kind==='packing'){section('Packing verification');checks(['Quantity verified','Items checked','Package sealed']);y-=15;para('Packed by: ______________________      Date: ______________________')}
 else{section('Handoff');para(['Order value: '+money(o.total),d.method,d.actual&&timeLabel(d.actual)].filter(Boolean).join('   ·   '));para(acknowledgment,{size:9});if(items.some(i=>i.units?.some(u=>u.serial)))para(serialAcknowledgment,{size:9});
 if(d.representative)para('Delivered by: '+d.representative,{size:9});
 if(d.notes)para('Delivery notes: '+d.notes,{size:9});
 if(receipt){
   para('ID checked: '+(receipt.idChecked?'Yes':'No')+'   ·   Package: '+receipt.condition,{size:9});
   need(95);y-=5;
   for(const stroke of receipt.strokes)for(let n=1;n<stroke.length;n++){
     const point=([x,z])=>({x:44+x*290,y:y-z*53});
     p.drawLine({start:point(stroke[n-1]),end:point(stroke[n]),thickness:1.4,color:ink});
   }
   y-=60;line(40,348,y);y-=14;
   para('Recipient signature   ·   Signed '+timeLabel(issued),{size:9,color:muted});
 }else{
   need(114);y-=6;
   checks(['Handed directly to recipient','ID verified','Package condition confirmed']);
   y-=30;line(40,355,y,ink);if(!d.actual)line(380,572,y,ink);
   y-=13;put('Recipient signature',40,y,9,bold);if(!d.actual)put('Delivery date and time',380,y,9);
   if(!d.notes){y-=28;put('Notes (optional)',40,y,9,font,muted);line(125,572,y,muted)}
 }}
 pdf.getPages().forEach((pg,n)=>{p=pg;line(40,572,42);put('GOLD ON THE SPOT   /   '+o.order_number,40,27,8,font,muted);put((n+1)+' / '+pdf.getPageCount(),535,27,8,font,muted)});
 return Buffer.from(await pdf.save());
}
