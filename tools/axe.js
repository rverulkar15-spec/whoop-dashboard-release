const { chromium } = require('playwright'); const fs=require('fs');
const axe=fs.readFileSync(process.argv[3],'utf8');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
for(const theme of ['dark','light']){const p=await b.newPage({viewport:{width:430,height:900}});await p.goto('file://'+process.argv[2]);await p.waitForTimeout(600);
await p.evaluate(t=>{try{setTheme(t)}catch(e){}},theme);
const seen={};
for(const tab of ['today','story','training','sleep','progress','goals','more']){await p.evaluate(t=>{location.hash='#'+t},tab);await p.waitForTimeout(200);await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
await p.addScriptTag({content:axe});
const r=await p.evaluate(async()=>{const x=await axe.run(document,{runOnly:['wcag2a','wcag2aa'],resultTypes:['violations']});return x.violations.map(v=>({id:v.id,n:v.nodes.length,ex:v.nodes.slice(0,2).map(n=>n.target.join(' ')+' :: '+(n.any[0]&&n.any[0].message||'').slice(0,110))}))});
r.forEach(v=>{const k=theme+' '+tab+' '+v.id;seen[k]=v})}
Object.keys(seen).forEach(k=>console.log(k,seen[k].n,JSON.stringify(seen[k].ex)));
}
await b.close()})();
