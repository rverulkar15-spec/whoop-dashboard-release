const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  for (const n of process.argv.slice(3)) {
    const out = [];
    for (const w of [1200, 390]) {
      const p = await b.newPage({ viewport: { width: w, height: 900 } });
      const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0,200)); });
      await p.goto('file://' + process.argv[2] + '/' + n + '/whoop_dashboard.html'); await p.waitForTimeout(700);
      let all = '';
      for (const tab of ['today','story','training','sleep','progress','goals','more']) { await p.evaluate(t => { location.hash = '#' + t; }, tab); await p.waitForTimeout(150); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); all += '\n' + await p.evaluate(() => document.body.innerText); }
      const bad = (all.match(/.{30}(NaN|undefined|Infinity|\[object).{20}/g) || []).slice(0,4);
      const ban = (all.match(/could not be drawn[^\n]*/g) || []);
      const dash = (all.match(/ [-–—] /g)||[]).length;
      out.push(`${w}: errs=${JSON.stringify(errs)} bad=${JSON.stringify(bad)} banners=${JSON.stringify(ban)} dashes=${dash} overflow=${await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)}`);
      await p.close();
    }
    console.log('== ' + n + '\n' + out.join('\n'));
  }
  await b.close();
})();
