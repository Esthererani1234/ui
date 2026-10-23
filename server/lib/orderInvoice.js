import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {readFile} from 'node:fs/promises';
const regularBytes=readFile(new URL('../assets/fonts/DejaVuSans.ttf',import.meta.url));
const boldBytes=readFile(new URL('../assets/fonts/DejaVuSans-Bold.ttf',import.meta.url));
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)||0);
const label=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export async function createOrderInvoice(order,items){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(await regularBytes,{subset:true}),bold=await doc.embedFont(await boldBytes,{subset:true}),serif=bold;
 doc.setTitle(`Invoice ${order.order_number}`);doc.setAuthor('Gold On The Spot');
 const navy=rgb(.045,.15,.21),gold=rgb(.69,.52,.22),muted=rgb(.35,.42,.46),rule=rgb(.84,.87,.88),pale=rgb(.95,.96,.97),white=rgb(1,1,1);
 let page,y;
 const safe=v=>Array.from(String(v??'').replace(/[\r\n\t]/g,' ')).map(c=>{try{font.encodeText(c);return c}catch{return '?'}}).join('');
 const text=(v,x,at,size=10,f=font,color=navy)=>page.drawText(safe(v),{x,y:at,size,font:f,color});
 const right=(v,x,at,size=10,f=font,color=navy)=>text(v,x-f.widthOfTextAtSize(safe(v),size),at,size,f,color);
 function wrap(v,width,size=10,f=font){const lines=[];let line='';for(const word of safe(v).split(' ')){if(line&&f.widthOfTextAtSize(line+' '+word,size)>width){lines.push(line);line=''}for(const char of (line?' ':'')+word){if(f.widthOfTextAtSize(line+char,size)>width){lines.push(line);line=''}line+=char;}}if(line)lines.push(line);return lines;}
 function newPage(){page=doc.addPage([612,792]);page.drawRectangle({x:0,y:682,width:612,height:110,color:navy});page.drawCircle({x:64,y:738,size:23,borderColor:gold,borderWidth:1.5});text('G',51,726,33,serif,gold);text('Gold On The Spot',101,741,23,serif,white);text('PRECIOUS METALS',102,722,8,font,rgb(.78,.81,.83));right('ORDER INVOICE',568,745,9,bold,gold);right(order.order_number,568,722,13,bold,white);page.drawRectangle({x:0,y:679,width:612,height:3,color:gold});y=652;}
 function ensure(height){if(y-height<90)newPage();}
 function paragraph(value,width=524,size=9,color=muted){for(const row of wrap(value,width,size)){ensure(size+6);text(row,44,y,size,font,color);y-=size+6;}}
 function tableHeader(){ensure(34);page.drawRectangle({x:44,y:y-12,width:524,height:28,color:navy});text('ITEM / DESCRIPTION',54,y-2,8,bold,white);right('QTY',356,y-2,8,bold,white);right('UNIT PRICE',455,y-2,8,bold,white);right('AMOUNT',558,y-2,8,bold,white);y-=32;}
 newPage();const date=new Date(order.created_at).toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric'});
 text('ORDER DATE',44,y,8,bold,muted);text(date,44,y-17,11);text('PAYMENT METHOD',224,y,8,bold,muted);text(label(order.payment_method),224,y-17,11);text('PAYMENT STATUS',426,y,8,bold,muted);text(label(order.payment_status),426,y-17,11,bold);y-=51;
 page.drawLine({start:{x:44,y},end:{x:568,y},thickness:.6,color:rule});y-=24;
 text('CUSTOMER / SHIP TO',44,y,8,bold,muted);right('Order status: '+label(order.status),568,y,9,font,muted);y-=19;
 const shipping=order.shipping_address||{},address=shipping.address||shipping;
 const details=[shipping.name||[order.first_name,order.last_name].filter(Boolean).join(' '),address.address_line_1||address.line1,address.address_line_2||address.line2,[address.city,address.state,address.postal_code].filter(Boolean).join(', '),address.country,order.email].filter(Boolean);
 for(const value of details)paragraph(value,360,10,navy);y-=17;tableHeader();
 for(const item of items){
  const lines=wrap(item.product_name,276,10,bold);if(item.sku)lines.push(...wrap('SKU: '+item.sku,276,8));
  for(let i=0;i<Math.max(lines.length,1);i++){
   if(y<112){newPage();tableHeader();}
   text(lines[i]||'',54,y,lines[i]?.startsWith('SKU:')?8:10,lines[i]?.startsWith('SKU:')?font:bold);
   if(i===0){right(String(item.quantity),356,y);right(money(item.unit_price),455,y);right(money(item.line_total),558,y,10,bold);}
   y-=16;
  }
  y-=8;page.drawLine({start:{x:44,y},end:{x:568,y},thickness:.5,color:rule});y-=22;
 }
 const totals=[['Subtotal',order.subtotal],['Shipping',order.shipping_amount]];
 for(const [name,key] of [['Insurance','insurance_amount'],['Payment fee','payment_surcharge'],['Tax','tax_amount']])if(order[key]!=null&&Number(order[key])!==0)totals.push([name,order[key]]);
 ensure(totals.length*22+66);y-=4;
 for(const [name,value] of totals){text(name,344,y,10,font,muted);right(money(value),558,y,10);y-=22;}
 page.drawRectangle({x:330,y:y-25,width:238,height:42,color:pale});text('TOTAL USD',344,y-9,10,bold);right(money(order.total),558,y-9,17,bold);y-=60;
 ensure(78);paragraph('Thank you for choosing Gold On The Spot.',524,11,navy);y-=5;
 paragraph('This invoice reflects the stored order and its current payment status. An unpaid invoice is not proof of payment. Refunds and cancellations are shown separately from fulfillment.');
 paragraph('For bank-wire instructions, sign in and open this order. Questions? support@goldonthespot.com');
 for(const [i,p] of doc.getPages().entries()){page=p;page.drawLine({start:{x:44,y:51},end:{x:568,y:51},thickness:.5,color:rule});text('goldonthespot.com',44,34,8,font,muted);right(`${order.order_number}  |  Page ${i+1} of ${doc.getPageCount()}`,568,34,8,font,muted);}
 return doc.save();
}
