export default async function preparePhoto(file) {
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPEG, PNG, or WebP photo under 10 MB.');
 const url=URL.createObjectURL(file);
 try {
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  // Re-encoding removes camera metadata, including embedded location information.
  const data=canvas.toDataURL('image/jpeg',.82).split(',')[1];
  if(!data||data.length>1398104)throw new Error('This photo is too large. Choose a smaller image.');
  return data;
 } finally {URL.revokeObjectURL(url);}
}
