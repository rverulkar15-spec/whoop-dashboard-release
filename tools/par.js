const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});const p=await b.newPage();
await p.goto('file://'+process.argv[2]+'/edge/full/whoop_dashboard.html');await p.waitForTimeout(600);
console.log(await p.evaluate(()=>{const A=M.anchor;const o={};['recovery','hrv','rhr','asleep','perf','strain'].forEach(k=>{const v=valsIn(M,k,A-27,A),w=valsIn(M,k,A-55,A-28);o[k]=[+mean(v).toFixed(2),v.length,+mean(w).toFixed(2),w.length]});o.anchor=A;return JSON.stringify(o)}));
await b.close()})();
