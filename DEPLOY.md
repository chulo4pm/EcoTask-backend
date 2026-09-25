# Deploying EcoTask (free)

Frontend -> Vercel, Backend -> Render, Database -> MongoDB Atlas, Email -> Brevo.

## 1. MongoDB Atlas (database)
Your .env uses a local database (127.0.0.1), which Render can't reach.
1. Sign up at mongodb.com/atlas and create a **free M0** cluster.
2. Database Access: add a user and password.
3. Network Access: add `0.0.0.0/0` (allow from anywhere - Render's IP changes).
4. Connect > Drivers: copy the connection string, add `/ecotask` before the `?`:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/ecotask?retryWrites=true&w=majority`
5. Create your admin account in the new database (run on your computer, with
   MONGO_URI in .env temporarily set to the Atlas string):
   `npm run create-admin -- admin@example.com "YourPassw0rd" "Admin Name"`

## 2. Brevo (email codes)
1. Sign up at brevo.com (free plan).
2. Senders & IP > Senders: add and verify your Gmail address.
3. SMTP & API > API Keys: create an API key.

## 3. Render (backend)
1. New > Web Service > connect the `ecotask-backend` GitHub repo.
2. Build command: `npm install`   Start command: `npm start`   Instance: Free.
3. Environment variables:
   - MONGO_URI = the Atlas string
   - JWT_SECRET = 64+ random characters
   - JWT_EXPIRES_IN = same as your .env
   - BREVO_API_KEY = your Brevo key
   - EMAIL_FROM = the Gmail you verified in Brevo
4. Deploy, then open the URL - it should say "EcoTask Backend API is running!"

## 4. Vercel (frontend)
1. Add New > Project > import the `ecotask` GitHub repo (framework: Vite).
2. Environment variable: `VITE_API_URL` = your Render URL, e.g. `https://ecotask-backend.onrender.com`
3. Deploy.

## Notes
- Render's free server sleeps after ~15 minutes idle; the first request takes 30-60 s.
  Open the site a minute before presenting.
- Uploaded images and organizer documents are stored in MongoDB, so they survive restarts.
- If you change VITE_API_URL later, redeploy on Vercel (it's baked in at build time).
