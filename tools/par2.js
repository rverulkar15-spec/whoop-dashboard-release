const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});const p=await b.newPage();
await p.goto('file://'+process.argv[2]+'/edge/full/whoop_dashboard.html');await p.waitForTimeout(600);
console.log(await p.evaluate(()=>{const A=M.anchor;const c=a=>M.workouts.filter(w=>w.di>=a&&w.di<=a+27&&sIsTrain(w)).length;return [c(A-27),c(A-55)]}));
await b.close()})();
