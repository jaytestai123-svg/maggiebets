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

function generateAIResponse(name, message) {
  const lowerMsg = message.toLowerCase();
  const todayPick = "Celtics -3.5 vs Warriors";
  
  let response = `Hey ${name || 'there'}! Thanks for reaching out to MaggieBets! 🏆\n\n`;
  
  if (lowerMsg.includes('pick') || lowerMsg.includes('today') || lowerMsg.includes('bet')) {
    response += `🎯 Today's Pick: ${todayPick}\n`;
    response += `Reasoning: Celtics are hot (8-2 last 10), Warriors struggling at home.\n\n`;
  }
  
  if (lowerMsg.includes('bonus') || lowerMsg.includes('promo')) {
    response += `🎁 Sign-up Bonuses:\n${AFFILIATE_LINKS}\n\n`;
  }
  
  response += `Check all picks: https://maggiebets.onrender.com\n\n`;
  response += `🍀 Good luck!\n- Maggie`;
  
  return response;
}

app.post('/webhook/email', (req, res) => {
  const { from, subject, body, name } = req.body;
  const message = body || subject || '';
  
  const aiResponse = generateAIResponse(name, message);
  
  // Return flat structure for easier Zapier mapping
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
