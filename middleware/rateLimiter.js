const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Logged-in requests are counted per account; everything else per IP
const userOrIpKey = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      if (decoded.id) return `user:${decoded.id}`;
    } catch (_) { /* bad/expired token → fall back to IP */ }
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
};

const createLimiter = ({ windowMs, max, message, keyGenerator }) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  ...(keyGenerator && { keyGenerator }),
  handler: (req, res) => {
    const resetTime = req.rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.max(1, Math.ceil((new Date(resetTime).getTime() - Date.now()) / 1000))
      : Math.ceil(windowMs / 1000);
    res.status(429).json({ message, retryAfter });
  },
});

// Login & register stay per IP (stops password guessing / spam accounts)
exports.loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, max: 5,
  message: 'Too many login attempts. Please try again later.',
});

exports.registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, max: 5,
  message: 'Too many accounts created from this device. Please try again later.',
});

// Email verification: limit code guesses and resend emails per IP
exports.verifyEmailLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, max: 15,
  message: 'Too many verification attempts. Please try again later.',
});

exports.resendCodeLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, max: 6,
  message: 'Too many code requests. Please try again later.',
});

// Forgot password: limit reset emails and code guesses per IP
exports.forgotPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, max: 6,
  message: 'Too many reset requests. Please try again later.',
});

exports.resetPasswordLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, max: 15,
  message: 'Too many reset attempts. Please try again later.',
});

// General API: per account, higher limit
exports.apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, max: 1000,
  message: 'Too many requests. Please slow down.',
  keyGenerator: userOrIpKey,
});