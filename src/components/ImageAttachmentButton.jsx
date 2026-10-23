import {useRef} from 'react';
import {Plus} from 'lucide-react';
export default function ImageAttachmentButton({onChange,disabled=false}) {
 const input=useRef(null);
 return <div className="image-attachment-control">
  <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={onChange} disabled={disabled} hidden aria-label="Choose a JPEG, PNG, or WebP image"/>
  <button type="button" className="button button-outline" disabled={disabled} onClick={()=>input.current?.click()}><Plus size={18} aria-hidden="true"/> Attach image</button>
 </div>;
}
