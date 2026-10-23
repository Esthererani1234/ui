import {useRef,useState} from 'react';
import ImageAttachmentButton from './ImageAttachmentButton';
import preparePhoto from '../lib/preparePhoto';
import {supabase} from '../lib/supabase';
import {invokeFunction} from '../lib/functionRequest';
import '../styles/caseImageDraft.css';

export function useDraftCaseImages(kind){
 const [photos,setPhotos]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const current=useRef([]),target=useRef(null),working=useRef(false),generation=useRef(0);
 const update=list=>{current.current=list;setPhotos(list)};
 function reset(){generation.current++;target.current=null;update([]);setError('');setSaved(false);}
 async function choose(event){const file=event.target.files?.[0];event.target.value='';if(!file||working.current)return;if(current.current.length>=6){setError('You can attach up to six images.');return;}working.current=true;setBusy(true);setError('');const run=generation.current;try{const photo=await preparePhoto(file);if(run===generation.current)update([...current.current,{id:crypto.randomUUID(),photo,name:file.name.slice(0,100),done:false}]);}catch(e){if(run===generation.current)setError(e.message);}finally{working.current=false;setBusy(false);}}
 async function upload(destination=target.current){
  if(working.current||!destination)return;target.current=destination;setSaved(true);if(!current.current.some(p=>!p.done))return;
  working.current=true;setBusy(true);setError('');const run=generation.current;
  try{
   let id=destination;
   if(kind==='selling'&&typeof destination==='object'){
    const data=await invokeFunction(supabase,'sell-requests',{action:'mine',offset:0});
    id=data.requests?.find(row=>row.reference===destination.reference)?.id;
    if(!id)throw new Error('Could not find the saved case.');
    target.current=id;
   }
   for(const photo of current.current.filter(p=>!p.done)){
    if(run!==generation.current)return;
    await invokeFunction(supabase,kind==='selling'?'sell-case-thread':'support-case-photos',{action:'send',case_id:id,request_id:photo.id,message:'',photo:photo.photo},{timeout:25000});
    if(run===generation.current)update(current.current.map(p=>p.id===photo.id?{...p,done:true}:p));
   }
  }catch{if(run===generation.current)setError('Your case is saved, but some images were not confirmed. Retry images below; this will not create another case.');}
  finally{working.current=false;setBusy(false);}
 }
 return {photos,busy,error,saved,choose,upload,reset,remove:id=>update(current.current.filter(p=>p.id!==id))};
}
export default function DraftCaseImages({draft,disabled=false}){
 const remaining=draft.photos.some(p=>!p.done);
 return <section className="case-image-draft" aria-label="Images for this request">
  <div className="case-image-heading"><b>Images <span>(optional)</span></b>{!draft.saved&&<ImageAttachmentButton onChange={draft.choose} disabled={disabled||draft.busy||draft.photos.length>=6}/>}</div>
  <small>JPEG, PNG or WebP, up to 10 MB each. Up to 6 images. Photos are resized and location metadata removed. No IDs or payment details.</small>
  <div className="case-image-grid">{draft.photos.map(photo=><div className="case-image-tile" key={photo.id}><img src={'data:image/jpeg;base64,'+photo.photo} alt={photo.name}/><span>{photo.done?'Attached':photo.name}</span>{!draft.saved&&<button type="button" className="text-button" disabled={disabled||draft.busy} onClick={()=>draft.remove(photo.id)}>Remove</button>}</div>)}</div>
  {draft.busy&&<p role="status">{draft.saved?'Attaching images…':'Preparing image…'}</p>}
  {draft.error&&<p role="alert" className="form-message error">{draft.error}</p>}
  {draft.saved&&remaining&&!draft.busy&&<button type="button" className="button button-outline" onClick={()=>draft.upload()}>Retry images</button>}
  {draft.saved&&draft.photos.length>0&&!remaining&&<p role="status">All images attached to your case.</p>}
 </section>;
}
