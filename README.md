# Dispatch

A 5-round card duel for two players, played by texting links back and forth. No server, no accounts, no turn timers.

## Play
1. Open `index.html` (hosted, e.g. on GitHub Pages) and tap **Start**.
2. Play 2 cards, tap **Lock in & send**, then **Text it** to send the link.
3. Your opponent opens the link, plays, and texts one back. Repeat for 5 rounds.

The whole game state lives in the link after `#`. The starting player's moves are sealed with a hash (commit/reveal), so the opponent can't peek. The starter must keep playing in the same browser, because that's where the sealed moves are stored.

## Hosting on GitHub Pages
Repo **Settings → Pages → Deploy from a branch**, then pick the branch and `/ (root)`.
