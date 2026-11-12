# Dispatch

A five-turn card duel for two players, played by texting links back and forth. There are no servers, no accounts and no turn timers.

## How a game works

1. Open the site and tap **New game**. Pick your name and a deck, then take turn 1.
2. Tap **End turn → Seal and send**, then **Text message** (or Share / Copy link).
3. Your opponent taps the link, picks a deck, plays, and texts a link back.
4. After five turns each, both phones show the result and run a fair-play check.

To practice, tap **Play the bot** instead. The bot plays one of the starter decks on your phone, and it can't see your hand or traps. Each turn it tries every move it could make, scores the board each one would leave, and keeps making the best move until nothing improves (`js/bot.js`).

Play the whole game on the same phone and browser you started it on. Your hand, deck order and traps are sealed with a secret that only lives on that phone.

## Rules in one minute

- 20 life each. A knockout wins immediately; otherwise the higher life after five turns each wins.
- Decks are 10 cards, one copy of each, from a 43-card pool. Start with 3 cards and refill to 3 at the end of every turn.
- Pay for cards by **pitching** other cards (Flesh and Blood style). Pitched cards go to the bottom of your deck.
- Attackers pick their targets. **Taunt** units must be attacked first.
- **Traps** are set face-down and fire automatically during your opponent's turn.
- Stuck with a hand you can't pitch? At the start of your turn you can shuffle it into your deck, pass, and draw a fresh hand.

The full card list and keywords are in the app under **Cards & rules**.

## Putting it online (GitHub Pages)

1. Merge this branch into `main`.
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

Free GitHub accounts can only use Pages on public repositories. Any static host works too, since it's plain HTML, CSS and JavaScript with no build step.

## Changing cards

All the cards live in [`js/cards.js`](js/cards.js). Numbers in `{braces}` in the rules text are filled in from the card's fields, so changing `dmg: 4` to `dmg: 3` also updates the text.

When you change a number:

1. Bump `RULES_VERSION` at the top of `js/cards.js`. When you add a card, give it `since: <new version>` so games started earlier keep their original card pool.
2. Run the stress test: `node tests/sim.js`. It plays hundreds of games between two simulated phones (random players and the bot) and checks they always agree.

New card *abilities* need code in `js/engine.js`, which looks up behaviour by card id.

## How the link stays honest

- The link holds the full move history, compressed (usually under 600 characters).
- Each phone keeps a secret seed. It shuffles your deck and seals your face-down cards with SHA-256 hashes, so the link can't be read to see your hand or traps.
- A trap fires on its owner's phone while it replays the opponent's turn. The reveal travels in the next message, so both phones end up with the same board.
- At the end, both phones reveal their seeds. Each phone replays the whole game with full information and checks that every card played was really in hand and every sealed card matches its seal.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell |
| `css/style.css` | All styling (light and dark) |
| `js/cards.js` | Card pool, keywords, starter decks |
| `js/engine.js` | Rules engine and game replay |
| `js/sha256.js` | Synchronous SHA-256 used for seals |
| `js/bot.js` | Computer opponent |
| `js/link.js` | Link encoding and local storage |
| `js/ui.js` | Screens and interaction |
| `tests/sim.js` | Two-phone stress test (`node tests/sim.js`) |
