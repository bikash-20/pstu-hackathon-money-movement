What's been done so far
Repo pushed to GitHub: https://github.com/bikash-20/pstu-hackathon-money-movement
PostgreSQL database created on Render (Singapore region, free tier) — name pstu-hackathon-db, status: Available
Backend deployed as a Render Web Service (Singapore region, free tier):
Root Directory: backend
Build Command: npm install && npx prisma generate && npx prisma migrate deploy
Start Command: npm start
DATABASE_URL environment variable set to the Render Postgres Internal Database URL
Deploy succeeded — logs show "Your service is live", running on port 10000
Live at: https://pstu-hackathon-backend.onrender.com
Frontend deployed to Vercel:
NEXT_PUBLIC_API_URL environment variable set to the Render backend URL above, as a Config var (not Secret — Vercel warned that a NEXT_PUBLIC_ prefixed var can't stay Secret since it's exposed client-side anyway)
Redeployed after setting the variable
Live at: https://frontend-alpha-inky-87.vercel.app
What we're fighting right now
Opening the live frontend URL shows:
Loading or No Users Found (Run DB Seed)...
Our read on this (correct us if wrong): prisma migrate deploy ran successfully and created the schema/tables on the Render Postgres instance, but no seed data was ever inserted — the fresh production database has zero users in it. So the frontend's user-select dropdown (the mock auth flow) has nothing to populate itself with, and every /users (or equivalent) call is returning empty.
Locally, presumably npx prisma db seed (or however seeding is wired) was run manually at some point during development, which is why this wasn't caught earlier — the local dev DB has data, production doesn't.
What we need from you right now — diagnosis only, no code
Confirm or correct our read of the problem. Is "empty production DB, no seed step in the deploy pipeline" actually what's happening, or is there something else going on (e.g. a different DATABASE_URL being read, a migration that silently failed, a seed script that errors out, something else)?
Tell us exactly what fixing this would involve, without doing it yet. Specifically:
Does a seed script already exist in the repo? Where, and what does it insert (how many users, what starting balance)?
Is it wired into package.json in a way npx prisma db seed (or similar) can run it?
Render's free tier does not support Shell/SSH access — given that constraint, what's the actual mechanism to get seed data into the production DB? (e.g. adding a seed step to the Build Command so it runs on every deploy, a one-time seed API endpoint, running the seed against the Render DB's external connection string from a local machine, or something else — tell us the options and which you'd recommend and why)
Any risk with your recommended approach (e.g. does re-running the seed on every future deploy duplicate users? does it need to be idempotent/guarded to only seed if the table is empty?)
Flag anything else you notice that might bite us later while you're looking at this — but don't fix it yet, just tell us.
Once you've laid this out, we'll tell you which approach to implement and only then should you write/change code.
Save this prompt
Save this exact prompt as docs/00-agent-instructions-deployment-blocker.md in the repo before doing anything else.
