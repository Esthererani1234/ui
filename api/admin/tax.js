import {saveEvidence} from "../../server/tax/evidence.js";
import {json,readJson,requireAdmin,service} from '../../server/lib/payments.js';
import {rateLimit,securityLog} from '../../server/lib/security.js';
import {date,dayNow,jurisdiction,ledgerCsv,rpc,validateVersion} from '../../server/tax/admin.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed'});
  try{
    const user=await requireAdmin(req),db=service();await rateLimit(db,'tax_admin',user.id,120,600);
    if(req.method==='GET'){
      const day=dayNow(),from=date(req.query.from||day.slice(0,4)+'-01-01'),to=date(req.query.to||day);
      if(from>to)return json(res,400,{error:'Invalid period.'});
      if(req.query.state){
        const state=jurisdiction(req.query.state);
        if(req.query.format==='csv'){
          const rows=await rpc(db,'tax_report_rows',{p_state:state,p_from:from,p_to:to});
          res.status(200).setHeader('cache-control','no-store').setHeader('content-type','text/csv; charset=utf-8').setHeader('content-disposition','attachment; filename="tax-'+state+'-'+from+'-'+to+'.csv"');return res.end(ledgerCsv(rows));
        }
        if(req.query.document){
          const path=await rpc(db,'tax_document_path',{p_id:req.query.document,p_state:state});
          if(!path)return json(res,404,{error:'Document unavailable.'});
          const {data,error}=await db.storage.from('tax-compliance-private').createSignedUrl(path,60,{download:true});
          if(error)throw Error();return json(res,200,{url:data.signedUrl});
        }
        const [profile,documents]=await Promise.all([rpc(db,'tax_state_profile',{p_state:state,p_day:to}),rpc(db,'tax_documents_for_state',{p_state:state})]);
        return json(res,200,{...profile,documents});
      }
      return json(res,200,await rpc(db,'tax_admin_overview',{p_from:from,p_to:to}));
    }
    const {state,action,data}=await readJson(req,2900000);jurisdiction(state);
    const actor={p_actor:user.id,p_state:state};
    if(action==='evidence')await saveEvidence(db,user.id,state,data);
    else if(action==='version'){
      validateVersion(state,data);
      await rpc(db,'tax_publish_version',{...actor,p_kind:data.kind,p_subject:data.subject,p_data:data.data,p_source:data.source,p_start:data.start,p_end:data.end,p_verified:data.verified,p_approval:data.approval});
    }else if(action==='refund'){
      await rpc(db,'tax_refund_entry',{...actor,p_order:data.order,p_reference:data.reference,p_date:date(data.date),p_merchandise:data.merchandise,p_exempt:data.exempt,p_taxable:data.taxable,p_components:JSON.parse(data.components)});
    }else if(action==='external'){
      await rpc(db,'tax_import_sale',{...actor,p_reference:data.reference,p_channel:data.channel,p_date:date(data.date),p_merchandise:data.merchandise,p_exempt:data.exempt,p_taxable:data.taxable,p_tax:data.tax});
    }else await rpc(db,'tax_admin_change',{...actor,p_action:action,p_data:data});
    return json(res,200,{saved:true});
  }catch(e){securityLog('tax_admin_failed',e);return json(res,e.status||503,{error:e.status?e.message:'Compliance data is temporarily unavailable.'});}
}
