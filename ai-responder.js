// MaggieBets AI Email Auto-Responder
// Fully automated AI responses

const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const AFFILIATE_LINKS = `
Popular Sportsbooks:
- DraftKings: https://promo.draftkings.com/a25bets
- BetMGM: https://promo.betmgm.com/en/aosa25
- FanDuel: https://sportsbook.fanduel.com/bonus
- Caesars: https://www.caesars.com/sportsbook/intro-offers
`.trim();

// Simple AI response generator (rule-based for now)
function generateResponse(email, name, message) {
  const lowerMsg = message.toLowerCase();
  
  let response = `Hey${name ? ' ' + name : ''}! Thanks for reaching out to MaggieBets! 🏆\n\n`;
  
  if (lowerMsg.includes('pick') || lowerMsg.includes('today') || lowerMsg.includes('bet')) {
    response += `Check out today's free pick on our site: https://maggiebets.onrender.com\n\n`;
    response += `We have Celtics -3.5 vs Warriors as today's play.\n\n`;
  }
  
  if (lowerMsg.includes('subscribe') || lowerMsg.includes('join')) {
    response += `Welcome aboard! 🎉\n\n`;
    response += `Subscribe at https://maggiebets.onrender.com for free daily picks.\n\n`;
  }
  
  if (lowerMsg.includes('bonus') || lowerMsg.includes('free') || lowerMsg.includes('promo')) {
    response += `Here are some great sign-up bonuses:\n\n${AFFILIATE_LINKS}\n\n`;
  }
  
  if (lowerMsg.includes('who') || lowerMsg.includes('about')) {
    response += `MaggieBets is your source for daily AI-powered sports betting picks! \n\n`;
    response += `We analyze games and give you the best edges.\n\n`;
  }
  
  // Default
  if (response === `Hey${name ? ' ' + name : ''}! Thanks for reaching out to MaggieBets! 🏆\n\n`) {
    response += `Check out our daily picks at https://maggiebets.onrender.com\n\n`;
    response += `Drop me a specific question and I'll help you out!\n\n`;
  }
  
  response += `Good luck! 🍀\n- Maggie`;
  
  return response;
}

app.post('/api/respond', (req, res) => {
  const { email, name, subject, message } = req.body;
  
  const aiResponse = generateResponse(email, name, subject, message || subject);
  
  res.json({ 
    success: true, 
    to: email,
    subject: `Re: ${subject}`,
    body: aiResponse
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets AI running on port ${PORT}`));
