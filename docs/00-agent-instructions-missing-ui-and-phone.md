# 00-agent-instructions-missing-ui-and-phone.md

Problem: the two new features aren't visible in the UI
I scrolled the entire live frontend page and there is no Split Bill section and no Transaction History / Recent Activity section anywhere. Only Send Money and Request Money are visible.
But the backend endpoints work — I've manually verified both:
POST /api/split — works, returns success with transaction IDs.
GET /api/transactions/:userId — works, returns data.
So the backend is done, but the frontend UI for these two features either was never built, wasn't committed/pushed, or isn't rendering for some reason (broken component, conditional that's never true, deploy that failed silently, etc.).
What I need from you
Find out why. Check:
Does the frontend code actually have components for Split Bill and Transaction History?
If yes — are they imported and rendered in the main page (page.tsx or wherever the dashboard lives)? Or did they get built but never wired in?
Was the last frontend change actually committed and pushed, and did Vercel actually redeploy it? (Check Vercel's deployment log/timestamp against your last commit.)
Fix it and make both sections actually visible and usable on the live site. Specifically:
Split Bill: a section with multi-recipient selection (checkboxes or multi-select from existing users), a total amount field, a display of the per-person split amount, and a submit button.
Transaction History / Recent Activity: a section showing the current user's past transactions (sent, received, and settled requests), most recent first — counterparty name, amount, direction, date/time, status.
Confirm both are visible and functional on https://frontend-alpha-inky-87.vercel.app before reporting back — actually load the page and check, don't just say it should work.
Also build: mock phone number field (bKash/Nagad-style)
Add a phone number field to each user, purely cosmetic/mock — not used for auth or lookup, just for realism, since Bangladeshi mobile wallets (bKash, Nagad) use phone numbers as the primary identity and its total absence here is a visible gap.
Add a phone field to the User model (e.g. format +880 1XXX-XXXXXX), backfill the 3 seeded/reset users with realistic-looking mock numbers.
Display it on the account card next to or below the account holder name (e.g. under "Account Holder: Alice" show the phone number in smaller text).
No functional behavior changes — recipient/sender selection still works by name/ID as it does now. This is purely a visible detail addition.
Make sure the /api/seed and /api/admin/reset endpoints also set this field so it survives resets.
Constraints
Don't touch the working send/request/pay/reset logic beyond what's needed to add the phone field to the User model and seed/reset data.
Keep the new UI sections visually consistent with the existing card-based design — don't introduce a different visual style.
Do not push or deploy yet. Build and test locally, then report back and wait for my go-ahead, same as before.
When done, report back
What was actually wrong with the missing UI (root cause).
Confirmation both sections work locally.
Confirmation the phone number field is added and displaying.
Any risks or things you simplified.
Save this prompt
Save this exact prompt as docs/00-agent-instructions-missing-ui-and-phone.md before starting.