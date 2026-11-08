# Props conversation bot

The PrizePicks page (`/paper-betting/props`) has an **Ask SportsEdge** panel. It
recognizes ordinary wording and slash commands using deterministic rules over
the same saved records as the dashboard. It makes no AI API calls and adds no
odds-provider requests, database queries, dependencies or scheduled work.

Examples:

| Ask | Answer source |
| --- | --- |
| Who should I take tonight? / `/picks` | Recorded, unstarted picks and their saved model estimates |
| Why Jokic? Then: What about rebounds? And Pick6? | Saved player line, stats expectation and same-line book consensus |
| How did we do last night? / `/results` | Graded individual picks, with pending and void counts kept separate |
| What is my record? / `/record` | Loaded picks in the dashboard's 14-day window |
| What is my balance? / `/balance` | Starting virtual account amount plus known profit in up to 500 loaded entries |
| Is automation running? / `/status` | Existing automation status and control reason |
| When is the next collection? / `/schedule` | Current fixed schedule, converted to Mountain time |
| How does the model learn? | Saved model-control state and challenger progress |
| Copy lineup | An existing complete two-pick paper entry whose games have not locked |

Names come from the loaded platform records. Accent normalization, a small
nickname map and conservative edit-distance matching help with spelling. An
ambiguous name produces a clarification instead of choosing a player. The
conversation remembers the last player, stat, platform and date range for
follow-ups. A new broad question resets player filters; Clear conversation
resets everything. State stays in component memory and is not persisted.

The rules cannot invent a new probability, recent player average, matchup
explanation or sportsbook opinion. Missing data is described as missing. A
Pick6 profit remains unknown. The initial virtual balance plus loaded entry
profit is labeled as a displayed balance rather than a verified lifetime total.
Unsupported date ranges are refused explicitly. Individual pick hit rate never
becomes an entry win probability.

The page refreshes its existing snapshot as before; questions themselves run
locally. Every answer is anchored to the snapshot timestamp. Picks and copied
lineups are refused when that snapshot is over five minutes old. Locks are
checked at question time and rechecked when the copy button is pressed. Saved
quotes may differ from current platform lines.

Pause, Resume, Stop and learning requests link to the existing owner controls.
They never dispatch an action from chat. Copying writes text to the clipboard;
it does not submit an entry or contact a sportsbook account.

Implementation: `conversation.ts` contains the pure parser and answer rules;
`conversation-data.ts` projects dashboard facts into a compact serializable
snapshot; `props-conversation.tsx` renders the accessible log, suggestions,
input and copy action. Raw prediction inputs and run receipts are excluded
from the projection. The bot also renders an honest unavailable state before
the learning migrations or a ledger connection exist.

Verification: deterministic conversation tests run through the existing
`src/lib/props/*.test.mjs` CI glob. They cover names and ambiguity, follow-ups,
Mountain dates across UTC midnight and daylight saving, empty/unavailable
data, stale/locked picks, incomplete entries, unsupported date ranges,
unknown payouts and the read-only command boundary.
