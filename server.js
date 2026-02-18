// Simple Email Auto-Responder for MaggieBets
// Uses Web3Forms (free, no API key needed for basic)

// You can host this on Render for free
// Or use as a simple endpoint

const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Today's pick (would be updated daily)
const todaysPick = {
  game: "Celtics -3.5 vs Warriors",
  time: "Tomorrow, 10 PM EST",
  reasoning: [
    "Celtics 35-19 (4th in NBA)",
    "Warriors struggling at home",
    "Celtics #1 in 3PT%"
  ]
};

app.post('/api/auto-reply', (req, res) => {
  const { email, subject, message } = req.body;
  
  // This endpoint would be called by Zapier or email service
  // Returns the auto-reply content
  
  const reply = `
🏆 MaggieBets Daily Pick!

${todaysPick.game}
${todaysPick.time}

Why this pick:
${todaysPick.reasoning.map(r => '• ' + r).join('\n')}

Get more picks: https://maggiebets.onrender.com

Good luck!
- Maggie
  `.trim();
  
  res.json({ 
    success: true, 
    reply: reply,
    to: email
  });
});

app.get('/api/pick', (req, res) => {
  res.json(todaysPick);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MaggieBets API running on port ${PORT}`));
