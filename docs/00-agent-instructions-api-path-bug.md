Root cause found. Please fix this now (this one is a straightforward code fix, go ahead and implement it).
What we found
https://pstu-hackathon-backend.onrender.com/api/users → returns correct data:
  [{"id":1,"name":"Alice","balance":10000000},{"id":2,"name":"Bob","balance":10000000},{"id":3,"name":"Charlie","balance":10000000}]
https://pstu-hackathon-backend.onrender.com/users → Cannot GET /users
Browser Network tab on the live Vercel frontend shows the users fetch call going to .../users (no /api prefix) and getting a 404.
So the seed data is fine, the backend route is fine — the frontend is just calling the wrong path. It's either missing /api in the base URL construction, or NEXT_PUBLIC_API_URL is being used inconsistently across the codebase.
What to do
Find every place in the frontend that calls the backend (NEXT_PUBLIC_API_URL usage) and confirm whether /api is being appended correctly and consistently for every endpoint call (users, transfer, request, pay).
Fix whichever call(s) are missing the /api prefix, or fix NEXT_PUBLIC_API_URL's expected format if that's cleaner (state which you chose and why in 06-decisions.md).
Push the fix, confirm Vercel auto-redeploys (or trigger it manually if needed).
After redeploy, verify the live frontend URL actually shows Alice, Bob, Charlie with their balances — don't just tell us it should work, confirm it.
Update 06-decisions.md with a one-line note on what caused this and the fix, since "why did the frontend show no users" is a plausible judge question.
Save this prompt
Save this exact prompt as docs/00-agent-instructions-api-path-bug.md before or alongside making the fix.
