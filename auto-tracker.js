// MaggieBets Auto-Tracker
// Fixed: Stores actual picks, checks results properly

const ODDS_API_KEY = '12d709f9b4d84245e7d8b1bc93dde55a';
const fs = require('fs');
const path = require('path');

const PICKS_FILE = path.join(__dirname, 'picks-data.json');

// Load picks
function loadPicks() {
  try {
    return JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
  } catch (e) {
    return { pending: [], history: [] };
  }
}

// Save picks
function savePicks(data) {
  fs.writeFileSync(PICKS_FILE, JSON.stringify(data, null, 2));
}

// Get today's date string in LOCAL time (not UTC)
function getTodayString() {
  const d = new Date();
  // Adjust for Mountain Time
  const mtOffset = -7 * 60 * 60 * 1000; // MST (or -6 for MDT)
  const localDate = new Date(d.getTime() + mtOffset);
  return localDate.toISOString().split('T')[0].replace(/-/g, '');
}

// Fetch today's games with spreads
async function getTodayGames() {
  console.log('Fetching today\'s games...\n');
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads`;
    const response = await fetch(url);
    const games = await response.json();
    
    // Games are listed for tonight - check both today and tomorrow
    const now = new Date();
    const denverOffset = -7 * 60 * 60 * 1000; // MST
    const denverTime = new Date(now.getTime() + denverOffset);
    const todayStr = denverTime.toISOString().slice(0, 10).replace(/-/g, '');
    
    // Also check tomorrow (tonight's games are often listed as tomorrow in API)
    const tomorrow = new Date(denverTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10).replace(/-/g, '');
    
    console.log(`Denver time: ${denverTime.toISOString().slice(0,10)} - Looking for: ${todayStr} or ${tomorrowStr}`);
    
    const todaysGames = [];
    for (const game of games) {
      const gameDate = game.commence_time.slice(0, 10).replace(/-/g, '');
      if (gameDate === todayStr || gameDate === tomorrowStr) {
        todaysGames.push(game);
      }
    }
    
    console.log(`Found ${todaysGames.length} games\n`);
    return todaysGames;
  } catch (e) {
    console.error('Error:', e.message);
    return [];
  }
}

// Manual add pick (run with: node auto-tracker.js add "Team A -3.5")
async function addPick(args) {
  // This would be: "76ers +9 @ Timberwolves"
  // For now, let's just fetch games and you can pick from them
  const games = await getTodayGames();
  
  console.log('Available games today:\n');
  games.forEach((g, i) => {
    const fd = g.bookmakers?.find(b => b.key === 'fanduel');
    const spread = fd?.markets?.find(m => m.key === 'spreads');
    if (spread) {
      const home = spread.outcomes.find(o => o.point < 0);
      const away = spread.outcomes.find(o => o.point > 0);
      console.log(`${i + 1}. ${g.away_team} @ ${g.home_team}`);
      console.log(`   ${away?.team}: ${away?.point > 0 ? '+' + away?.point : ''}`);
      console.log(`   ${home?.team}: ${home?.point}`);
      console.log('');
    }
  });
  
  console.log('\nTo add a pick, edit picks-data.json manually for now.');
  console.log('Format: Add to "pending" array with {team, line, odds: -110}');
}

// Check results for pending picks
async function checkResults() {
  console.log('Checking results for pending picks...\n');
  
  const data = loadPicks();
  const pending = data.pending || [];
  
  if (pending.length === 0) {
    console.log('No pending picks.');
    return;
  }
  
  // Get yesterday's date in MT
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const mtOffset = -7 * 60 * 60 * 1000;
  const yesterdayDate = new Date(d.getTime() + mtOffset);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0].replace(/-/g, '');
  
  console.log(`Fetching scores for ${yesterdayStr}...\n`);
  
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yesterdayStr}`;
    const response = await fetch(url);
    const scoreData = await response.json();
    
    // Build score map
    const scores = {};
    for (const event of scoreData.events || []) {
      const comp = event.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      
      if (home && away) {
        scores[home.team.abbreviation] = parseInt(home.score);
        scores[away.team.abbreviation] = parseInt(away.score);
        scores[home.team.displayName] = { score: parseInt(home.score), home: true };
        scores[away.team.displayName] = { score: parseInt(away.score), home: false };
      }
    }
    
    console.log('Scores:\n');
    for (const [team, score] of Object.entries(scores)) {
      if (typeof score === 'number') {
        console.log(`  ${team}: ${score}`);
      }
    }
    console.log('');
    
// Team name mapping (full name -> abbreviation)
const TEAM_MAP = {
  'Suns': 'PHX', 'Phoenix Suns': 'PHX',
  'Magic': 'ORL', 'Orlando Magic': 'ORL',
  '76ers': 'PHI', 'Philadelphia 76ers': 'PHI',
  'Pelicans': 'NO', 'New Orleans Pelicans': 'NO',
  'Knicks': 'NY', 'New York Knicks': 'NY',
  'Rockets': 'HOU', 'Houston Rockets': 'HOU',
  'Warriors': 'GSW', 'Golden State Warriors': 'GSW',
  'Nuggets': 'DEN', 'Denver Nuggets': 'DEN',
  'Timberwolves': 'MIN', 'Minnesota Timberwolves': 'MIN',
  'Bulls': 'CHI', 'Chicago Bulls': 'CHI',
  'Lakers': 'LAL',
  'Celtics': 'BOS',
  'Cavaliers': 'CLE',
  'Hornets': 'CHA'
};

function getTeamAbbr(teamName) {
  return TEAM_MAP[teamName] || teamName;
}

    // Check each pending pick
    let wins = 0, losses = 0;
    
    for (const pick of pending) {
      // Try both full name and abbreviation
      const homeAbbr = getTeamAbbr(pick.home);
      const awayAbbr = getTeamAbbr(pick.away);
      const teamAbbr = getTeamAbbr(pick.team);
      
      let homeScore = scores[pick.home] || scores[homeAbbr];
      let awayScore = scores[pick.away] || scores[awayAbbr];
      
      if (homeScore === undefined || awayScore === undefined) {
        console.log(`No score found for ${pick.away} @ ${pick.home}`);
        continue;
      }
      
      // Calculate if it covered
      let covered = false;
      const pickTeam = pick.team;
      const line = pick.line;
      
      if (pickTeam === pick.home || pickTeam === pick.homeTeam) {
        // Picked home team
        const margin = homeScore - awayScore;
        covered = margin + line > 0;
      } else {
        // Picked away team  
        const margin = awayScore - homeScore;
        covered = margin - line > 0;
      }
      
      const result = covered ? '✅ WIN' : '❌ LOSS';
      console.log(`${result}: ${pick.away} @ ${pick.home} (${awayScore}-${homeScore})`);
      console.log(`  Pick: ${pick.team} ${pick.line > 0 ? '+' + pick.line : pick.line}`);
      console.log(`  Covered: ${covered}\n`);
      
      if (covered) wins++;
      else losses++;
      
      // Move to history
      pick.result = covered ? 'WIN' : 'LOSS';
      pick.homeScore = homeScore;
      pick.awayScore = awayScore;
      pick.checkedAt = new Date().toISOString();
    }
    
    // Update data
    data.history = data.history || [];
    data.history.push(...pending);
    data.pending = [];
    data.stats = data.stats || { wins: 0, losses: 0 };
    data.stats.wins += wins;
    data.stats.losses += losses;
    
    savePicks(data);
    
    const total = data.stats.wins + data.stats.losses;
    const pct = total > 0 ? Math.round((data.stats.wins / total) * 100) : 0;
    const units = (data.stats.wins - data.stats.losses) * 0.5;
    
    console.log(`\n📊 Season: ${data.stats.wins}-${data.stats.losses} (${pct}%)`);
    console.log(`💰 Units: +${units}`);
    
  } catch (e) {
    console.error('Error checking results:', e.message);
  }
}

// Show current picks
function showPicks() {
  const data = loadPicks();
  const pending = data.pending || [];
  const stats = data.stats || { wins: 0, losses: 0 };
  
  console.log(`\n📊 Record: ${stats.wins}-${stats.losses}\n`);
  
  if (pending.length === 0) {
    console.log('No pending picks.\n');
  } else {
    console.log('Pending picks:\n');
    pending.forEach(p => {
      console.log(`  ${p.away} @ ${p.home}`);
      console.log(`  Pick: ${p.team} ${p.line > 0 ? '+' + p.line : p.line}\n`);
    });
  }
}

// Auto-generate picks for today
async function generatePicks() {
  console.log('🎯 Generating today\'s picks...\n');
  
  const games = await getTodayGames();
  if (games.length === 0) {
    console.log('No games found for today.');
    return;
  }
  
  const picks = [];
  const teamNames = {
    'Portland Trail Blazers': 'Portland Trail Blazers',
    'Denver Nuggets': 'Denver Nuggets',
    'Brooklyn Nets': 'Brooklyn Nets',
    'Sacramento Kings': 'Sacramento Kings',
    'Washington Wizards': 'Washington Wizards',
    'New York Knicks': 'New York Knicks',
    'Minnesota Timberwolves': 'Minnesota Timberwolves',
    'Boston Celtics': 'Boston Celtics',
    'Toronto Raptors': 'Toronto Raptors',
    'Phoenix Suns': 'Phoenix Suns',
    'LA Clippers': 'Los Angeles Clippers',
    'Los Angeles Clippers': 'Los Angeles Clippers',
    'Dallas Mavericks': 'Dallas Mavericks',
    'Miami Heat': 'Miami Heat',
    'Houston Rockets': 'Houston Rockets',
    'Golden State Warriors': 'Golden State Warriors',
    'Atlanta Hawks': 'Atlanta Hawks'
  };
  
  for (const game of games) {
    const fd = game.bookmakers?.find(b => b.key === 'fanduel');
    const spread = fd?.markets?.find(m => m.key === 'spreads');
    
    if (spread) {
      const home = spread.outcomes.find(o => o.point < 0);
      const away = spread.outcomes.find(o => o.point > 0);
      
      if (home && away) {
        const gameTime = new Date(game.commence_time);
        const timeStr = gameTime.toLocaleString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }) + ' MT';
        
        // Select the best pick (favorite with reasonable line, or best value)
        let pick = null;
        const line = Math.abs(home.point);
        
        // Skip if line is too steep (>15)
        if (line <= 12) {
          pick = {
            sport: 'NBA',
            game: `${game.away_team} @ ${game.home_team}`,
            time: timeStr,
            pick: `${game.home_team} ${home.point}`,
            odds: '-110',
            units: line <= 5 ? 2 : 1,
            tag: line <= 5 ? '⭐ TOP PICK' : '',
            reasoning: `${game.home_team} ${home.point} at home. Line at ${line} points.`
          };
        } else if (away.point <= 12) {
          pick = {
            sport: 'NBA',
            game: `${game.away_team} @ ${game.home_team}`,
            time: timeStr,
            pick: `${game.away_team} ${away.point}`,
            odds: '-110',
            units: 1,
            tag: '',
            reasoning: `${game.away_team} ${away.point} getting points. Value play.`
          };
        }
        
        if (pick) picks.push(pick);
      }
    }
  }
  
  // Update picks-data.json
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  
  const newData = {
    date: dateStr,
    lastUpdated: new Date().toISOString(),
    record: '24-13 (+6.0 units)',
    betOfDay: picks.find(p => p.tag === '⭐ TOP PICK') || picks[0] || null,
    picks: picks,
    injuries_flagged: [],
    research: {
      nba: `${games.length} NBA games today (${dateStr}). Auto-generated picks based on line value.`
    }
  };
  
  fs.writeFileSync(PICKS_FILE, JSON.stringify(newData, null, 2));
  console.log(`\n✅ Updated picks: ${picks.length} picks saved to picks-data.json`);
  
  // Update website
  await updateWebsite(picks);
  
  // Send Telegram notification
  await sendNotification(picks);
  
  console.log('\n🎉 Daily picks complete!');
}

async function updateWebsite(picks) {
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  
  const betOfDay = picks.find(p => p.tag === '⭐ TOP PICK') || picks[0];
  const topPicks = picks.filter(p => p.tag === '⭐ TOP PICK');
  const otherPicks = picks.filter(p => p.tag !== '⭐ TOP PICK');
  
  const picksHtml = picks.map(p => `
    <div class="pick">
      <div class="pick-header">
        <span class="tag">${p.tag || '📊'}</span>
        <span class="units">${p.units}u</span>
      </div>
      <div class="game">${p.game}</div>
      <div class="pick-line">${p.pick} @ ${p.odds}</div>
      <div class="time">${p.time}</div>
      <div class="reasoning">${p.reasoning}</div>
    </div>
  `).join('');
  
  const betHtml = betOfDay ? `
    <div class="bet-of-day">
      <h2>⭐ Bet of the Day</h2>
      <div class="bet-team">${betOfDay.pick}</div>
      <div class="bet-game">${betOfDay.game}</div>
      <div class="bet-details">${betOfDay.units}u @ ${betOfDay.odds}</div>
      <div class="bet-time">${betOfDay.time}</div>
    </div>
  ` : '';
  
  // Simple replace
  html = html.replace(/<div class="picks-container">[\s\S]*?<\/div>\s*<\/div>/, `<div class="picks-container">${picksHtml}</div></div>`);
  html = html.replace(/<div class="bet-of-day">[\s\S]*?<\/div>\s*<\/div>/, betHtml || '<div class="bet-of-day"><p>No picks today</p></div>');
  
  fs.writeFileSync(indexPath, html);
  console.log('✅ Website updated');
}

async function sendNotification(picks) {
  const TelegramBot = require('node-telegram-bot-api');
  const token = '8561009218:AAFz5os5lzxpIdEkqRA0yzUiXYZmMos5ms8';
  
  try {
    const bot = new TelegramBot(token, { polling: false });
    const chatId = '17079628'; // Eric's Telegram
    
    const betOfDay = picks.find(p => p.tag === '⭐ TOP PICK') || picks[0];
    let msg = `🏀 *MaggieBets Daily Picks*\n\n`;
    
    if (betOfDay) {
      msg += `⭐ *BET OF THE DAY*\n${betOfDay.pick}\n${betOfDay.game}\n${betOfDay.units}u @ ${betOfDay.odds}\n\n`;
    }
    
    msg += `📊 *${picks.length} Total Picks*\n`;
    picks.forEach((p, i) => {
      msg += `${i + 1}. ${p.pick} (${p.units}u)\n`;
    });
    
    msg += `\n🔗 maggiebets.com`;
    
    await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    console.log('✅ Telegram notification sent');
  } catch (e) {
    console.log('⚠️ Telegram notification failed:', e.message);
  }
}

// Main
const command = process.argv[2];

if (command === 'results') {
  checkResults().then(() => process.exit(0));
} else if (command === 'games') {
  getTodayGames().then(() => process.exit(0));
} else if (command === 'add') {
  addPick(process.argv.slice(3)).then(() => process.exit(0));
} else if (command === 'show') {
  showPicks();
} else if (command === 'picks') {
  generatePicks().then(() => process.exit(0));
} else {
  console.log('MaggieBets Auto-Tracker');
  console.log('');
  console.log('Commands:');
  console.log('  node auto-tracker.js games    - Show today\'s games');
  console.log('  node auto-tracker.js results - Check pending picks');
  console.log('  node auto-tracker.js show    - Show current picks');
  console.log('  node auto-tracker.js add     - Add a pick (manual for now)');
  console.log('  node auto-tracker.js picks   - Auto-generate today\'s picks');
}
