/**
 * MaggieBets Daily Picks Engine — Multi-Sport
 * Runs at 10 AM MT daily via cron:
 *   1. Settle yesterday's picks against real scores (NBA, MLB, NHL, NFL)
 *   2. Update record in RECORD.md + index.html
 *   3. Fetch today's odds across all active sports
 *   4. Generate picks with sport-specific logic
 *   5. Update public/index.html
 *   6. Send one Telegram message
 *   7. Commit & push to GitHub
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ODDS_API_KEY   = process.env.ODDS_API_KEY  || '12d709f9b4d84245e7d8b1bc93dde55a';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8594045165:AAFrMyWjnnosa6B3jk0ibdhIeAcVp-yx3Wk';
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT  || '6945880534';

const { rankGamesForPicks, get: apiGet } = require('./analysis');

const RECORD_FILE = path.join(__dirname, 'RECORD.md');
const INDEX_FILE  = path.join(__dirname, 'public', 'index.html');
const PICKS_FILE  = path.join(__dirname, 'picks-data.json');

// ── Sport config ──────────────────────────────────────────────────────────────
// Each sport: odds API key, ESPN path, bet type, spread range
const SPORTS = [
  {
    key:        'baseball_mlb',
    label:      'MLB',
    emoji:      '⚾',
    espnPath:   'baseball/mlb',
    betType:    'moneyline',   // MLB uses moneyline + runline
    altBet:     'spreads',     // runline (1.5)
    spreadMin:  1.4,
    spreadMax:  2.0,
    maxPicks:   2,
  },
  {
    key:        'basketball_nba',
    label:      'NBA',
    emoji:      '🏀',
    espnPath:   'basketball/nba',
    betType:    'spreads',
    spreadMin:  3,
    spreadMax:  18,
    maxPicks:   2,
  },
  {
    key:        'icehockey_nhl',
    label:      'NHL',
    emoji:      '🏒',
    espnPath:   'hockey/nhl',
    betType:    'spreads',     // puck line (1.5)
    spreadMin:  1.4,
    spreadMax:  2.0,
    maxPicks:   1,
  },
  {
    key:        'americanfootball_nfl',
    label:      'NFL',
    emoji:      '🏈',
    espnPath:   'football/nfl',
    betType:    'spreads',
    spreadMin:  2.5,
    spreadMax:  14,
    maxPicks:   1,
  },
];

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`JSON parse failed for ${url}`)); }
      });
    }).on('error', reject);
  });
}

// ── Record helpers ────────────────────────────────────────────────────────────
function parseRecord() {
  try {
    const html = fs.readFileSync(INDEX_FILE, 'utf8');
    const wl = html.match(/<div class="stats">(\d+)-(\d+)<\/div>/);
    const u  = html.match(/<div class="units">[+-]?([\d.]+)\s*Units<\/div>/);
    if (wl && u) return { wins: parseInt(wl[1]), losses: parseInt(wl[2]), units: parseFloat(u[1]) };
  } catch(e) {}
  try {
    const txt = fs.readFileSync(RECORD_FILE, 'utf8');
    const m = txt.match(/(\d+)-(\d+)[^+\n]*\+?([\d.]+)\s*[Uu]nits?/);
    if (m) return { wins: parseInt(m[1]), losses: parseInt(m[2]), units: parseFloat(m[3]) };
  } catch(e) {}
  return { wins: 32, losses: 20, units: 7.5 };
}

function saveRecord(record) {
  try {
    let txt = fs.readFileSync(RECORD_FILE, 'utf8');
    txt = txt.replace(/## Season Record:.*/, `## Season Record: ${record.wins}-${record.losses} (${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)} Units)`);
    fs.writeFileSync(RECORD_FILE, txt);
  } catch(e) { console.error('saveRecord error:', e.message); }
}

// ── Load yesterday's picks ────────────────────────────────────────────────────
function loadYesterdayPicks() {
  try {
    const d = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
    const picks = [d.betOfDay, ...(d.picks || [])].filter(Boolean);
    const seen = new Set();
    return picks.filter(p => {
      const key = `${p.game}|${p.pick}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch(e) { return []; }
}

// ── Fetch ESPN scores for a sport+date ───────────────────────────────────────
async function fetchESPNScores(espnPath, dateStr) {
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${dateStr}`);
    const games = {};
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const completed = comp.status?.type?.completed;
      if (!completed) continue;
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const homeScore = parseFloat(home.score || 0);
      const awayScore = parseFloat(away.score || 0);
      const homeName  = home.team.displayName;
      const awayName  = away.team.displayName;
      const entry = { homeScore, awayScore, homeName, awayName };
      games[homeName] = entry;
      games[awayName] = entry;
      // Also index by short name/abbreviation
      if (home.team.shortDisplayName) games[home.team.shortDisplayName] = entry;
      if (away.team.shortDisplayName) games[away.team.shortDisplayName] = entry;
      if (home.team.abbreviation)     games[home.team.abbreviation]     = entry;
      if (away.team.abbreviation)     games[away.team.abbreviation]     = entry;
    }
    return games;
  } catch(e) {
    console.error(`ESPN score error (${espnPath}):`, e.message);
    return {};
  }
}

// ── Settle one pick ───────────────────────────────────────────────────────────
function settlePick(pick, allScores) {
  // pick.sport tells us which ESPN dataset to use
  const sportCfg = SPORTS.find(s => s.label === pick.sport);
  if (!sportCfg) return null;

  const scores = allScores[sportCfg.label] || {};

  // Parse pick string: "Team Name -1.5" or "Team Name +110" (ML)
  const mSpread = pick.pick.match(/^(.+?)\s+([+-][\d.]+)$/);
  if (!mSpread) return null;

  const team   = mSpread[1].trim();
  const line   = parseFloat(mSpread[2]);
  const units  = pick.units || 1;

  // Find game — try exact match then partial
  let game = scores[team];
  if (!game) {
    const teamLower = team.toLowerCase();
    for (const [k, v] of Object.entries(scores)) {
      if (k.toLowerCase().includes(teamLower) || teamLower.includes(k.toLowerCase())) {
        game = v; break;
      }
    }
  }
  if (!game) return null;

  const isHome    = game.homeName === team || (game.homeName || '').toLowerCase().includes(team.toLowerCase());
  const teamScore = isHome ? game.homeScore : game.awayScore;
  const oppScore  = isHome ? game.awayScore : game.homeScore;
  const margin    = teamScore - oppScore;

  // Moneyline pick (line > 100 or < -100 and no half-point)
  const isML = Math.abs(line) >= 100 && !String(line).includes('.');
  if (isML) {
    if (margin > 0) return { result: 'WIN',  units: line > 0 ? +(units * line / 100).toFixed(2) : +units };
    if (margin < 0) return { result: 'LOSS', units: -units };
    return { result: 'PUSH', units: 0 };
  }

  // Spread / runline / puck line
  const cover = margin + line;
  if (cover > 0)  return { result: 'WIN',  units: +units };
  if (cover < 0)  return { result: 'LOSS', units: -units };
  return { result: 'PUSH', units: 0 };
}

// ── Fetch odds for one sport ──────────────────────────────────────────────────
async function fetchOdds(sportKey, market = 'spreads') {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${market}&oddsFormat=american`;
    const data = await get(url);
    return Array.isArray(data) ? data : [];
  } catch(e) {
    console.error(`Odds fetch error (${sportKey}/${market}):`, e.message);
    return [];
  }
}

// ── Generate picks for one sport ──────────────────────────────────────────────
function generateSportPicks(sportCfg, oddsData) {
  const picks = [];
  if (!oddsData.length) return picks;

  for (const game of oddsData) {
    if (!game.bookmakers?.length) continue;

    const gameTime = new Date(game.commence_time);
    const mtHour   = ((gameTime.getUTCHours() - 6) + 24) % 24;
    const ampm     = mtHour >= 12 ? 'PM' : 'AM';
    const hour12   = mtHour > 12 ? mtHour - 12 : (mtHour === 0 ? 12 : mtHour);
    const timeStr  = `${hour12}:${String(gameTime.getUTCMinutes()).padStart(2,'0')} ${ampm} MT`;

    if (sportCfg.betType === 'moneyline') {
      // MLB moneyline — find best value favourites (-120 to -160) or underdogs (+110 to +160)
      const mlLines = [];
      for (const bk of game.bookmakers) {
        const market = (bk.markets || []).find(m => m.key === 'h2h');
        if (!market) continue;
        for (const o of market.outcomes) mlLines.push({ team: o.name, price: o.price });
      }
      // Group by team
      const byTeam = {};
      for (const l of mlLines) {
        if (!byTeam[l.team]) byTeam[l.team] = [];
        byTeam[l.team].push(l.price);
      }
      for (const [team, prices] of Object.entries(byTeam)) {
        if (prices.length < 2) continue;
        const avg = Math.round(prices.reduce((a,b) => a+b, 0) / prices.length);
        // Sweet spot: favourite -120 to -175 or underdog +115 to +165
        if ((avg >= -175 && avg <= -110) || (avg >= 110 && avg <= 175)) {
          const label = avg > 0 ? `+${avg}` : `${avg}`;
          const isUnderdog = avg > 0;
          picks.push({
            sport:     sportCfg.label,
            game:      `${game.away_team} @ ${game.home_team}`,
            pick:      `${team} ${label}`,
            odds:      label,
            units:     picks.length === 0 ? 1.5 : 1,
            time:      timeStr,
            reasoning: `${prices.length}-book consensus ML ${label}. ${isUnderdog ? 'Value underdog with implied edge.' : 'Solid favourite at reasonable juice.'} ${sportCfg.emoji}`
          });
          if (picks.length >= sportCfg.maxPicks) break;
        }
      }
    } else {
      // Spread / runline / puck line
      const spreadLines = [];
      for (const bk of game.bookmakers) {
        const market = (bk.markets || []).find(m => m.key === 'spreads');
        if (!market) continue;
        for (const o of market.outcomes) spreadLines.push({ team: o.name, point: o.point, price: o.price });
      }
      const consensus = {};
      for (const s of spreadLines) {
        const key = `${s.team}|${s.point}`;
        if (!consensus[key]) consensus[key] = [];
        consensus[key].push(s);
      }
      for (const [key, entries] of Object.entries(consensus)) {
        if (entries.length < 2) continue;
        const [team, point] = key.split('|');
        const pt  = parseFloat(point);
        const abs = Math.abs(pt);
        const avg = Math.round(entries.reduce((s, e) => s + e.price, 0) / entries.length);
        if (abs >= sportCfg.spreadMin && abs <= sportCfg.spreadMax) {
          const label = pt > 0 ? `+${point}` : `${point}`;
          picks.push({
            sport:     sportCfg.label,
            game:      `${game.away_team} @ ${game.home_team}`,
            pick:      `${team} ${label}`,
            odds:      avg > 0 ? `+${avg}` : `${avg}`,
            units:     picks.length === 0 ? 1.5 : 1,
            time:      timeStr,
            reasoning: `${entries.length}-book consensus at ${label}. ${team} ${pt > 0 ? 'getting' : 'laying'} ${abs} ${sportCfg.label === 'MLB' ? 'runs' : sportCfg.label === 'NHL' ? 'goals' : 'points'}. ${sportCfg.emoji}`
          });
          if (picks.length >= sportCfg.maxPicks) break;
        }
      }
    }
    if (picks.length >= sportCfg.maxPicks) break;
  }
  return picks;
}

// ── Build HTML ────────────────────────────────────────────────────────────────
function buildHTML(record, allPicks, dateStr, settlements) {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true
  });

  const sportColors = { NBA: '#e94560', MLB: '#1e88e5', NHL: '#00acc1', NFL: '#43a047' };

  const settleSummary = settlements.length
    ? `<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:0.82rem;color:#9ca3af;line-height:1.9">
        <strong style="color:#ffd700">📋 Yesterday's Results:</strong><br>
        ${settlements.map(s =>
          `${s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '➖'} ${s.pick} — <strong style="color:${s.result==='WIN'?'#4ade80':s.result==='LOSS'?'#f87171':'#9ca3af'}">${s.result}</strong> (${s.units > 0 ? '+' : ''}${s.units}u)`
        ).join('<br>')}
      </div>` : '';

  const sportEmojis = { NBA: '🏀', MLB: '⚾', NHL: '🏒', NFL: '🏈' };

  const cards = allPicks.map((p, i) => {
    const color = sportColors[p.sport] || '#e94560';
    return `
        <div class="pick-card${i === 0 ? ' top-pick' : ''}" style="border-left-color:${color}${i===0?';background:linear-gradient(135deg,rgba(255,215,0,0.12),rgba(255,255,255,0.06))':''}">
            <div class="pick-header">
                <span class="sport" style="color:${color}">${sportEmojis[p.sport]||''} ${p.sport}</span>
                <span class="confidence" style="${i===0?'background:#ffd700;color:#1a1a2e':'background:rgba(255,255,255,0.1);color:#d1d5db'}">${i === 0 ? '⭐ TOP PICK' : 'PLAY'}</span>
            </div>
            <div class="matchup">${p.game}</div>
            <div class="pick">${p.pick} (${p.odds}) • ${p.units} Unit${p.units !== 1 ? 's' : ''}</div>
            <div class="time">${p.time}</div>
            <div class="reasoning"><strong>Why:</strong> ${p.reasoning}</div>
        </div>`;
  }).join('');

  // Sport breakdown summary
  const sportCounts = {};
  allPicks.forEach(p => { sportCounts[p.sport] = (sportCounts[p.sport]||0)+1; });
  const sportBadges = Object.entries(sportCounts).map(([s,c]) =>
    `<span style="background:rgba(255,255,255,0.08);padding:4px 10px;border-radius:20px;font-size:0.75rem;margin:2px">${sportEmojis[s]} ${s} (${c})</span>`
  ).join(' ');

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
        .container { max-width: 620px; margin: 0 auto; }
        header { text-align: center; margin-bottom: 24px; padding: 20px; background: linear-gradient(90deg, #e94560, #ff6b6b); border-radius: 15px; }
        h1 { font-size: 2rem; font-weight: 700; }
        .subtitle { opacity: 0.9; font-size: 0.85rem; margin-top: 4px; }
        .record { text-align: center; background: rgba(255,255,255,0.1); padding: 16px; border-radius: 12px; margin-bottom: 20px; }
        .record h2 { font-size: 1rem; margin-bottom: 6px; color: #9ca3af; }
        .record .stats { font-size: 2rem; font-weight: 700; color: #4ade80; }
        .record .units { font-size: 1rem; color: #86efac; margin-top: 2px; }
        .sport-badges { text-align: center; margin-bottom: 18px; }
        .pick-card { background: rgba(255,255,255,0.07); border-radius: 14px; padding: 18px; margin-bottom: 14px; border-left: 4px solid #e94560; transition: transform 0.1s; }
        .pick-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .sport { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
        .confidence { font-size: 0.72rem; padding: 4px 10px; border-radius: 20px; font-weight: 600; }
        .matchup { font-size: 1.1rem; font-weight: 600; margin-bottom: 6px; }
        .pick { font-size: 1.05rem; color: #4ade80; font-weight: 700; }
        .time { font-size: 0.75rem; color: #9ca3af; margin-top: 6px; }
        .reasoning { background: rgba(255,255,255,0.04); padding: 10px 12px; border-radius: 8px; margin-top: 10px; font-size: 0.85rem; color: #d1d5db; line-height: 1.55; }
        .reasoning strong { color: #ffd700; }
        .footer { text-align: center; margin-top: 28px; color: #6b7280; font-size: 0.78rem; line-height: 1.9; }
        .footer a { color: #ffd700; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🏆 MaggieBets</h1>
            <p class="subtitle">Multi-Sport Daily Picks</p>
        </header>
        <div class="record">
            <h2>Season Record</h2>
            <div class="stats">${record.wins}-${record.losses}</div>
            <div class="units">${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)} Units</div>
        </div>
        ${allPicks.length ? `<div class="sport-badges">${sportBadges}</div>` : ''}
        <h3 style="margin-bottom:14px;color:#9ca3af;font-size:0.9rem;">📅 ${dateStr}</h3>
        ${settleSummary}
        ${cards || '<p style="color:#9ca3af;text-align:center;padding:24px">No qualifying picks today — check back tomorrow.</p>'}
        <div class="footer">
            <p>🎰 Powered by <a href="https://go.dimebitaffiliates.com/visit/?bta=35096&brand=dimebit">DimeBit</a></p>
            <p>⚠️ Gamble responsibly. 18+ only.</p>
            <p>AI analysis • Updated ${now} MT</p>
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
  console.log('🏆 MaggieBets multi-sport picks starting...');

  const now       = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const yStr      = yesterday.toISOString().slice(0,10).replace(/-/g,'');
  const today     = now.toLocaleDateString('en-US', { timeZone:'America/Denver', month:'long', day:'numeric', year:'numeric' });
  const dateShort = now.toLocaleDateString('en-US', { timeZone:'America/Denver', month:'short', day:'numeric' });

  // ── 1. Settle yesterday's picks ──
  let record = parseRecord();
  console.log(`Starting record: ${record.wins}-${record.losses} ${record.units >= 0 ? '+' : ''}${record.units}u`);

  const yesterdayPicks = loadYesterdayPicks();
  const settlements    = [];

  if (yesterdayPicks.length) {
    console.log(`Settling ${yesterdayPicks.length} pick(s) from yesterday...`);

    // Fetch scores for all relevant sports
    const allScores = {};
    for (const sport of SPORTS) {
      allScores[sport.label] = await fetchESPNScores(sport.espnPath, yStr);
      console.log(`  ${sport.label}: ${Object.keys(allScores[sport.label]).length} teams`);
    }

    for (const pick of yesterdayPicks) {
      const result = settlePick(pick, allScores);
      if (!result) { console.log(`  SKIP: ${pick.pick} (no score data)`); continue; }

      console.log(`  ${result.result}: ${pick.pick} (${result.units > 0 ? '+' : ''}${result.units}u)`);
      settlements.push({ pick: pick.pick, ...result });

      if (result.result === 'WIN')       { record.wins++;   record.units = Math.round((record.units + result.units) * 10) / 10; }
      else if (result.result === 'LOSS') { record.losses++; record.units = Math.round((record.units + result.units) * 10) / 10; }
    }

    if (settlements.length) {
      saveRecord(record);
      console.log(`✅ Record updated: ${record.wins}-${record.losses} ${record.units >= 0 ? '+' : ''}${record.units}u`);
    }
  }

  // ── 2. Fetch today's odds + ESPN data, run analysis engine ──
  const allPicks = [];

  for (const sport of SPORTS) {
    try {
      console.log(`  Analyzing ${sport.label}...`);

      // Fetch odds (try both ML and spread for MLB)
      const markets = sport.label === 'MLB' ? ['h2h', 'spreads'] : [sport.betType];
      const oddsPromises = markets.map(m =>
        fetchOdds(sport.key, m).then(d => d.map(g => ({ ...g, _market: m })))
      );
      const oddsArrays = await Promise.all(oddsPromises);
      // Merge: deduplicate by game id
      const oddsMap = {};
      for (const arr of oddsArrays) {
        for (const g of arr) {
          if (!oddsMap[g.id]) oddsMap[g.id] = g;
          else {
            // Merge bookmakers
            const existing = oddsMap[g.id];
            for (const bk of (g.bookmakers || [])) {
              const existBk = existing.bookmakers.find(b => b.key === bk.key);
              if (existBk) existBk.markets.push(...(bk.markets || []));
              else existing.bookmakers.push(bk);
            }
          }
        }
      }
      const oddsData = Object.values(oddsMap);

      // Fetch ESPN scoreboard for team data
      const espnScoreboard = await apiGet(
        `https://site.api.espn.com/apis/site/v2/sports/${sport.espnPath}/scoreboard`
      ).catch(() => null);

      const picks = await rankGamesForPicks(sport, oddsData, espnScoreboard);
      allPicks.push(...picks);
      console.log(`  ${sport.label}: ${picks.length} picks (scores: ${picks.map(p=>p.score).join(', ')})`);
    } catch(e) {
      console.error(`  ${sport.label} error:`, e.message);
    }
  }

  // Global sort: top pick across all sports = highest confidence score
  allPicks.sort((a,b) => b.score - a.score);
  // Re-assign units: #1 overall = 2u, #2-3 = 1.5u, rest = 1u
  allPicks.forEach((p, i) => {
    p.units = i === 0 ? 2 : i <= 2 ? 1.5 : 1;
  });

  console.log(`Total picks today: ${allPicks.length}`);

  // Mark top pick
  if (allPicks.length > 0) allPicks[0].isTop = true;

  // ── 3. Save picks for tomorrow's settlement ──
  if (allPicks.length) {
    fs.writeFileSync(PICKS_FILE, JSON.stringify({
      date:        today,
      lastUpdated: new Date().toISOString(),
      record:      `${record.wins}-${record.losses} (${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)} units)`,
      betOfDay:    allPicks[0],
      picks:       allPicks
    }, null, 2));
  }

  // ── 4. Update HTML ──
  const html = buildHTML(record, allPicks, today, settlements);
  fs.writeFileSync(INDEX_FILE, html);
  console.log('✅ Updated public/index.html');

  // ── 5. Send ONE Telegram message ──
  const wins    = settlements.filter(s => s.result === 'WIN').length;
  const losses  = settlements.filter(s => s.result === 'LOSS').length;
  const unitChg = settlements.reduce((sum, s) => sum + s.units, 0);

  const sportEmojis = { NBA: '🏀', MLB: '⚾', NHL: '🏒', NFL: '🏈' };

  let msg = `🏆 *MaggieBets — ${dateShort}*\n`;
  msg += `📊 Record: *${record.wins}-${record.losses} (${record.units >= 0 ? '+' : ''}${record.units.toFixed(1)}u)*\n`;

  if (settlements.length) {
    msg += `\n*Yesterday:* ${wins}W-${losses}L (${unitChg >= 0 ? '+' : ''}${unitChg.toFixed(1)}u)\n`;
    settlements.forEach(s => {
      msg += `${s.result === 'WIN' ? '✅' : s.result === 'LOSS' ? '❌' : '➖'} ${s.pick}\n`;
    });
  }

  if (allPicks.length) {
    msg += `\n*Today's Picks:*\n`;
    allPicks.forEach((p, i) => {
      const em = sportEmojis[p.sport] || '🎯';
      msg += `${i === 0 ? '⭐' : '▪️'} ${em} ${p.game}\n   *${p.pick}* (${p.odds}) • ${p.units}u\n`;
    });
  } else {
    msg += `\nNo qualifying picks today.\n`;
  }
  msg += `\n🌐 maggiebets.onrender.com`;

  await sendTelegram(msg);
  console.log('✅ Telegram sent');

  // ── 6. Commit & push ──
  try {
    execSync('git add -A && git commit -m "Daily update: multi-sport picks + settlement" && git push', {
      cwd: __dirname, stdio: 'pipe'
    });
    console.log('✅ Pushed to GitHub');
  } catch(e) {
    console.log('Git: nothing to push or minor error');
  }

  console.log('✅ Done!');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
