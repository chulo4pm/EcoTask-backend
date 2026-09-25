// Middleware that enforces authentication and role-based access control for protected endpoints.
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the bearer token and loads the logged-in user for the request.
const protect = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const token = authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Token was issued before a password change / "log out everywhere"
    if (req.user.tokensValidAfter && decoded.iat * 1000 < req.user.tokensValidAfter.getTime()) {
      return res.status(401).json({ message: 'Your session has ended. Please log in again.' });
    }

    // Suspended accounts are blocked from every protected route.
    if (req.user.isSuspended) {
      return res.status(403).json({
        message: 'Your account has been suspended by the admin.',
        suspended: true,
        suspendedReason: req.user.suspendedReason,
      });
    }

    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Allows access only to users with the admin role.
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  next();
};

// Allows access only to users with the volunteer role.
const volunteerOnly = (req, res, next) => {
  if (req.user.role !== 'volunteer') {
    return res.status(403).json({ message: 'Volunteer access required' });
  }

  next();
};

// Any organizer account, approved or not (used for checking status / resubmitting documents).
const organizerAccount = (req, res, next) => {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ message: 'Organizer access required' });
  }

  next();
};

// Only APPROVED organizers can manage activities, attendance, and certificates.
const organizerOnly = (req, res, next) => {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ message: 'Organizer access required' });
  }

  if (req.user.organizerStatus !== 'approved') {
    const message = req.user.organizerStatus === 'rejected'
      ? 'Your organizer account was not approved.'
      : 'Your organizer account is waiting for admin approval.';
    return res.status(403).json({ message, organizerStatus: req.user.organizerStatus });
  }

  next();
};

// Allows any of the listed roles. Example: allowRoles('admin', 'organizer')
const allowRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have access to this action' });
  }
  if (req.user.role === 'organizer' && req.user.organizerStatus !== 'approved') {
    return res.status(403).json({ message: 'Your organizer account is waiting for admin approval.' });
  }

  next();
};

module.exports = { protect, adminOnly, volunteerOnly, organizerAccount, organizerOnly, allowRoles };
