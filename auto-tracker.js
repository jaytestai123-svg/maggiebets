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
    
    const today = new Date();
    const todayStr = getTodayString();
    
    const todaysGames = [];
    for (const game of games) {
      const gameDate = game.commence_time.split('T')[0].replace(/-/g, '');
      if (gameDate === todayStr) {
        todaysGames.push(game);
      }
    }
    
    console.log(`Found ${todaysGames.length} games today (${todayStr})\n`);
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

// Main
const command = process.argv[2];

if (command === 'results') {
  checkResults().then(() => process.exit(0));
} else if (command === 'games') {
  getTodayGames().then(() => process.exit(0));
} else if (command === 'show') {
  showPicks();
} else {
  console.log('MaggieBets Auto-Tracker');
  console.log('');
  console.log('Commands:');
  console.log('  node auto-tracker.js games    - Show today\'s games');
  console.log('  node auto-tracker.js results - Check pending picks');
  console.log('  node auto-tracker.js show    - Show current picks');
  console.log('  node auto-tracker.js add     - Add a pick (manual for now)');
}
