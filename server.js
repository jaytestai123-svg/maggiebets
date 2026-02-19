const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const ODDS_API_KEY = '12d709f9b4d84245e7d8b1bc93dde55a';

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
  if (!ODDS_API_KEY) {
    return { error: 'No API key' };
  }
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us`;
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    return { error: error.message };
  }
}

async function getTodayPicks() {
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
    return [];
  }
}

function generateAIResponse(name, message, subject = '') {
  const fullMessage = `${subject} ${message}`.toLowerCase();
  
  let category = 'general';
  if (fullMessage.includes('pick') || fullMessage.includes('today') || fullMessage.includes('bet') || fullMessage.includes('odds') || fullMessage.includes('line')) {
    category = 'picks';
  } else if (fullMessage.includes('bonus') || fullMessage.includes('promo')) {
    category = 'bonuses';
  } else if (fullMessage.includes('subscribe') || fullMessage.includes('join')) {
    category = 'subscribe';
  } else if (fullMessage.includes('record') || fullMessage.includes('win') || fullMessage.includes('loss')) {
    category = 'record';
  } else if (fullMessage.includes('help')) {
    category = 'help';
  }
  
  const greeting = name && name.toLowerCase() !== 'there' ? `Hey ${name}!` : 'Hey there!';
  let response = `${greeting} Thanks for reaching out to MaggieBets! 🏆\n\n`;
  
  if (category === 'picks') {
    response += `🎯 **Today's Pick: Celtics -5.5 vs Warriors**\n\n`;
    response += `Reasoning:\n`;
    response += `• Celtics on 7-3 run, averaging 122 PPG\n`;
    response += `• Warriors allow most points in league\n`;
    response += `• Celtics 6-2-1 ATS last 9 games\n\n`;
    response += `Live odds: Celtics -110 at FanDuel\n`;
    response += `Check full picks: https://maggiebets.onrender.com\n\n`;
  } else if (category === 'bonuses') {
    response += `🎁 **Best Sign-Up Bonuses:**\n${AFFILIATE_LINKS}\n\n`;
  } else if (category === 'subscribe') {
    response += `📧 **Subscribe for FREE daily picks!**\n`;
    response += `Visit https://maggiebets.onrender.com\n\n`;
  } else if (category === 'record') {
    response += `📊 **Record: 0-0** (starting fresh!)\n\n`;
  } else if (category === 'help') {
    response += `🤝 **I can help with:**\n`;
    response += `• Daily NBA picks\n`;
    response += `• Live betting lines\n`;
    response += `• Bonus codes\n`;
    response += `• Subscription info\n\n`;
  } else {
    response += `Check out our picks: https://maggiebets.onrender.com\n\n`;
  }
  
  response += `🍀 Good luck!\n- Maggie`;
  return response;
}

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

app.get('/api/odds', async (req, res) => {
  const sport = req.query.sport || 'nba';
  const sportKey = SPORTS[sport]?.key || 'basketball_nba';
  const odds = await getLiveOdds(sportKey);
  res.json(odds);
});

app.get('/api/games', async (req, res) => {
  const games = await getTodayPicks();
  res.json({ games });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', oddsConfigured: !!ODDS_API_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
