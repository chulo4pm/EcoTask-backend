// User schema that stores account information, role, and participation-related metadata.
const mongoose = require('mongoose');

// A verification document uploaded by an organizer during sign-up.
// Files are stored in /private-uploads (NOT publicly served) and only admins can view them.
const organizerDocumentSchema = new mongoose.Schema({
  fileName: { type: String, required: true },     // name on disk
  originalName: { type: String, required: true }, // name the user uploaded
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  phone: {
    type: String,
    default: '',
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['volunteer', 'organizer', 'admin'],
    default: 'volunteer',
  },
  points: {
    type: Number,
    default: 0,
  },

  // ---------- Organizer-only fields ----------
  organizationName: {
    type: String,
    trim: true,
    default: '',
  },
  organizerStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', null],
    default: null,
  },
  rejectionReason: {
    type: String,
    default: '',
  },
  organizerDocuments: [organizerDocumentSchema],
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  reviewedAt: {
    type: Date,
    default: null,
  },

  // ---------- Account security ----------
  passwordChangedAt: {
    type: Date,
    default: null,
  },
  // Tokens issued before this moment are rejected ("log out of all devices").
  tokensValidAfter: {
    type: Date,
    default: null,
  },

  // ---------- Email verification (sign-up code) ----------
  // Default is TRUE so accounts created before this feature (and admin accounts)
  // keep working. New volunteer/organizer sign-ups set it to false explicitly.
  isEmailVerified: {
    type: Boolean,
    default: true,
  },
  emailVerificationCode: {      // SHA-256 hash of the 6-digit code, never the code itself
    type: String,
    default: null,
    select: false,
  },
  emailVerificationExpires: {
    type: Date,
    default: null,
  },
  emailVerificationAttempts: {  // wrong guesses on the current code
    type: Number,
    default: 0,
  },
  emailVerificationSentAt: {    // used for the resend cooldown
    type: Date,
    default: null,
  },

  // ---------- Forgot password (reset code) ----------
  passwordResetCode: {          // SHA-256 hash of the 6-digit code
    type: String,
    default: null,
    select: false,
  },
  passwordResetExpires: {
    type: Date,
    default: null,
  },
  passwordResetAttempts: {
    type: Number,
    default: 0,
  },
  passwordResetSentAt: {
    type: Date,
    default: null,
  },

  // ---------- Suspension (set by admin) ----------
  // A suspended account cannot log in or use the API, and its activities are hidden from volunteers.
  isSuspended: {
    type: Boolean,
    default: false,
  },
  suspendedReason: {
    type: String,
    default: '',
  },
  suspendedAt: {
    type: Date,
    default: null,
  },
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
