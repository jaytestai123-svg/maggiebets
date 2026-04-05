/**
 * MaggieBets Daily Picks Engine — Single source of truth
 * Runs at 10 AM MT daily via cron:
 *   1. Settle yesterday's picks against real scores
 *   2. Update record in RECORD.md + index.html
 *   3. Fetch today's odds + generate picks
 *   4. Update public/index.html
 *   5. Send one Telegram message to MaggieBets bot
 *   6. Commit & push to GitHub
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ODDS_API_KEY   = process.env.ODDS_API_KEY  || '12d709f9b4d84245e7d8b1bc93dde55a';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8594045165:AAFrMyWjnnosa6B3jk0ibdhIeAcVp-yx3Wk';
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT  || '6945880534';

const RECORD_FILE    = path.join(__dirname, 'RECORD.md');
const INDEX_FILE     = path.join(__dirname, 'public', 'index.html');
const PICKS_FILE     = path.join(__dirname, 'picks-data.json');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed')); }
      });
    }).on('error', reject);
  });
}

// ── Read/write record ─────────────────────────────────────────────────────────
function parseRecord() {
  try {
    const html = fs.readFileSync(INDEX_FILE, 'utf8');
    const wl = html.match(/<div class="stats">(\d+)-(\d+)<\/div>/);
    const u  = html.match(/<div class="units">\+?([\d.]+)\s*Units<\/div>/);
    if (wl && u) return { wins: parseInt(wl[1]), losses: parseInt(wl[2]), units: parseFloat(u[1]) };
  } catch(e) {}
  try {
    const txt = fs.readFileSync(RECORD_FILE, 'utf8');
    const m = txt.match(/(\d+)-(\d+)[^+\n]*\+?([\d.]+)\s*[Uu]nits?/);
    if (m) return { wins: parseInt(m[1]), losses: parseInt(m[2]), units: parseFloat(m[3]) };
  } catch(e) {}
  return { wins: 35, losses: 18, units: 15.0 };
}

function saveRecord(record) {
  try {
    let txt = fs.readFileSync(RECORD_FILE, 'utf8');
    txt = txt.replace(/## Season Record:.*/, `## Season Record: ${record.wins}-${record.losses} (+${record.units.toFixed(1)} Units)`);
    fs.writeFileSync(RECORD_FILE, txt);
  } catch(e) {}
}

// ── Load yesterday's picks ────────────────────────────────────────────────────
function loadYesterdayPicks() {
  try {
    const d = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
    const picks = [d.betOfDay, ...(d.picks || [])].filter(Boolean);
    // Deduplicate by game+pick
    const seen = new Set();
    return picks.filter(p => {
      const key = `${p.game}|${p.pick}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch(e) { return []; }
}

// ── Fetch ESPN scores for a date (YYYYMMDD) ───────────────────────────────────
async function fetchScores(dateStr) {
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`);
    const games = {};
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const homeScore = parseInt(home.score || 0);
      const awayScore = parseInt(away.score || 0);
      const homeName  = home.team.displayName;
      const awayName  = away.team.displayName;
      // Index by both team names for easy lookup
      games[homeName] = { homeScore, awayScore, homeName, awayName };
      games[awayName] = { homeScore, awayScore, homeName, awayName };
    }
    return games;
  } catch(e) {
    console.error('Score fetch error:', e.message);
    return {};
  }
}

// ── Settle one pick against scores ───────────────────────────────────────────
function settlePick(pick, scores) {
  if (pick.sport === 'NHL') return null; // skip NHL for now

  // Parse: "Team Name -7.5" or "Team Name +3"
  const m = pick.pick.match(/^(.+?)\s+([+-][\d.]+)$/);
  if (!m) return null;

  const team   = m[1].trim();
  const spread = parseFloat(m[2]);
  const units  = pick.units || 1;

  const game = scores[team];
  if (!game) return null; // game not found

  const isHome = game.homeName === team;
  const teamScore  = isHome ? game.homeScore : game.awayScore;
  const oppScore   = isHome ? game.awayScore : game.homeScore;
  const margin     = teamScore - oppScore; // positive = team won

  // Apply spread: team covers if (margin + spread) > 0
  const coverMargin = margin + spread;

  if (coverMargin > 0)  return { result: 'WIN',  units: +units };
  if (coverMargin < 0)  return { result: 'LOSS', units: -units };
  return { result: 'PUSH', units: 0 };
}

// ── Generate picks from odds ──────────────────────────────────────────────────
function generatePicks(odds) {
  if (!odds || !odds.length) return [];
  const picks = [];

  for (const game of odds) {
    if (!game.bookmakers?.length) continue;
    const spreads = [];

    for (const bk of game.bookmakers) {
      const market = (bk.markets || []).find(m => m.key === 'spreads');
      if (!market) continue;
      for (const o of market.outcomes) {
        spreads.push({ team: o.name, point: o.point, price: o.price });
      }
    }
    if (spreads.length < 2) continue;

    // Find consensus lines
    const consensus = {};
    for (const s of spreads) {
      const key = `${s.team}|${s.point}`;
      if (!consensus[key]) consensus[key] = [];
      consensus[key].push(s);
    }

    for (const [key, entries] of Object.entries(consensus)) {
      if (entries.length < 2) continue;
      const [team, point] = key.split('|');
      const pt = parseFloat(point);
      const avgPrice = Math.round(entries.reduce((s, e) => s + e.price, 0) / entries.length);
      const absSpread = Math.abs(pt);

      if (absSpread >= 3 && absSpread <= 18) {
        const gameTime  = new Date(game.commence_time);
        const mtHour    = ((gameTime.getUTCHours() - 6) + 24) % 24;
        const ampm      = mtHour >= 12 ? 'PM' : 'AM';
        const hour12    = mtHour > 12 ? mtHour - 12 : (mtHour === 0 ? 12 : mtHour);
        const timeStr   = `${hour12}:${String(gameTime.getUTCMinutes()).padStart(2,'0')} ${ampm} MT`;

        picks.push({
          sport: 'NBA',
          game: `${game.away_team} @ ${game.home_team}`,
          pick: `${team} ${pt > 0 ? '+' : ''}${point}`,
          odds: avgPrice > 0 ? `+${avgPrice}` : `${avgPrice}`,
          units: picks.length === 0 ? 2 : 1,
          tag: picks.length === 0 ? '⭐ TOP PICK' : 'PLAY',
          time: timeStr,
          reasoning: `${entries.length}-book consensus at ${point}. ${team} ${pt > 0 ? 'getting' : 'laying'} ${absSpread} points.`
        });
        if (picks.length >= 3) break;
      }
    }
    if (picks.length >= 3) break;
  }
  return picks;
}

// ── Build HTML ────────────────────────────────────────────────────────────────
function buildHTML(record, picks, dateStr, settlements) {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true
  });

  const settleSummary = settlements.length
    ? `<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:0.82rem;color:#9ca3af;line-height:1.8">
        <strong style="color:#ffd700">Yesterday's Results:</strong><br>
        ${settlements.map(s =>
          `${s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '➖'} ${s.pick} — ${s.result} (${s.units > 0 ? '+' : ''}${s.units}u)`
        ).join('<br>')}
      </div>` : '';

  const cards = picks.map((p, i) => `
        <div class="pick-card${i === 0 ? ' top-pick' : ''}">
            <div class="pick-header">
                <span class="sport">${p.sport}</span>
                <span class="confidence">${i === 0 ? '⭐ TOP PICK' : 'PLAY'}</span>
            </div>
            <div class="matchup">${p.game}</div>
            <div class="pick">${p.pick} (${p.odds}) • ${p.units} Unit${p.units > 1 ? 's' : ''}</div>
            <div class="time">${p.time}</div>
            <div class="reasoning"><strong>Why:</strong> ${p.reasoning}</div>
        </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MaggieBets - Daily Picks</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #fff; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        header { text-align: center; margin-bottom: 30px; padding: 20px; background: linear-gradient(90deg, #e94560, #ff6b6b); border-radius: 15px; }
        h1 { font-size: 2rem; font-weight: 700; }
        .subtitle { opacity: 0.9; font-size: 0.9rem; }
        .record { text-align: center; background: rgba(255,255,255,0.1); padding: 15px; border-radius: 10px; margin-bottom: 25px; }
        .record h2 { font-size: 1.1rem; margin-bottom: 5px; }
        .record .stats { font-size: 1.8rem; font-weight: 700; color: #4ade80; }
        .record .units { font-size: 1rem; color: #86efac; }
        .pick-card { background: rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; margin-bottom: 15px; border-left: 4px solid #e94560; }
        .pick-card.top-pick { border-left-color: #ffd700; background: linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,255,255,0.08)); }
        .pick-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .sport { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: #e94560; }
        .confidence { font-size: 0.75rem; padding: 4px 10px; border-radius: 20px; background: #ffd700; color: #1a1a2e; font-weight: 600; }
        .matchup { font-size: 1.2rem; font-weight: 600; margin-bottom: 8px; }
        .pick { font-size: 1.1rem; color: #4ade80; font-weight: 600; }
        .reasoning { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-top: 12px; font-size: 0.9rem; color: #d1d5db; line-height: 1.5; }
        .reasoning strong { color: #ffd700; }
        .time { font-size: 0.8rem; color: #9ca3af; margin-top: 8px; }
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🏆 MaggieBets</h1>
            <p class="subtitle">Daily Sports Picks</p>
        </header>
        <div class="record">
            <h2>Season Record</h2>
            <div class="stats">${record.wins}-${record.losses}</div>
            <div class="units">+${record.units.toFixed(1)} Units</div>
        </div>
        <h3 style="margin-bottom: 15px; color: #9ca3af;">Today's Picks — ${dateStr}</h3>
        ${settleSummary}
        ${cards || '<p style="color:#9ca3af;text-align:center;padding:20px">No picks today — check back tomorrow.</p>'}
        <div class="footer">
            <p>🎰 Brought to you by <a href="https://go.dimebitaffiliates.com/visit/?bta=35096&brand=dimebit" style="color: #ffd700; text-decoration: none;">DimeBit</a></p>
            <p>⚠️ Gamble responsibly. 18+ only.</p>
            <p>Powered by AI analysis • Updated ${now} MT</p>
        </div>
    </div>
</body>
</html>`;
}

// ── Telegram ──────────────────────────────────────────────────────────────────
function sendTelegram(msg) {
  return new Promise(resolve => {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: 'Markdown' });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => { res.on('data', ()=>{}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(body); req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('🏀 MaggieBets daily picks starting...');

  const now       = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const yStr      = yesterday.toISOString().slice(0,10).replace(/-/g,''); // YYYYMMDD
  const today     = now.toLocaleDateString('en-US', { timeZone:'America/Denver', month:'long', day:'numeric', year:'numeric' });
  const dateShort = now.toLocaleDateString('en-US', { timeZone:'America/Denver', month:'short', day:'numeric' });

  // 1. Load yesterday's picks + fetch scores to settle
  let record = parseRecord();
  console.log(`Starting record: ${record.wins}-${record.losses} +${record.units}u`);

  const yesterdayPicks = loadYesterdayPicks();
  const settlements    = [];

  if (yesterdayPicks.length) {
    console.log(`Settling ${yesterdayPicks.length} picks from yesterday...`);
    const scores = await fetchScores(yStr);
    console.log(`Got scores for ${Object.keys(scores).length} teams`);

    for (const pick of yesterdayPicks) {
      const result = settlePick(pick, scores);
      if (!result) { console.log(`  SKIP: ${pick.pick} (no score found)`); continue; }

      console.log(`  ${result.result}: ${pick.pick} (${result.units > 0 ? '+' : ''}${result.units}u)`);
      settlements.push({ pick: pick.pick, ...result });

      if (result.result === 'WIN')       { record.wins++;   record.units = Math.round((record.units + result.units) * 10) / 10; }
      else if (result.result === 'LOSS') { record.losses++; record.units = Math.round((record.units + result.units) * 10) / 10; }
    }

    if (settlements.length) {
      saveRecord(record);
      console.log(`✅ Updated record: ${record.wins}-${record.losses} +${record.units}u`);
    }
  }

  // 2. Fetch today's odds + generate picks
  let picks = [];
  try {
    const url  = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american`;
    const odds = await get(url);
    picks      = generatePicks(Array.isArray(odds) ? odds : []);
    console.log(`Generated ${picks.length} picks`);
  } catch(e) {
    console.error('Odds API error:', e.message);
  }

  // Save picks for tomorrow's settlement
  if (picks.length) {
    fs.writeFileSync(PICKS_FILE, JSON.stringify({
      date: today,
      lastUpdated: new Date().toISOString(),
      record: `${record.wins}-${record.losses} (+${record.units.toFixed(1)} units)`,
      betOfDay: picks[0],
      picks
    }, null, 2));
  }

  // 3. Update HTML
  const html = buildHTML(record, picks, today, settlements);
  fs.writeFileSync(INDEX_FILE, html);
  console.log('✅ Updated public/index.html');

  // 4. Send Telegram — ONE message
  const wins   = settlements.filter(s => s.result === 'WIN').length;
  const losses = settlements.filter(s => s.result === 'LOSS').length;
  const unitChg = settlements.reduce((sum, s) => sum + s.units, 0);

  let msg = `🏆 *MaggieBets — ${dateShort}*\n`;
  msg += `📊 Record: *${record.wins}-${record.losses} (+${record.units.toFixed(1)}u)*\n`;

  if (settlements.length) {
    msg += `\n*Yesterday:* ${wins}W-${losses}L (${unitChg >= 0 ? '+' : ''}${unitChg.toFixed(1)}u)\n`;
    settlements.forEach(s => {
      msg += `${s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '➖'} ${s.pick}\n`;
    });
  }

  if (picks.length) {
    msg += `\n*Today's Picks:*\n`;
    picks.forEach((p, i) => {
      msg += `${i === 0 ? '⭐' : '▪️'} ${p.game}\n   *${p.pick}* (${p.odds}) • ${p.units}u\n`;
    });
  } else {
    msg += `\nNo qualifying picks today.\n`;
  }
  msg += `\n🌐 maggiebets.onrender.com`;

  await sendTelegram(msg);
  console.log('✅ Telegram sent');

  // 5. Commit & push
  try {
    execSync('git add -A && git commit -m "Daily update: settle results + new picks" && git push', {
      cwd: __dirname, stdio: 'pipe'
    });
    console.log('✅ Pushed to GitHub');
  } catch(e) {
    console.log('Git: nothing to push or error');
  }

  console.log('✅ Done!');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
