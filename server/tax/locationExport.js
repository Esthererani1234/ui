import wa from './washingtonQuarter.json' with {type:'json'};
import vt from './vermontQuarter.json' with {type:'json'};
import nm from './newMexicoLocations.json' with {type:'json'};
import {hawaiiCounties,hawaiiRetail,hawaiiSource} from './hawaii.js';

// Published geographic rates for review. Seller registration and product exemptions are evaluated at checkout.
export function locationCsv(){
  const rows=[['State','Reporting area','County','Location code','Tax type','State %','Local %','Combined %','Maximum pass-on %','Effective from','Through','Qualification','Source']];
  const pct=ppm=>(ppm/10000).toFixed(4);
  for(const [code,[state,local,start,end,county,name]] of Object.entries(wa.rates)){
    rows.push(['WA',name,county,code,'Retail sales',pct(state),pct(local),pct(state+local),'',start,end,'',wa.rates_url]);
  }
  for(const [code,[name,local]] of Object.entries(vt.municipalities)){
    rows.push(['VT',name,'',code,'Retail sales',pct(60000),pct(local),pct(60000+local),'',vt.from,vt.through,'Quarterly snapshot',vt.source]);
  }
  for(const row of nm.locations){
    const codes=row.code?[row.code]:row.tribal_codes;
    for(const [index,code] of codes.entries()){
      const rate=index===1 && row.class2_ppm?row.class2_ppm:row.ppm;
      const qualification=[row.code?'':'Tribal reporting class '+(index+1),row.note?'Schedule footnote '+row.note:''].filter(Boolean).join(' / ');
      rows.push(['NM',row.name,row.county,code,'Gross receipts','','',pct(rate),'',nm.valid_from,nm.valid_until,qualification,nm.source]);
    }
  }
  const hi=hawaiiRetail;
  for (const [code,county] of Object.entries(hawaiiCounties)){
    rows.push(['HI',county.name,county.name,code,'Retail general excise',pct(hi.state),pct(hi.county),pct(hi.state+hi.county),pct(hi.maxPassOn),county.from,hi.through,'Customer pass-on optional',hawaiiSource]);
  }
  rows.push(['HI','Kalawao County','Kalawao County','15005','Retail general excise','','','','','','','Separate county treatment needs verification',hawaiiSource]);
  return rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
