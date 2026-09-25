// Main Express server entry point for the EcoTask API.
// It configures middleware, connects to MongoDB, and mounts all feature routes.
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Refuse to start with a missing or weak JWT secret.
// A guessable secret lets anyone forge login tokens (including admin ones).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET in .env is missing or too short (needs 32+ characters).');
  console.error('Generate one with:');
  console.error("  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
  process.exit(1);
}

const app = express();

// Render/Vercel put a proxy in front of the app. This lets rate limiting
// see each visitor's real IP instead of treating everyone as one user.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
// Public files (activity cover images). Organizer documents are in /private-uploads
// and are NOT served here - only admins can view them through /api/admin.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Activity cover images stored in MongoDB (see utils/fileStore.js).
const { BUCKETS, findFile, openDownloadStream } = require('./utils/fileStore');
app.get('/uploads/activities/:name', async (req, res) => {
  try {
    const file = await findFile(BUCKETS.activityImages, path.basename(req.params.name));
    if (!file) return res.status(404).send('Image not found');
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    openDownloadStream(BUCKETS.activityImages, file._id).on('error', () => res.end()).pipe(res);
  } catch (error) {
    res.status(500).send('Could not load image');
  }
});

// Connect to Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected in EcoTask Database'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Rate limiting (must come BEFORE the routes)
const { loginLimiter, registerLimiter, apiLimiter, verifyEmailLimiter, resendCodeLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('./middleware/rateLimiter');
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/auth/organizer/register', registerLimiter);
app.use('/api/auth/verify-email', verifyEmailLimiter);
app.use('/api/auth/resend-verification', resendCodeLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth/verify-reset-code', resetPasswordLimiter);
app.use('/api/auth/reset-password', resetPasswordLimiter);

// API route registration for all backend modules.
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/activities', require('./routes/activityRoutes'));
app.use('/api/participation', require('./routes/participationRoutes'));
app.use('/api/announcements', require('./routes/announcementRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));

app.get('/', (req, res) => {
  res.send('EcoTask Backend API is running!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
