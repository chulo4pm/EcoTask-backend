// Handles registration and login so users can create accounts and receive authenticated sessions.
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  validateRegistration,
  validateEmail,
  validateOrganizationName,
  validateName,
  validatePassword,
  sendValidationErrors,
} = require('../utils/validators');
const { removeUploadedFiles, toStoredDocuments } = require('../middleware/documentUpload');
const crypto = require('crypto');
const { sendVerificationCodeEmail, sendPasswordResetCodeEmail } = require('../utils/sendEmail');

/* ------------------------------------------
   EMAIL VERIFICATION HELPERS
   ------------------------------------------ */
const CODE_TTL_MINUTES = 10;       // code expires after 10 minutes
const MAX_CODE_ATTEMPTS = 5;       // wrong guesses allowed per code
const RESEND_COOLDOWN_SECONDS = 60;

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const codesMatch = (plainCode, storedHash) => {
  if (!storedHash) return false;
  const a = Buffer.from(hashCode(plainCode), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Seconds left before another code may be sent (0 = can send now).
const resendWaitSeconds = (user) => {
  if (!user.emailVerificationSentAt) return 0;
  const elapsed = (Date.now() - new Date(user.emailVerificationSentAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
};

// Creates a new 6-digit code, saves its hash, and emails it.
// Returns true if the email was sent, false if sending failed.
const issueVerificationCode = async (user) => {
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  user.emailVerificationCode = hashCode(code);
  user.emailVerificationExpires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  user.emailVerificationAttempts = 0;
  user.emailVerificationSentAt = new Date();
  await user.save();

  try {
    await sendVerificationCodeEmail({ to: user.email, name: user.name, code, minutes: CODE_TTL_MINUTES });
    return true;
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    return false;
  }
};

// What the frontend needs to show the "Enter your code" screen.
const verificationPayload = (user, emailSent) => ({
  needsVerification: true,
  email: user.email,
  role: user.role,
  emailSent,
  resendAvailableIn: resendWaitSeconds(user),
});

// Generate JWT
// No fallback secret: server.js refuses to start without a strong JWT_SECRET.
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// Safe user shape returned to the frontend (never includes the password).
const toAuthResponse = (user, withToken = true) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  createdAt: user.createdAt,
  passwordChangedAt: user.passwordChangedAt || null,
  ...(user.role === 'organizer' && {
    organizationName: user.organizationName,
    organizerStatus: user.organizerStatus,
    rejectionReason: user.organizerStatus === 'rejected' ? user.rejectionReason : '',
  }),
  ...(withToken && { token: generateToken(user._id) }),
});

const cleanInput = (body) => ({
  name: String(body.name || '').trim().replace(/\s+/g, ' '),
  email: String(body.email || '').trim().toLowerCase(),
  password: String(body.password || ''),
  phone: String(body.phone || '').trim(),
});

// Register User (volunteer)
exports.registerUser = async (req, res) => {
  try {
    const { name, email, password, phone } = cleanInput(req.body);

    // Same rules as the Register form. Returns 400 with { message, errors: { field: msg } }.
    if (sendValidationErrors(res, validateRegistration({ name, email, phone, password }))) return;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(409).json({
        message: 'An account with this email already exists',
        errors: { email: 'An account with this email already exists' },
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: 'volunteer',
      isEmailVerified: false,
    });

    // No token yet: the volunteer must enter the emailed code first.
    const emailSent = await issueVerificationCode(user);
    res.status(201).json({
      message: emailSent
        ? `We sent a 6-digit code to ${user.email}. Enter it to activate your account.`
        : "Your account was created, but we couldn't send the code. Tap \"Resend code\" to try again.",
      ...verificationPayload(user, emailSent),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Register Organizer (multipart form with verification documents).
// The account starts as "pending" until an admin approves it.
exports.registerOrganizer = async (req, res) => {
  const files = req.files || [];
  try {
    const { name, email, password, phone } = cleanInput(req.body);
    const organizationName = String(req.body.organizationName || '').trim().replace(/\s+/g, ' ');

    const errors = validateRegistration({ name, email, phone, password });
    const orgError = validateOrganizationName(organizationName);
    if (orgError) errors.organizationName = orgError;
    if (files.length === 0) errors.documents = 'Upload at least one verification document.';

    if (Object.keys(errors).length > 0) {
      removeUploadedFiles(files);
      return sendValidationErrors(res, errors);
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      removeUploadedFiles(files);
      return res.status(409).json({
        message: 'An account with this email already exists',
        errors: { email: 'An account with this email already exists' },
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: 'organizer',
      organizationName,
      organizerStatus: 'pending',
      organizerDocuments: toStoredDocuments(files),
      isEmailVerified: false,
    });

    // Organizer must confirm their email first, then wait for admin approval.
    const emailSent = await issueVerificationCode(user);
    res.status(201).json({
      message: emailSent
        ? `We sent a 6-digit code to ${user.email}. Verify your email, then wait for admin approval.`
        : "Your application was submitted, but we couldn't send the code. Tap \"Resend code\" to try again.",
      ...verificationPayload(user, emailSent),
      user: toAuthResponse(user, false),
    });
  } catch (error) {
    removeUploadedFiles(files);
    res.status(500).json({ message: error.message });
  }
};

// Rejected organizers upload new documents to apply again.
exports.resubmitOrganizerDocuments = async (req, res) => {
  const files = req.files || [];
  try {
    const user = await User.findById(req.user._id);

    if (user.organizerStatus !== 'rejected') {
      removeUploadedFiles(files);
      return res.status(400).json({ message: 'Only rejected applications can be resubmitted.' });
    }
    if (files.length === 0) {
      return res.status(400).json({
        message: 'Upload at least one verification document.',
        errors: { documents: 'Upload at least one verification document.' },
      });
    }

    if (req.body.organizationName !== undefined) {
      const organizationName = String(req.body.organizationName).trim().replace(/\s+/g, ' ');
      const orgError = validateOrganizationName(organizationName);
      if (orgError) {
        removeUploadedFiles(files);
        return sendValidationErrors(res, { organizationName: orgError });
      }
      user.organizationName = organizationName;
    }

    // Keep old documents for the admin's history, add the new ones.
    user.organizerDocuments.push(...toStoredDocuments(files));
    user.organizerStatus = 'pending';
    user.rejectionReason = '';
    user.reviewedAt = null;
    user.reviewedBy = null;
    await user.save();

    res.json({ message: 'Documents resubmitted. Please wait for admin approval.', user: toAuthResponse(user, false) });
  } catch (error) {
    removeUploadedFiles(files);
    res.status(500).json({ message: error.message });
  }
};

// Return the logged-in user's current account info (used to refresh organizer status).
exports.getMe = async (req, res) => {
  res.json(toAuthResponse(req.user, false));
};

// Login User (all roles). The frontend login pages check the role.
exports.loginUser = async (req, res) => {
  try {
    // Emails are saved lowercase at registration, so match them the same way here.
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const errors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (!password) errors.password = 'Password is required.';
    if (sendValidationErrors(res, errors)) return;

    // Check for user email
    const user = await User.findOne({ email });

    if (user && (await bcrypt.compare(password, user.password))) {
      if (user.isSuspended) {
        return res.status(403).json({
          message: `This account has been suspended by the admin. Reason: ${user.suspendedReason || 'Not specified'}`,
          suspended: true,
          suspendedReason: user.suspendedReason,
        });
      }

      // Email not confirmed yet: no token. If the old code expired, send a fresh one.
      if (!user.isEmailVerified) {
        let emailSent = false;
        const codeExpired = !user.emailVerificationExpires || user.emailVerificationExpires < Date.now();
        if (codeExpired && resendWaitSeconds(user) === 0) {
          emailSent = await issueVerificationCode(user);
        }
        return res.status(403).json({
          message: emailSent
            ? `Please verify your email first. We sent a new code to ${user.email}.`
            : 'Please verify your email first. Enter the code we sent to your inbox.',
          ...verificationPayload(user, emailSent),
        });
      }

      // Pending / rejected organizers still get a token so they can see their
      // status and resubmit documents. organizerOnly blocks everything else.
      res.json(toAuthResponse(user));
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------
   EMAIL VERIFICATION
   ------------------------------------------ */

// POST /api/auth/verify-email  body: { email, code }
// On success the account is activated and the user is logged in (token returned).
exports.verifyEmail = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').replace(/\D/g, '');

    const errors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (code.length !== 6) errors.code = 'Enter the 6-digit code.';
    if (sendValidationErrors(res, errors)) return;

    const user = await User.findOne({ email }).select('+emailVerificationCode');
    // Same message for "no account" and "wrong code" so emails can't be probed.
    const invalid = () => res.status(400).json({
      message: 'Invalid or expired code.',
      errors: { code: 'Invalid or expired code.' },
    });

    if (!user) return invalid();

    if (user.isEmailVerified) {
      return res.json({ message: 'Your email is already verified. You can sign in.', alreadyVerified: true });
    }

    if (user.isSuspended) {
      return res.status(403).json({ message: 'This account has been suspended by the admin.', suspended: true });
    }

    if (!user.emailVerificationCode || !user.emailVerificationExpires || user.emailVerificationExpires < Date.now()) {
      return res.status(400).json({
        message: 'This code has expired. Tap "Resend code" to get a new one.',
        errors: { code: 'Code expired.' },
        expired: true,
      });
    }

    if (user.emailVerificationAttempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        message: 'Too many wrong codes. Tap "Resend code" to get a new one.',
        errors: { code: 'Too many attempts.' },
        expired: true,
      });
    }

    if (!codesMatch(code, user.emailVerificationCode)) {
      user.emailVerificationAttempts += 1;
      await user.save();
      const left = MAX_CODE_ATTEMPTS - user.emailVerificationAttempts;
      return res.status(400).json({
        message: left > 0
          ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many wrong codes. Tap "Resend code" to get a new one.',
        errors: { code: 'Incorrect code.' },
        attemptsLeft: left,
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationCode = null;
    user.emailVerificationExpires = null;
    user.emailVerificationAttempts = 0;
    await user.save();

    res.json({ message: 'Email verified!', ...toAuthResponse(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/auth/resend-verification  body: { email }
// Always answers the same way so it can't be used to check which emails exist.
exports.resendVerificationCode = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const emailError = validateEmail(email);
    if (emailError) return sendValidationErrors(res, { email: emailError });

    const generic = { message: 'If this account still needs verification, a new code has been sent.' };
    const user = await User.findOne({ email });
    if (!user || user.isEmailVerified || user.isSuspended) {
      return res.json({ ...generic, resendAvailableIn: RESEND_COOLDOWN_SECONDS });
    }

    const wait = resendWaitSeconds(user);
    if (wait > 0) {
      return res.status(429).json({
        message: `Please wait ${wait}s before requesting another code.`,
        retryAfter: wait,
        resendAvailableIn: wait,
      });
    }

    const emailSent = await issueVerificationCode(user);
    if (!emailSent) {
      return res.status(502).json({
        message: "We couldn't send the email right now. Please try again in a minute.",
        resendAvailableIn: resendWaitSeconds(user),
      });
    }
    res.json({ message: `A new code was sent to ${user.email}.`, resendAvailableIn: RESEND_COOLDOWN_SECONDS });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------
   FORGOT PASSWORD (email code)
   Volunteers and organizers only. Admins change their password in Account Settings.
   ------------------------------------------ */

const RESET_ROLES = ['volunteer', 'organizer'];

const resetWaitSeconds = (user) => {
  if (!user.passwordResetSentAt) return 0;
  const elapsed = (Date.now() - new Date(user.passwordResetSentAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
};

// POST /api/auth/forgot-password  body: { email }
// Always gives the same answer so it can't be used to find out which emails have accounts.
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const emailError = validateEmail(email);
    if (emailError) return sendValidationErrors(res, { email: emailError });

    const generic = {
      message: `If an EcoTask account uses ${email}, we sent a 6-digit reset code to it.`,
      email,
      resendAvailableIn: RESEND_COOLDOWN_SECONDS,
    };

    const user = await User.findOne({ email });
    if (!user || !RESET_ROLES.includes(user.role) || user.isSuspended) {
      return res.json(generic);
    }

    const wait = resetWaitSeconds(user);
    if (wait > 0) {
      return res.status(429).json({
        message: `Please wait ${wait}s before requesting another code.`,
        retryAfter: wait,
        resendAvailableIn: wait,
        email,
      });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    user.passwordResetCode = hashCode(code);
    user.passwordResetExpires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    user.passwordResetAttempts = 0;
    user.passwordResetSentAt = new Date();
    await user.save();

    try {
      await sendPasswordResetCodeEmail({ to: user.email, name: user.name, code, minutes: CODE_TTL_MINUTES });
    } catch (err) {
      console.error('Failed to send password reset email:', err.message);
      return res.status(502).json({ message: "We couldn't send the email right now. Please try again in a minute." });
    }

    res.json(generic);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Shared code check for the two reset steps. Returns null when the code is right,
// otherwise the error response has already been sent.
const checkResetCode = async (res, email, code) => {
  const user = await User.findOne({ email }).select('+passwordResetCode');
  const invalid = (message = 'Invalid or expired code.', extra = {}) => {
    res.status(400).json({ message, errors: { code: message }, ...extra });
    return null;
  };

  if (!user || !RESET_ROLES.includes(user.role) || user.isSuspended) return invalid();

  if (!user.passwordResetCode || !user.passwordResetExpires || user.passwordResetExpires < Date.now()) {
    return invalid('This code has expired. Tap "Resend code" to get a new one.', { expired: true });
  }

  if (user.passwordResetAttempts >= MAX_CODE_ATTEMPTS) {
    res.status(429).json({
      message: 'Too many wrong codes. Tap "Resend code" to get a new one.',
      errors: { code: 'Too many attempts.' },
      expired: true,
    });
    return null;
  }

  if (!codesMatch(code, user.passwordResetCode)) {
    user.passwordResetAttempts += 1;
    await user.save();
    const left = MAX_CODE_ATTEMPTS - user.passwordResetAttempts;
    return invalid(left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
      : 'Too many wrong codes. Tap "Resend code" to get a new one.');
  }

  return user;
};

// POST /api/auth/verify-reset-code  body: { email, code }
// Step 2 of forgot password: confirm the code before showing the new-password form.
// The code stays valid (until it expires) so step 3 can use it.
exports.verifyResetCode = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').replace(/\D/g, '');

    const errors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (code.length !== 6) errors.code = 'Enter the 6-digit code.';
    if (sendValidationErrors(res, errors)) return;

    const user = await checkResetCode(res, email, code);
    if (!user) return;

    res.json({
      message: 'Code confirmed. Choose your new password.',
      expiresAt: user.passwordResetExpires,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/auth/reset-password  body: { email, code, password, confirmPassword }
exports.resetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').replace(/\D/g, '');
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword ?? password);

    const errors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (code.length !== 6) errors.code = 'Enter the 6-digit code.';
    const strengthError = validatePassword(password);
    if (strengthError) errors.password = strengthError;
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    if (sendValidationErrors(res, errors)) return;

    const user = await checkResetCode(res, email, code);
    if (!user) return;

    if (await bcrypt.compare(password, user.password)) {
      return res.status(400).json({
        message: 'New password must be different from your old one.',
        errors: { password: 'Use a different password.' },
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
    invalidateOldTokens(user);           // logs out every device that used the old password
    user.isEmailVerified = true;         // they just proved they own this inbox
    user.passwordResetCode = null;
    user.passwordResetExpires = null;
    user.passwordResetAttempts = 0;
    await user.save();

    res.json({ message: 'Password reset. You can now log in with your new password.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------
   ACCOUNT SETTINGS (any logged-in user; used by Admin → Account Settings)
   ------------------------------------------ */

// Everything issued before "now" becomes invalid. The 1s margin avoids
// rejecting the fresh token we return in the same second.
const invalidateOldTokens = (user) => {
  user.tokensValidAfter = new Date(Date.now() - 1000);
};

// PUT /api/auth/me  body: { name, email, currentPassword }
// currentPassword is required only when the email changes.
exports.updateMyProfile = async (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || '');

    const errors = {};
    const nameError = validateName(name);
    const emailError = validateEmail(email);
    if (nameError) errors.name = nameError;
    if (emailError) errors.email = emailError;
    if (sendValidationErrors(res, errors)) return;

    const user = await User.findById(req.user._id);
    const emailChanged = email !== user.email;

    if (emailChanged) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({
          message: 'Enter your current password to change your email.',
          errors: { currentPassword: 'Current password is incorrect.' },
        });
      }
      const taken = await User.exists({ email, _id: { $ne: user._id } });
      if (taken) {
        return res.status(409).json({ message: 'That email is already used by another account.', errors: { email: 'Email already in use.' } });
      }
    }

    if (name === user.name && !emailChanged) {
      return res.status(400).json({ message: 'No changes to save.' });
    }

    user.name = name;
    user.email = email;
    await user.save();
    res.json({ message: 'Profile updated.', user: toAuthResponse(user, false) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/auth/me/password  body: { currentPassword, newPassword, confirmPassword }
// Logs out every other device; returns a fresh token for this one.
exports.changeMyPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    const errors = {};
    if (!currentPassword) errors.currentPassword = 'Current password is required.';
    const strengthError = validatePassword(newPassword);
    if (strengthError) errors.newPassword = strengthError;
    if (newPassword !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    if (sendValidationErrors(res, errors)) return;

    const user = await User.findById(req.user._id);
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ message: 'Current password is incorrect.', errors: { currentPassword: 'Current password is incorrect.' } });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: 'New password must be different from the current one.', errors: { newPassword: 'Use a different password.' } });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordChangedAt = new Date();
    invalidateOldTokens(user);
    await user.save();

    res.json({ message: 'Password changed. Other devices have been logged out.', ...toAuthResponse(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/auth/me/logout-all - ends every session, then returns a fresh token for this device.
exports.logoutAllDevices = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    invalidateOldTokens(user);
    await user.save();
    res.json({ message: 'Logged out of all other devices.', ...toAuthResponse(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
