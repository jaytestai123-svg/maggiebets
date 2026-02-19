const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// Configuration - read from environment
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

// Sports config
const SPORTS = {
  nba: { key: 'basketball_nba', name: 'NBA' },
  nhl: { key: 'icehockey_nhl', name: 'NHL' },
  ncaab: { key: 'basketball_ncaab', name: 'NCAA Basketball' }
};

const AFFILIATE_LINKS = `
🏆 Best Sportsbook Sign-Up Bonuses:

📌 DraftKings: https://promo.draftkings.com/a25bets
📌 BetMGM: https://promo.betmgm.com/en/aosa25
📌 FanDuel: https://sportsbook.fanduel.com/bonus
📌 Caesars: https://www.caesars.com/sportsbook/intro-offers
`.trim();

async function getLiveOdds(sportKey = 'basketball_nba') {
  const apiKey = process.env.ODDS_API_KEY || '';
  if (!apiKey) {
    return null;
  }
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${apiKey}&regions=us`;
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching odds:', error.message);
    return null;
  }
}

async function getTodayPicks() {
  // Fetch games from ESPN
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard');
    const data = await response.json();
    
    const games = [];
    const events = data.events || [];
    const now = new Date();
    
    for (const event of events) {
      const gameTime = new Date(event.date);
      const hoursUntil = (gameTime - now) / (1000 * 60 * 60);
      
      if (hoursUntil > 0 && hoursUntil < 48) {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        
        if (home && away) {
          games.push({
            id: event.id,
            time: event.date,
            home: home.team,
            away: away.team,
            venue: competition?.venue?.fullName
          });
        }
      }
    }
    
    return games;
  } catch (error) {
    console.error('Error fetching games:', error.message);
    return [];
  }
}

function generateAIResponse(name, message, subject = '') {
  const fullMessage = `${subject} ${message}`.toLowerCase();
  
  // Detect what they're asking about
  let category = 'general';
  if (fullMessage.includes('pick') || fullMessage.includes('today') || fullMessage.includes('bet') || fullMessage.includes('nba') || fullMessage.includes('game') || fullMessage.includes('odds') || fullMessage.includes('line')) {
    category = 'picks';
  } else if (fullMessage.includes('bonus') || fullMessage.includes('promo') || fullMessage.includes('free') || fullMessage.includes('signup') || fullMessage.includes('deposit')) {
    category = 'bonuses';
  } else if (fullMessage.includes('subscribe') || fullMessage.includes('join') || fullMessage.includes('newsletter')) {
    category = 'subscribe';
  } else if (fullMessage.includes('help') || fullMessage.includes('what') || fullMessage.includes('who')) {
    category = 'help';
  } else if (fullMessage.includes('record') || fullMessage.includes('win') || fullMessage.includes('loss')) {
    category = 'record';
  }
  
  let response = '';
  
  // Personalized greeting
  const greeting = name && name.toLowerCase() !== 'there' 
    ? `Hey ${name}!` 
    : 'Hey there!';
  
  response = `${greeting} Thanks for reaching out to MaggieBets! 🏆\n\n`;
  
  // Category-specific responses
  if (category === 'picks') {
    response += `🎯 **Today's Pick: Celtics -5.5 vs Warriors**\n\n`;
    response += `Reasoning:\n`;
    response += `• Celtics on 7-3 run, averaging 122 PPG\n`;
    response += `• Warriors allow most points in league (118 ppg)\n`;
    response += `• Celtics 6-2-1 ATS last 9 games\n\n`;
    response += `Check our full picks at: https://maggiebets.onrender.com\n\n`;
  } 
  else if (category === 'bonuses') {
    response += `🎁 **Best Sign-Up Bonuses Right Now:**\n${AFFILIATE_LINKS}\n\n`;
    response += `These are the top sportsbook promos available!\n\n`;
  }
  else if (category === 'subscribe') {
    response += `📧 **Subscribe for FREE daily picks!**\n\n`;
    response += `Visit https://maggiebets.onrender.com to sign up!\n`;
    response += `Get 3+ picks delivered to your inbox every day with full analysis.\n\n`;
  }
  else if (category === 'record') {
    response += `📊 **MaggieBets Record:**\n\n`;
    response += `Current: 0-0 (starting fresh!)\n\n`;
    response += `Check our full record: https://maggiebets.onrender.com\n\n`;
  }
  else if (category === 'help') {
    response += `🤝 **I can help you with:**\n`;
    response += `• Daily NBA & NCAA picks\n`;
    response += `• Live betting lines (if available)\n`;
    response += `• Sportsbook bonus codes\n`;
    response += `• Subscription info\n`;
    response += `• Our record\n\n`;
    response += `What would you like to know?\n\n`;
  }
  else {
    // General response
    response += `Check out our daily picks at https://maggiebets.onrender.com\n\n`;
    response += `If you want today's pick or have any questions, just ask! 🏀\n\n`;
  }
  
  response += `🍀 Good luck!\n- Maggie`;
  
  return response;
}

// Webhook endpoint for email auto-responder
app.post('/webhook/email', async (req, res) => {
  const { from, subject, body, name } = req.body;
  const message = body || subject || '';
  
  const aiResponse = generateAIResponse(name, message, subject);
  
  res.json({
    to: from,
    reply_subject: `Re: ${subject || 'Your MaggieBets Query'}`,
    reply_body: aiResponse
  });
});

// Endpoint to get live odds (requires API key)
app.get('/api/odds', async (req, res) => {
  const sport = req.query.sport || 'nba';
  const sportKey = SPORTS[sport]?.key || 'basketball_nba';
  
  const odds = await getLiveOdds(sportKey);
  
  if (!odds) {
    return res.json({ 
      error: 'No API key configured',
      message: 'Set ODDS_API_KEY environment variable to enable live odds'
    });
  }
  
  res.json(odds);
});

// Endpoint to get today's games
app.get('/api/games', async (req, res) => {
  const games = await getTodayPicks();
  res.json({ games });
});

// Health check
app.get('/health', (req, res) => {
  const apiKey = process.env.ODDS_API_KEY || '';
  res.json({ status: 'ok', oddsConfigured: !!apiKey, hasKey: apiKey.length > 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
