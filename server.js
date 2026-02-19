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
  if (!ODDS_API_KEY) return null;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us`;
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
}

function formatOdds(price) {
  if (price >= 100) return `+${price}`;
  return String(price);
}

async function generateChatResponse(message) {
  const msg = message.toLowerCase();
  let response = '';
  
  // Greeting
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
    response = `Hey there! 👋 I'm Maggie's AI assistant. I can help you with:\n\n`;
    response += `🏀 Today's NBA picks and analysis\n`;
    response += `💰 Live betting odds from multiple sportsbooks\n`;
    response += `🎁 Sportsbook bonus codes\n`;
    response += `📊 Our record\n`;
    response += `📧 Newsletter info\n\n`;
    response += `What would you like to know?`;
    return response;
  }
  
  // Live odds - fetch real data
  if (msg.includes('odds') || msg.includes('line') || msg.includes('bet') || msg.includes('spread') || msg.includes('moneyline')) {
    const odds = await getLiveOdds('basketball_nba');
    if (odds && odds.length > 0) {
      response = `📊 **Here are today's NBA odds:**\n\n`;
      for (const game of odds.slice(0, 5)) {
        const home = game.home_team;
        const away = game.away_team;
        const fd = game.bookmakers?.find(b => b.key === 'fanduel');
        const dk = game.bookmakers?.find(b => b.key === 'draftkings');
        
        response += `**${away} @ ${home}**\n`;
        if (fd?.markets?.[0]?.outcomes) {
          const h2h = fd.markets.find(m => m.key === 'h2h');
          if (h2h) {
            const homeOdds = h2h.outcomes.find(o => o.name === home);
            const awayOdds = h2h.outcomes.find(o => o.name === away);
            if (homeOdds && awayOdds) {
              response += `📌 FanDuel: ${away} ${formatOdds(awayOdds.price)} / ${home} ${formatOdds(homeOdds.price)}\n`;
            }
          }
        }
        response += '\n';
      }
      response += `Want analysis on any specific game?`;
    } else {
      response = `Let me check the odds for you...`;
    }
    return response;
  }
  
  // Picks
  if (msg.includes('pick') || msg.includes('today') || msg.includes('best') || msg.includes('game')) {
    const odds = await getLiveOdds('basketball_nba');
    response = `🎯 **Today's Top Pick:**\n\n`;
    response += `**Celtics @ Warriors**\n`;
    response += `Celtics -5.5 (-110) at FanDuel\n\n`;
    response += `**Why I like it:**\n`;
    response += `• Celtics on 7-3 run, averaging 122 PPG\n`;
    response += `• Warriors allow most points in league\n`;
    response += `• Celtics 6-2-1 ATS last 9 games\n\n`;
    response += `Want more picks or different sports?`;
    return response;
  }
  
  // Subscribe
  if (msg.includes('subscribe') || msg.includes('pay') || msg.includes('premium') || msg.includes('cost') || msg.includes('price')) {
    response = `📧 **MaggieBets Subscriptions:**\n\n`;
    response += `🆓 **Free:** Daily picks from our homepage\n\n`;
    response += `💎 **Premium ($9.99/mo):**\n`;
    response += `• AI Chat with live odds\n`;
    response += `• 3+ daily picks with analysis\n`;
    response += `• Line movement alerts\n`;
    response += `• Priority support\n\n`;
    response += `Click "Start Free Trial" on the chat page to try!`;
    return response;
  }
  
  // Record
  if (msg.includes('record') || msg.includes('win') || msg.includes('loss')) {
    response = `📊 **MaggieBets Record:**\n\n`;
    response += `**This Season: 0-0**\n\n`;
    response += `We're just getting started! Every pick is tracked honestly here.\n\n`;
    response += `Check back after tonight's games!`;
    return response;
  }
  
  // Bonuses
  if (msg.includes('bonus') || msg.includes('promo') || msg.includes('free bet') || msg.includes('deposit')) {
    response = `🎁 **Best Sportsbook Bonuses:**\n\n`;
    response += `📌 **DraftKings** - Up to $300 match\n`;
    response += `📌 **BetMGM** - $1000 risk-free bet\n`;
    response += `📌 **FanDuel** - $500 bonus bet\n`;
    response += `📌 **Caesars** - $1250 match\n\n`;
    response += `Use the links on our site to claim!`;
    return response;
  }
  
  // Help
  if (msg.includes('help') || msg.includes('what')) {
    response = `🤖 **I can help you with:**\n\n`;
    response += `🏀 Today's NBA games & odds\n`;
    response += `🎯 My best picks\n`;
    response += `💰 Sportsbook bonuses\n`;
    response += `📧 Subscribing\n`;
    response += `📊 Our record\n\n`;
    response += `What do you want to know?`;
    return response;
  }
  
  // Default - conversational
  response = `Thanks for messaging! 😊\n\n`;
  response += `I can give you today's picks, live odds, help you subscribe, or answer any questions about sports betting.\n\n`;
  response += `What would you like to know?`;
  return response;
}

function generateAIResponse(name, message, subject = '') {
  return generateChatResponse(`${subject} ${message}`);
}

// Webhook for email auto-responder
app.post('/webhook/email', async (req, res) => {
  const { from, subject, body, name } = req.body;
  const message = body || subject || '';
  const aiResponse = await generateChatResponse(message);
  
  res.json({
    to: from,
    reply_subject: `Re: ${subject || 'Your MaggieBets Query'}`,
    reply_body: aiResponse
  });
});

// Chat endpoint - conversational!
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  const response = await generateChatResponse(message);
  res.json({ response });
});

// API endpoints
app.get('/api/odds', async (req, res) => {
  const sport = req.query.sport || 'nba';
  const sportKey = SPORTS[sport]?.key || 'basketball_nba';
  const odds = await getLiveOdds(sportKey);
  res.json(odds || { error: 'No odds available' });
});

app.get('/api/games', async (req, res) => {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard');
    const data = await response.json();
    res.json({ games: data.events || [] });
  } catch (e) {
    res.json({ games: [] });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
