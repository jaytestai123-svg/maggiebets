const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const AFFILIATE_LINKS = `
🏆 Best Sportsbook Sign-Up Bonuses:

📌 DraftKings: https://promo.draftkings.com/a25bets (Deposit match +$50)
📌 BetMGM: https://promo.betmgm.com/en/aosa25 ($1,500 deposit match)
📌 FanDuel: https://sportsbook.fanduel.com/bonus ($1,000 first bet on us)
📌 Caesars: https://www.caesars.com/sportsbook/intro-offers ($1,250 back)
`.trim();

// Dynamic AI-style response generator
function generateAIResponse(name, message, isNewUser) {
  const lowerMsg = message.toLowerCase();
  const todayPick = "Celtics -3.5 vs Warriors";
  
  let response = isNewUser 
    ? `Hey ${name || 'there'}! Welcome to MaggieBets! 🏆\n\n`
    : `Hey ${name || 'there'}! Good to hear from you again! 🏆\n\n`;
  
  // Handle different query types
  if (lowerMsg.includes('pick') || lowerMsg.includes('today') || lowerMsg.includes('bet')) {
    response += `🎯 Today's Pick: ${todayPick}\n`;
    response += `Reasoning: Celtics are hot (8-2 last 10), Warriors struggling at home, and Boston ranks #1 in 3PT%.\n\n`;
    response += `Full analysis at: https://maggiebets.onrender.com\n\n`;
  }
  
  if (lowerMsg.includes('subscribe') || lowerMsg.includes('join') || lowerMsg.includes('newsletter')) {
    response += `📧 You can subscribe at https://maggiebets.onrender.com for FREE daily picks delivered to your inbox!\n\n`;
  }
  
  if (lowerMsg.includes('bonus') || lowerMsg.includes('promo') || lowerMsg.includes('free bet') || lowerMsg.includes('signup')) {
    response += `🎁 Here are the best sign-up bonuses right now:\n\n${AFFILIATE_LINKS}\n\n`;
  }
  
  if (lowerMsg.includes('nba') || lowerMsg.includes('basketball')) {
    response += `🏀 We're currently focused on NBA picks. Today's play: ${todayPick}.\n\n`;
  }
  
  if (lowerMsg.includes('nfl') || lowerMsg.includes('football')) {
    response += `🏈 NFL season is over, but we'll be back with picks next season! For now, focus on NBA and other sports.\n\n`;
  }
  
  if (lowerMsg.includes('help') || lowerMsg.includes('what')) {
    response += `I can help you with:\n`;
    response += `• Today's NBA picks\n`;
    response += `• Sportsbook bonus codes\n`;
    response += `• Subscription info\n`;
    response += `• General betting questions\n\n`;
  }
  
  // Add closing with affiliate link naturally
  if (!lowerMsg.includes('bonus') && !lowerMsg.includes('promo')) {
    response += `💡 Pro tip: If you haven't signed up yet, check out these exclusive bonuses:\n${AFFILIATE_LINKS.split('\n').slice(0,3).join('\n')}\n\n`;
  }
  
  response += `🍀 Good luck with your bets!\n- Maggie`;
  
  return response;
}

// Email webhook endpoint (for Zapier)
app.post('/webhook/email', (req, res) => {
  const { from, subject, body, name } = req.body;
  
  const message = body || subject || '';
  const isNewUser = !message.toLowerCase().includes('thanks') && !message.toLowerCase().includes('response');
  
  const aiResponse = generateAIResponse(name, message, isNewUser);
  
  res.json({
    success: true,
    to: from,
    subject: `Re: ${subject || 'Your MaggieBets Query'}`,
    body: aiResponse
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MaggieBets AI' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
