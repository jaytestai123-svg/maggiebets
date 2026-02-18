const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const AFFILIATE_LINKS = `
🏆 Best Sportsbook Sign-Up Bonuses:

📌 DraftKings: https://promo.draftkings.com/a25bets
📌 BetMGM: https://promo.betmgm.com/en/aosa25
📌 FanDuel: https://sportsbook.fanduel.com/bonus
📌 Caesars: https://www.caesars.com/sportsbook/intro-offers
`.trim();

function generateAIResponse(name, message) {
  const lowerMsg = message.toLowerCase();
  
  // Detect what they're asking about
  let category = 'general';
  if (lowerMsg.includes('pick') || lowerMsg.includes('today') || lowerMsg.includes('bet') || lowerMsg.includes('nba') || lowerMsg.includes('game')) {
    category = 'picks';
  } else if (lowerMsg.includes('bonus') || lowerMsg.includes('promo') || lowerMsg.includes('free') || lowerMsg.includes('signup') || lowerMsg.includes('deposit')) {
    category = 'bonuses';
  } else if (lowerMsg.includes('subscribe') || lowerMsg.includes('join') || lowerMsg.includes('newsletter') || lowerMsg.includes('free')) {
    category = 'subscribe';
  } else if (lowerMsg.includes('help') || lowerMsg.includes('what') || lowerMsg.includes('who')) {
    category = 'help';
  }
  
  let response = '';
  
  // Personalized greeting
  if (name && name.toLowerCase() !== 'there') {
    response = `Hey ${name}! Thanks for reaching out to MaggieBets! 🏆\n\n`;
  } else {
    response = `Hey there! Thanks for reaching out to MaggieBets! 🏆\n\n`;
  }
  
  // Category-specific responses
  if (category === 'picks') {
    response += `🎯 **Todays Pick: Celtics -3.5 vs Warriors**\n\n`;
    response += `Reasoning: Celtics are on fire (8-2 in last 10), Warriors struggling at home, and Boston leads the league in 3PT%.\n\n`;
    response += `Check our full analysis at: https://maggiebets.onrender.com\n\n`;
  } 
  else if (category === 'bonuses') {
    response += `🎁 **Best Sign-Up Bonuses Right Now:**\n${AFFILIATE_LINKS}\n\n`;
    response += `These are the top sportsbook promos available - deposit matches and free bets!\n\n`;
  }
  else if (category === 'subscribe') {
    response += `📧 **Subscribe for FREE daily picks!**\n\n`;
    response += `Visit https://maggiebets.onrender.com to sign up!\n\n`;
    response += `Get picks delivered to your inbox every day.\n\n`;
  }
  else if (category === 'help') {
    response += `🤝 **I can help you with:**\n`;
    response += `• Daily NBA picks\n`;
    response += `• Sportsbook bonus codes\n`;
    response += `• Subscription info\n`;
    response += `• General betting questions\n\n`;
    response += `What would you like to know?\n\n`;
  }
  else {
    // General response
    response += `Thanks for reaching out! Check out our daily picks at https://maggiebets.onrender.com\n\n`;
    response += `If you want today's pick, just ask! 🏀\n\n`;
  }
  
  response += `🍀 Good luck!\n- Maggie`;
  
  return response;
}

app.post('/webhook/email', (req, res) => {
  const { from, subject, body, name } = req.body;
  const message = body || subject || '';
  
  const aiResponse = generateAIResponse(name, message);
  
  res.json({
    to: from,
    reply_subject: `Re: ${subject || 'Your MaggieBets Query'}`,
    reply_body: aiResponse
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
