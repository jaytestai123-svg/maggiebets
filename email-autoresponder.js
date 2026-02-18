// MaggieBets Auto-Responder
// Instructions:
// 1. Go to script.google.com
// 2. Create new project
// 3. Paste this code
// 4. Save and set trigger (onEmailReceived)
// 5. Authorize with Gmail

function onEmailReceived(e) {
  var email = e.mail;
  var sender = email.sender;
  var subject = email.subject;
  var body = email.body;
  
  // Get the user's question
  var question = body.substring(0, 500); // First 500 chars
  
  // AI Response (you can customize this)
  var response = getAIResponse(question);
  
  // Send reply
  GmailApp.sendEmail(
    sender,
    "Re: " + subject,
    response,
    {
      from: "maggiebets777@gmail.com",
      name: "MaggieBets"
    }
  );
}

function getAIResponse(question) {
  var lowerQ = question.toLowerCase();
  
  // Quick responses based on keywords
  if (lowerQ.includes("pick") || lowerQ.includes("today") || lowerQ.includes("bet")) {
    return `🏆 MaggieBets Daily Pick!\n\nCheck out our free picks at: https://maggiebets.onrender.com\n\nFor premium picks, reply with "premium"\n\n-Good luck!`;
  }
  
  if (lowerQ.includes("subscribe") || lowerQ.includes("join")) {
    return `Welcome to MaggieBets! 🎉\n\nGet free daily picks: https://maggiebets.onrender.com\n\nReply "HELP" for more options.\n\n-Gamma`;
  }
  
  if (lowerQ.includes("premium") || lowerQ.includes("paid")) {
    return `Premium Picks Info:\n\nComing soon! We're building out premium membership.\n\nFor now enjoy our free picks daily.\n\n-Maggie`;
  }
  
  if (lowerQ.includes("help")) {
    return `MaggieBets Help:\n\n• Daily picks: Visit our site\n• Subscribe: Join our newsletter\n• Premium: Coming soon\n• Contact: maggiebets777@gmail.com\n\n-Good luck!`;
  }
  
  // Default response
  return `Thanks for reaching out to MaggieBets! 🏆\n\nCheck our daily free picks at: https://maggiebets.onrender.com\n\nReply with any keyword (PICK, SUBSCRIBE, HELP)\n\n-Good luck!`;
}
