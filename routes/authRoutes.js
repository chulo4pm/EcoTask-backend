// Routes for authentication: volunteer and organizer sign-up, login, and account status.
const express = require('express');
const router = express.Router();
const {
  registerUser,
  registerOrganizer,
  resubmitOrganizerDocuments,
  loginUser,
  getMe,
  updateMyProfile,
  changeMyPassword,
  logoutAllDevices,
  verifyEmail,
  resendVerificationCode,
  forgotPassword,
  resetPassword,
  verifyResetCode,
} = require('../controllers/authController');
const { protect, organizerAccount } = require('../middleware/authMiddleware');
const { documentUpload } = require('../middleware/documentUpload');

// Register a new volunteer account.
router.post('/register', registerUser);
// Register a new organizer account (with verification documents). Starts as "pending".
router.post('/organizer/register', documentUpload, registerOrganizer);
// Rejected organizers can upload new documents.
router.post('/organizer/resubmit', protect, organizerAccount, documentUpload, resubmitOrganizerDocuments);
// Confirm a new account with the 6-digit code sent by email (returns a JWT on success).
router.post('/verify-email', verifyEmail);
// Send a new verification code (60s cooldown).
router.post('/resend-verification', resendVerificationCode);
// Forgot password: email a 6-digit code, then set a new password with it.
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-code', verifyResetCode);
router.post('/reset-password', resetPassword);
// Log in an existing user and return a JWT token.
router.post('/login', loginUser);
// Current user info (used to refresh organizer approval status).
router.get('/me', protect, getMe);
// Account settings for the logged-in user.
router.put('/me', protect, updateMyProfile);
router.put('/me/password', protect, changeMyPassword);
router.post('/me/logout-all', protect, logoutAllDevices);

module.exports = router;
