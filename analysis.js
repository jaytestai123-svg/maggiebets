/**
 * MaggieBets Analysis Engine
 * Pulls real ESPN data for each matchup and scores teams across multiple factors.
 * Returns structured analysis + human-readable reasoning for each game.
 */

const https = require('https');

function get(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

// ── Team recent form: last N completed games ──────────────────────────────────
async function getRecentForm(sport, teamId, n = 10) {
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/teams/${teamId}/schedule`);
    if (!data?.events) return null;
    const completed = data.events.filter(e => e.competitions?.[0]?.status?.type?.completed);
    const recent = completed.slice(-n);
    let wins = 0, losses = 0, runsFor = 0, runsAgainst = 0;
    for (const e of recent) {
      const comp = e.competitions[0];
      const myTeam = comp.competitors.find(c => String(c.team?.id) === String(teamId));
      const opp    = comp.competitors.find(c => String(c.team?.id) !== String(teamId));
      if (!myTeam || !opp) continue;
      const myScore  = parseFloat(myTeam.score?.value || myTeam.score || 0);
      const oppScore = parseFloat(opp.score?.value || opp.score || 0);
      runsFor     += myScore;
      runsAgainst += oppScore;
      if (myTeam.winner) wins++; else losses++;
    }
    return {
      games:  wins + losses,
      wins,
      losses,
      winPct: wins / (wins + losses || 1),
      avgFor:     runsFor     / (wins + losses || 1),
      avgAgainst: runsAgainst / (wins + losses || 1),
      runDiff:    (runsFor - runsAgainst) / (wins + losses || 1),
      streak: getStreak(recent, teamId),
    };
  } catch(e) { return null; }
}

function getStreak(events, teamId) {
  let count = 0; let type = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const comp   = events[i].competitions?.[0];
    const myTeam = comp?.competitors?.find(c => String(c.team?.id) === String(teamId));
    if (!myTeam) break;
    const isWin = !!myTeam.winner;
    if (type === null) { type = isWin; count = 1; }
    else if (isWin === type) count++;
    else break;
  }
  if (type === null) return 'N/A';
  return `${type ? 'W' : 'L'}${count}`;
}

// ── Home/Away split ───────────────────────────────────────────────────────────
function parseRecord(summary) {
  const overall = summary?.find(r => r.type === 'total')?.summary || '0-0';
  const home    = summary?.find(r => r.type === 'home')?.summary  || '0-0';
  const away    = summary?.find(r => r.type === 'road')?.summary  || '0-0';
  const parse = s => { const [w,l] = s.split('-').map(Number); return { w: w||0, l: l||0, pct: (w||0)/((w||0)+(l||0)||1) }; };
  return { overall: parse(overall), home: parse(home), away: parse(away), overallStr: overall, homeStr: home, awayStr: away };
}

// ── Team season stats from scoreboard competitor object ───────────────────────
function parseTeamStats(statistics = []) {
  const stats = {};
  for (const s of statistics) stats[s.abbreviation || s.name] = s.displayValue;
  return stats;
}

// ── Line movement: compare opening to current ─────────────────────────────────
function detectLineMovement(bookmakers, team) {
  const lines = [];
  for (const bk of bookmakers) {
    for (const market of (bk.markets || [])) {
      for (const outcome of (market.outcomes || [])) {
        if (outcome.name === team) {
          lines.push({ book: bk.key, point: outcome.point, price: outcome.price });
        }
      }
    }
  }
  if (lines.length < 2) return null;
  const prices = lines.map(l => l.price);
  const avg = prices.reduce((a,b) => a+b,0) / prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min;
  return { avg: Math.round(avg), min, max, spread, books: lines.length, lines };
}

// ── MLB: Get probable starting pitchers + ERA ─────────────────────────────────
async function getMLBProbables(eventId) {
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${eventId}`);
    const comp = data?.header?.competitions?.[0];
    if (!comp) return {};
    const result = {};
    for (const team of (comp.competitors || [])) {
      const probable = team.probables?.find(p => p.name === 'probableStartingPitcher');
      if (probable?.athlete) {
        result[team.homeAway] = {
          name: probable.athlete.displayName || probable.athlete.fullName,
          id:   probable.athlete.id,
        };
      }
    }
    // Fetch ERA for each pitcher
    for (const [side, p] of Object.entries(result)) {
      try {
        const stats = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/athletes/${p.id}/stats`);
        const pitching = stats?.splits?.categories?.find(c => c.name === 'pitching');
        const era = pitching?.stats?.find(s => s.name === 'ERA' || s.abbreviation === 'ERA');
        const wins = pitching?.stats?.find(s => s.abbreviation === 'W');
        const losses2 = pitching?.stats?.find(s => s.abbreviation === 'L');
        const whip = pitching?.stats?.find(s => s.abbreviation === 'WHIP');
        const k9  = pitching?.stats?.find(s => s.abbreviation === 'K/9');
        result[side].era  = era?.displayValue  || null;
        result[side].w    = wins?.displayValue  || null;
        result[side].l    = losses2?.displayValue || null;
        result[side].whip = whip?.displayValue || null;
        result[side].k9   = k9?.displayValue   || null;
      } catch(e) {}
    }
    return result;
  } catch(e) { return {}; }
}

// ── Weather (MLB outdoor) ─────────────────────────────────────────────────────
async function getWeather(eventId, sport) {
  if (sport !== 'baseball/mlb') return null;
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${eventId}`);
    const w = data?.gameInfo?.weather;
    if (!w) return null;
    return {
      temp:      w.temperature,
      gust:      w.gust,
      precip:    w.precipitation,
      condition: w.conditionId,
      isOutdoor: true,
    };
  } catch(e) { return null; }
}

// ── Implied probability from American odds ────────────────────────────────────
function impliedProb(americanOdds) {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

// ── Score a matchup and produce analysis ─────────────────────────────────────
async function analyzeMatchup(sport, espnPath, oddsGame, homeComp, awayComp) {
  const homeId = homeComp?.team?.id;
  const awayId = awayComp?.team?.id;
  const eventId = oddsGame?.id || null;

  // Parallel data fetching
  const [homeForm, awayForm, probables, weather] = await Promise.all([
    homeId ? getRecentForm(espnPath, homeId) : null,
    awayId ? getRecentForm(espnPath, awayId) : null,
    espnPath === 'baseball/mlb' && eventId ? getMLBProbables(eventId) : Promise.resolve({}),
    eventId ? getWeather(eventId, espnPath) : null,
  ]);

  const homeStats = parseTeamStats(homeComp?.statistics || []);
  const awayStats = parseTeamStats(awayComp?.statistics || []);
  const homeRec   = parseRecord(homeComp?.records || []);
  const awayRec   = parseRecord(awayComp?.records || []);

  return {
    homeForm, awayForm,
    homeStats, awayStats,
    homeRec, awayRec,
    probables,
    weather,
    homeName: homeComp?.team?.displayName,
    awayName: awayComp?.team?.displayName,
  };
}

// ── Build reasoning string from analysis ─────────────────────────────────────
function buildReasoning(sport, pickTeam, pickLine, oddsLabel, analysis, lineMovement) {
  const { homeForm, awayForm, homeStats, awayStats, homeRec, awayRec, probables, weather, homeName, awayName } = analysis;
  const isHome = homeName === pickTeam || (homeName || '').includes(pickTeam) || pickTeam.includes(homeName || '');
  const myForm  = isHome ? homeForm  : awayForm;
  const myRec   = isHome ? homeRec   : awayRec;
  const oppForm = isHome ? awayForm  : homeForm;
  const oppRec  = isHome ? awayRec   : homeRec;
  const mySplit = isHome ? myRec?.homeStr : myRec?.awayStr;
  const oppSplit= isHome ? oppRec?.awayStr : oppRec?.homeStr;

  const parts = [];

  // Record + home/away split
  if (myRec?.overallStr) parts.push(`${pickTeam} ${myRec.overallStr} overall (${mySplit || '?'} ${isHome ? 'home' : 'away'})`);

  // Recent form
  if (myForm) {
    parts.push(`${myForm.wins}-${myForm.losses} last ${myForm.games} | streak ${myForm.streak}`);
    if (myForm.runDiff > 0.3) parts.push(`+${myForm.runDiff.toFixed(1)} run diff L${myForm.games}`);
  }

  // Opponent context
  if (oppForm && oppRec?.overallStr) {
    parts.push(`Opp ${oppRec.overallStr} overall (${oppSplit || '?'} ${isHome ? 'away' : 'home'})`);
  }

  // MLB-specific: starting pitcher
  if (sport === 'MLB' && probables) {
    const mySide  = isHome ? 'home' : 'away';
    const oppSide = isHome ? 'away' : 'home';
    const myP  = probables[mySide];
    const oppP = probables[oppSide];
    if (myP?.era)  parts.push(`SP: ${myP.name} ${myP.w || '?'}-${myP.l || '?'} ${myP.era} ERA${myP.whip ? ' / '+myP.whip+' WHIP' : ''}`);
    if (oppP?.era) parts.push(`Opp SP: ${oppP.name} ${oppP.era} ERA`);
  }

  // MLB team stats (batting avg, runs, ERA rank)
  if (sport === 'MLB') {
    const myS  = isHome ? homeStats : awayStats;
    const oppS = isHome ? awayStats : homeStats;
    if (myS.AVG)  parts.push(`Team BA: ${myS.AVG}`);
    if (myS.ERA)  parts.push(`Bullpen ERA: ${myS.ERA}`);
    if (oppS.ERA) parts.push(`Opp ERA: ${oppS.ERA}`);
  }

  // NBA stats
  if (sport === 'NBA') {
    const myS  = isHome ? homeStats : awayStats;
    if (myS.PTS) parts.push(`Scoring: ${myS.PTS} PPG`);
    if (myS.FG)  parts.push(`FG%: ${myS.FG}`);
  }

  // Weather (MLB outdoor)
  if (weather) {
    if (weather.gust > 15)  parts.push(`⚠️ Wind ${weather.gust}mph`);
    if (weather.precip > 0) parts.push(`⚠️ Rain possible`);
    if (weather.temp < 50)  parts.push(`Cold weather (${weather.temp}°F)`);
  }

  // Line movement
  if (lineMovement && lineMovement.spread >= 10) {
    parts.push(`Line spread ${lineMovement.spread} across ${lineMovement.books} books — possible sharp action`);
  }

  // Implied probability
  const lineNum = parseFloat(oddsLabel);
  if (!isNaN(lineNum) && Math.abs(lineNum) >= 100) {
    const ip = (impliedProb(lineNum) * 100).toFixed(0);
    parts.push(`Implied win prob: ${ip}%`);
  }

  if (parts.length === 0) return `${pickTeam} — multi-factor analysis.`;
  return parts.join(' | ');
}

// ── Main export: analyze all games for a sport and rank picks ─────────────────
async function rankGamesForPicks(sportCfg, oddsData, espnScoreboard) {
  const ranked = [];

  for (const oddsGame of oddsData.slice(0, 8)) {
    if (!oddsGame.bookmakers?.length) continue;

    // Find matching ESPN game
    const espnGame = (espnScoreboard?.events || []).find(e => {
      const name = e.name || '';
      return name.toLowerCase().includes(oddsGame.home_team.split(' ').slice(-1)[0].toLowerCase()) ||
             name.toLowerCase().includes(oddsGame.away_team.split(' ').slice(-1)[0].toLowerCase());
    });

    const comp     = espnGame?.competitions?.[0];
    const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
    const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');

    const espnPath = sportCfg.espnPath;

    // Get analysis
    const analysis = await analyzeMatchup(
      sportCfg.label, espnPath, espnGame ? { id: espnGame.id } : null,
      homeComp, awayComp
    );

    // Score each team on the spread/ML
    const isMLB = sportCfg.label === 'MLB';
    const markets = isMLB
      ? ['h2h', 'spreads']
      : ['spreads'];

    for (const marketKey of markets) {
      const lines = [];
      for (const bk of oddsGame.bookmakers) {
        const market = (bk.markets || []).find(m => m.key === marketKey);
        if (!market) continue;
        for (const o of market.outcomes) lines.push({ team: o.name, point: o.point, price: o.price, book: bk.key });
      }

      // Group by team
      const byTeam = {};
      for (const l of lines) {
        if (!byTeam[l.team]) byTeam[l.team] = [];
        byTeam[l.team].push(l);
      }

      for (const [team, teamLines] of Object.entries(byTeam)) {
        if (teamLines.length < 2) continue;
        const avgPrice = Math.round(teamLines.reduce((s,l) => s+l.price, 0) / teamLines.length);
        const avgPoint = teamLines[0].point;
        const absPoint = Math.abs(avgPoint || 0);

        // Filter by sport-specific range
        const isML = marketKey === 'h2h';
        if (!isML && (absPoint < sportCfg.spreadMin || absPoint > sportCfg.spreadMax)) continue;
        if (isML && (Math.abs(avgPrice) > 200)) continue; // Skip huge favourites

        // Confidence score (0–100)
        let score = 50;
        const isHomeTeam = team === oddsGame.home_team;
        const myForm  = isHomeTeam ? analysis.homeForm  : analysis.awayForm;
        const oppForm = isHomeTeam ? analysis.awayForm  : analysis.homeForm;
        const myRec   = isHomeTeam ? analysis.homeRec   : analysis.awayRec;
        const oppRec  = isHomeTeam ? analysis.awayRec   : analysis.homeRec;

        // Recent form
        if (myForm) {
          score += (myForm.winPct - 0.5) * 20;        // up to +10 for hot team
          if (myForm.streak.startsWith('W')) score += Math.min(parseInt(myForm.streak.slice(1))||0, 4) * 2;
          if (myForm.streak.startsWith('L')) score -= Math.min(parseInt(myForm.streak.slice(1))||0, 4) * 2;
          score += myForm.runDiff * 2;                 // run/point differential
        }
        if (oppForm) {
          score -= (oppForm.winPct - 0.5) * 10;       // bonus if opp is cold
          if (oppForm.streak.startsWith('L')) score += 3;
        }

        // Home field
        if (isHomeTeam) score += 3;

        // Home/away split
        const mySplit  = isHomeTeam ? myRec?.home  : myRec?.away;
        const oppSplit = isHomeTeam ? oppRec?.away  : oppRec?.home;
        if (mySplit?.pct  > 0.55) score += 4;
        if (oppSplit?.pct < 0.45) score += 3;

        // MLB pitcher edge
        if (sportCfg.label === 'MLB' && analysis.probables) {
          const mySide  = isHomeTeam ? 'home' : 'away';
          const oppSide = isHomeTeam ? 'away' : 'home';
          const myP     = analysis.probables[mySide];
          const oppP    = analysis.probables[oppSide];
          if (myP?.era  && parseFloat(myP.era)  < 3.5) score += 6;
          if (myP?.era  && parseFloat(myP.era)  > 5.0) score -= 6;
          if (oppP?.era && parseFloat(oppP.era) > 4.5) score += 4;
          if (oppP?.era && parseFloat(oppP.era) < 3.0) score -= 4;
        }

        // Weather penalty (MLB)
        if (analysis.weather) {
          if (analysis.weather.gust > 20) score -= 3;
          if (analysis.weather.precip > 0) score -= 2;
        }

        // Value: book consensus (more books agreeing = more confident line)
        score += Math.min(teamLines.length, 5);

        const lineLabel = isML ? (avgPrice > 0 ? `+${avgPrice}` : `${avgPrice}`)
                                : (avgPoint > 0 ? `+${avgPoint}` : `${avgPoint}`);
        const oddsLabel = avgPrice > 0 ? `+${avgPrice}` : `${avgPrice}`;

        const lm = detectLineMovement(oddsGame.bookmakers, team);
        const reasoning = buildReasoning(
          sportCfg.label, team, avgPoint, oddsLabel, analysis, lm
        );

        const gameTime = new Date(oddsGame.commence_time);
        const mtHour   = ((gameTime.getUTCHours() - 6) + 24) % 24;
        const ampm     = mtHour >= 12 ? 'PM' : 'AM';
        const hour12   = mtHour > 12 ? mtHour - 12 : (mtHour === 0 ? 12 : mtHour);
        const timeStr  = `${hour12}:${String(gameTime.getUTCMinutes()).padStart(2,'0')} ${ampm} MT`;

        ranked.push({
          sport:     sportCfg.label,
          game:      `${oddsGame.away_team} @ ${oddsGame.home_team}`,
          pick:      `${team} ${lineLabel}`,
          odds:      oddsLabel,
          units:     1,
          time:      timeStr,
          reasoning,
          score:     Math.round(Math.min(Math.max(score, 0), 100)),
          marketKey,
        });
      }
    }
  }

  // Sort by confidence score, return top N
  ranked.sort((a,b) => b.score - a.score);
  const top = ranked.slice(0, sportCfg.maxPicks);

  // Mark units: top pick per sport gets 1.5u
  if (top.length > 0) top[0].units = 1.5;

  return top;
}

module.exports = { rankGamesForPicks, get };
