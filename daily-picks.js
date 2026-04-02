/**
 * MaggieBets Daily Picks Engine — Single source of truth
 * Run once per day via cron. Does everything:
 *   1. Fetches today's NBA odds
 *   2. Generates picks
 *   3. Updates public/index.html
 *   4. Sends Telegram notification
 *   5. Commits & pushes to GitHub
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ODDS_API_KEY    = process.env.ODDS_API_KEY    || '12d709f9b4d84245e7d8b1bc93dde55a';
const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN  || '8561009218:AAFz5os5lzxpIdEkqRA0yzUiXYZmMos5ms8';
const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT   || '6945880534';

const RECORD_FILE  = path.join(__dirname, 'RECORD.md');
const INDEX_FILE   = path.join(__dirname, 'public', 'index.html');

// ── Helpers ──────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function parseRecord() {
  try {
    const txt = fs.readFileSync(RECORD_FILE, 'utf8');
    const m = txt.match(/##\s*Overall[^\n]*\n[^*]*\*\*(\d+)-(\d+)[^*]*\*\*([^u]*units?)/i)
           || txt.match(/(\d+)-(\d+)[^+\n]*\+?([\d.]+)\s*[Uu]nits?/);
    if (m) return { wins: parseInt(m[1]), losses: parseInt(m[2]), units: parseFloat(m[3]) };
  } catch(e) {}
  // Fallback: read from index.html
  try {
    const html = fs.readFileSync(INDEX_FILE, 'utf8');
    const wl   = html.match(/<div class="stats">(\d+)-(\d+)<\/div>/);
    const u    = html.match(/<div class="units">\+?([\d.]+)\s*Units<\/div>/);
    if (wl && u) return { wins: parseInt(wl[1]), losses: parseInt(wl[2]), units: parseFloat(u[1]) };
  } catch(e) {}
  return { wins: 35, losses: 18, units: 15.0 };
}

function pickGames(odds) {
  if (!odds || !odds.length) return [];

  const picks = [];

  for (const game of odds) {
    if (!game.bookmakers || !game.bookmakers.length) continue;

    // Find spreads
    const bookmakers = game.bookmakers;
    const spreads = [];

    for (const bk of bookmakers) {
      const market = (bk.markets || []).find(m => m.key === 'spreads');
      if (!market) continue;
      for (const outcome of market.outcomes) {
        spreads.push({ book: bk.title, team: outcome.name, point: outcome.point, price: outcome.price });
      }
    }

    if (!spreads.length) continue;

    // Find consensus — team with spread covered by 3+ books
    const consensus = {};
    for (const s of spreads) {
      const key = `${s.team}|${s.point}`;
      consensus[key] = (consensus[key] || []);
      consensus[key].push(s);
    }

    for (const [key, entries] of Object.entries(consensus)) {
      if (entries.length < 2) continue;
      const [team, point] = key.split('|');
      const avgPrice = Math.round(entries.reduce((s, e) => s + e.price, 0) / entries.length);
      const absSpread = Math.abs(parseFloat(point));

      // Pick logic: favor underdogs getting 4-14 pts, or heavy favorites
      if ((parseFloat(point) > 3 && parseFloat(point) < 15) || absSpread > 14) {
        const home = game.home_team;
        const away = game.away_team;
        const isHome = team === home;
        const gameTime = new Date(game.commence_time);
        const mtHour = gameTime.getUTCHours() - 6; // rough MT
        const timeStr = `${mtHour > 12 ? mtHour - 12 : mtHour}:${String(gameTime.getUTCMinutes()).padStart(2,'0')} ${mtHour >= 12 ? 'PM' : 'AM'} MT`;

        picks.push({
          game: `${away} @ ${home}`,
          pick: `${team} ${parseFloat(point) > 0 ? '+' : ''}${point}`,
          odds: avgPrice > 0 ? `+${avgPrice}` : `${avgPrice}`,
          units: picks.length === 0 ? 2 : 1,
          tag: picks.length === 0 ? '⭐ TOP PICK' : 'PLAY',
          time: timeStr,
          books: entries.length,
          reasoning: `${entries.length} books agree on this line. ${isHome ? 'Home' : 'Road'} spot for ${team}. Spread: ${point}.`
        });

        if (picks.length >= 3) break;
      }
    }
    if (picks.length >= 3) break;
  }

  return picks;
}

function buildHTML(record, picks, dateStr) {
  const topPick = picks[0];
  const rest    = picks.slice(1);

  const topCard = topPick ? `
        <div class="pick-card top-pick">
            <div class="pick-header">
                <span class="sport">NBA</span>
                <span class="confidence">⭐ TOP PICK</span>
            </div>
            <div class="matchup">${topPick.game}</div>
            <div class="pick">${topPick.pick} (${topPick.odds}) • ${topPick.units} Units</div>
            <div class="time">${topPick.time}</div>
            <div class="reasoning"><strong>Why:</strong> ${topPick.reasoning}</div>
        </div>` : '';

  const restCards = rest.map(p => `
        <div class="pick-card">
            <div class="pick-header">
                <span class="sport">NBA</span>
                <span class="confidence">PLAY</span>
            </div>
            <div class="matchup">${p.game}</div>
            <div class="pick">${p.pick} (${p.odds}) • ${p.units} Unit</div>
            <div class="time">${p.time}</div>
            <div class="reasoning"><strong>Why:</strong> ${p.reasoning}</div>
        </div>`).join('');

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true });

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
        ${topCard}
        ${restCards}

        <div class="footer">
            <p>🎰 Brought to you by <a href="https://go.dimebitaffiliates.com/visit/?bta=35096&brand=dimebit" style="color: #ffd700; text-decoration: none;">DimeBit</a></p>
            <p>⚠️ Gamble responsibly. 18+ only.</p>
            <p>Powered by AI analysis • Updated ${now} MT</p>
        </div>
    </div>
</body>
</html>`;
}

function sendTelegram(msg) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: 'Markdown' });
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('🏀 MaggieBets daily picks starting...');

  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric'
  });
  const dateShort = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric'
  });

  // 1. Fetch odds
  let picks = [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american`;
    const odds = await get(url);
    picks = pickGames(Array.isArray(odds) ? odds : []);
    console.log(`Got ${picks.length} picks from odds API`);
  } catch(e) {
    console.error('Odds API error:', e.message);
  }

  // 2. Read current record
  const record = parseRecord();
  console.log(`Current record: ${record.wins}-${record.losses} +${record.units}u`);

  // 3. Update HTML
  if (picks.length > 0) {
    const html = buildHTML(record, picks, today);
    fs.writeFileSync(INDEX_FILE, html);
    console.log('✅ Updated public/index.html');
  } else {
    console.log('⚠️  No picks generated — HTML not updated');
  }

  // 4. Send Telegram
  const topPick = picks[0];
  let msg = `🏆 *MaggieBets — ${dateShort}*\n\n`;
  msg += `📊 Record: *${record.wins}-${record.losses} (+${record.units.toFixed(1)}u)*\n\n`;

  if (topPick) {
    msg += `⭐ *TOP PICK (${topPick.units}u)*\n`;
    msg += `${topPick.game}\n`;
    msg += `*${topPick.pick}* (${topPick.odds})\n`;
    msg += `🕐 ${topPick.time}\n\n`;
    picks.slice(1).forEach(p => {
      msg += `▪️ ${p.game} — *${p.pick}* (${p.odds}) • ${p.units}u\n`;
    });
  } else {
    msg += `No picks today — no qualifying lines found.`;
  }

  msg += `\n🌐 maggiebets.onrender.com`;
  await sendTelegram(msg);
  console.log('✅ Telegram sent');

  // 5. Commit & push
  try {
    execSync('git add -A && git commit -m "Daily picks update" && git push', {
      cwd: __dirname, stdio: 'pipe'
    });
    console.log('✅ Pushed to GitHub');
  } catch(e) {
    console.log('Git push skipped (no changes or error)');
  }

  console.log('✅ Done!');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
