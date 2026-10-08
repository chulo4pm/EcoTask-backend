// Controller for user profile management and admin user listing operations.
const User = require('../models/User');
const Activity = require('../models/Activity');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validateProfileUpdate, sendValidationErrors } = require('../utils/validators');

const toSafeUser = (user, activities = 0) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  activities,
  status: user.isSuspended ? 'Suspended' : 'Active',
  isSuspended: !!user.isSuspended,
  suspendedReason: user.suspendedReason || '',
  suspendedAt: user.suspendedAt || null,
  createdAt: user.createdAt,
});

// Return all users in a safe format along with how many activities each volunteer joined.
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'volunteer' }).sort({ createdAt: -1 });
    const activityCounts = await Activity.aggregate([
      { $unwind: '$participants' },
      { $group: { _id: '$participants', activities: { $sum: 1 } } },
    ]);
    const counts = new Map(activityCounts.map((item) => [item._id.toString(), item.activities]));

    res.json(users.map((user) => toSafeUser(user, counts.get(user._id.toString()) || 0)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Fetch one user by ID and include a count of their joined activities.
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: 'volunteer' });

    if (!user) {
      return res.status(404).json({ message: 'Volunteer not found' });
    }

    const activities = await Activity.countDocuments({ participants: user._id });
    res.json(toSafeUser(user, activities));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/users/me/verify-password  body: { currentPassword }
// Checked before the Settings page unlocks the edit form. Saving checks the password again.
exports.verifyMyPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    if (!currentPassword) {
      return res.status(400).json({
        message: 'Enter your current password.',
        errors: { currentPassword: 'Current password is required.' },
      });
    }

    const user = await User.findById(req.user._id);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({
        message: 'Current password is incorrect.',
        errors: { currentPassword: 'Current password is incorrect.' },
      });
    }

    res.json({ message: 'Password confirmed.' });
  } catch (error) {
    res.status(500).json({ message: 'Could not check your password. Please try again.' });
  }
};

// PATCH /api/users/me  body: { currentPassword, name?, phone?, newPassword? }
// Volunteers update their own name, phone, or password.
// - The current password is ALWAYS required, so a stolen login token alone can't take over the account.
// - Email can't be changed here (it was verified when the account was created).
// - A new password logs out every other device and returns a fresh token for this one.
exports.updateMyProfile = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const name = req.body.name !== undefined ? String(req.body.name).trim().replace(/\s+/g, ' ') : undefined;
    const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : undefined;
    const newPassword = req.body.newPassword ? String(req.body.newPassword) : '';

    if (!currentPassword) {
      return res.status(400).json({
        message: 'Enter your current password to save changes.',
        errors: { currentPassword: 'Current password is required.' },
      });
    }

    // Reject bad input before touching the database.
    if (sendValidationErrors(res, validateProfileUpdate({ name, phone, newPassword }))) return;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.body.email !== undefined && String(req.body.email).trim().toLowerCase() !== user.email) {
      return res.status(400).json({
        message: "Email can't be changed.",
        errors: { email: "Email can't be changed." },
      });
    }

    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({
        message: 'Current password is incorrect.',
        errors: { currentPassword: 'Current password is incorrect.' },
      });
    }

    if (newPassword && (await bcrypt.compare(newPassword, user.password))) {
      return res.status(400).json({
        message: 'New password must be different from your current one.',
        errors: { newPassword: 'Use a different password.' },
      });
    }

    const nameChanged = name !== undefined && name !== user.name;
    const phoneChanged = phone !== undefined && phone !== (user.phone || '');
    if (!nameChanged && !phoneChanged && !newPassword) {
      return res.status(400).json({ message: 'No changes to save.' });
    }

    if (nameChanged) user.name = name;
    if (phoneChanged) user.phone = phone;
    if (newPassword) {
      user.password = await bcrypt.hash(newPassword, 10);
      user.passwordChangedAt = new Date();
      // Every token issued before now stops working (logs out other devices).
      user.tokensValidAfter = new Date(Date.now() - 1000);
    }

    await user.save();

    res.json({
      message: newPassword ? 'Profile saved. Other devices have been logged out.' : 'Profile saved.',
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      passwordChangedAt: user.passwordChangedAt || null,
      // New token for this device, since the old one was just invalidated.
      ...(newPassword && {
        token: jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        }),
      }),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Remove a non-admin user account after validating the target record.
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'volunteer') {
      return res.status(403).json({ message: 'Only volunteer accounts can be deleted' });
    }

    await user.deleteOne();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};