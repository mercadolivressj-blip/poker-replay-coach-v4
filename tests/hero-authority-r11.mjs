import fs from 'node:fs';

const runtime = fs.readFileSync('src/vision/hero-authority-runtime-r11.js', 'utf8');
const bootstrap = fs.readFileSync('src/bootstrap-r11.js', 'utf8');
const page = fs.readFileSync('r11.html', 'utf8');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

must(bootstrap.includes("hero-authority-runtime-r11.js"), 'R11 bootstrap must load Hero authority lane');
must(!bootstrap.includes('hero-stability-runtime-r10.js'), 'R11 must not load the R10 whole-screen Hero locator');
must(runtime.includes('layout.heroSuitSlots || layout.heroSlots'), 'R11 must restore the proven fixed Hero slot geometry');
must(runtime.includes("ocr.readRank(rankCrop(crop.canvas), 'hero-authority-r11')"), 'R11 must keep OCR rank fallback');
must(runtime.includes('classifyPokerStarsSuitPixels'), 'R11 must use the PokerStars suit scanner');
must(runtime.includes('machine.state.hero = latch.cards.map'), 'R11 authority must restore confirmed Hero state directly');
must(runtime.includes('absentFrames >= 4'), 'R11 must require sustained physical absence before arming a redeal');
must(runtime.includes('candidateHits >= needed'), 'R11 must require temporal agreement before relatching');
must(runtime.includes("['flop', 'turn', 'river'].includes(machine.state.street)"), 'R11 must latch board display inside a street to prevent flicker');
must(page.includes('V4 STANDALONE · R11'), 'R11 page badge missing');
must(page.includes('./src/bootstrap-r11.js'), 'R11 page must load R11 bootstrap');

console.log('HERO AUTHORITY R11 passed');
