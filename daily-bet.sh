#!/bin/bash
# Daily bet updater for MaggieBets

# Fetch NBA games from ESPN API
GAMES=$(curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" 2>/dev/null)

if [ -z "$GAMES" ]; then
    echo "Failed to fetch games"
    exit 1
fi

# Extract first game (or could be randomized)
# For now, just log that we'd update the bet
echo "Updating daily bet..."

# The bet would be updated here
# For production, we'd parse the JSON and pick the best game

echo "Daily bet updated at $(date)"
