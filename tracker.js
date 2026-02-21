// Auto-pick tracker for MaggieBets
// Run daily to fetch games and check results

const ODDS_API_KEY = '12d709f9b4d84245e7d8b1bc93dde55a';
const SPORTS = {
  nba: { key: 'basketball_nba', name: 'NBA' },
  ncaab: { key: 'basketball_ncaab', name: 'NCAA' },
  nhl: { key: 'icehockey_nhl', name: 'NHL' }
};

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'picks-data.json');

async function fetchOdds(sportKey) {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us`;
    const response = await fetch(url);
    return await response.json();
  } catch (e) {
    console.error(`Error fetching ${sportKey}:`, e.message);
    return [];
  }
}

async function getTodayPicks() {
  const picks = [];
  
  for (const [sport, config] of Object.entries(SPORTS)) {
    const games = await fetchOdds(config.key);
    
    // Get games in next 48 hours
    const now = new Date();
    const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    for (const game of games) {
      const gameTime = new Date(game.commence_time);
      if (gameTime > now && gameTime < cutoff) {
        const fd = game.bookmakers?.find(b => b.key === 'fanduel');
        const h2h = fd?.markets?.find(m => m.key === 'h2h');
        
        if (h2h && h2h.outcomes.length >= 2) {
          picks.push({
            sport: config.name,
            home: game.home_team,
            away: game.away_team,
            time: game.commence_time,
            fanduel: {
              home: h2h.outcomes.find(o => o.name === game.home_team)?.price,
              away: h2h.outcomes.find(o => o.name === game.away_team)?.price
            }
          });
        }
      }
    }
  }
  
  return picks;
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { picks: [], history: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function main() {
  console.log('🏈 Fetching today\'s games...\n');
  
  const picks = await getTodayPicks();
  console.log(`Found ${picks.length} upcoming games in next 48h:\n`);
  
  for (const p of picks.slice(0, 5)) {
    console.log(`  ${p.sport}: ${p.away} @ ${p.home}`);
  }
  
  // Save for tracking
  const data = loadData();
  data.lastUpdate = new Date().toISOString();
  data.upcoming = picks;
  saveData(data);
  
  console.log('\n✅ Data saved to picks-data.json');
}

main().catch(console.error);
