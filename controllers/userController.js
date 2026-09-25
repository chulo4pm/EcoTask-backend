// Controller for user profile management and admin user listing operations.
const User = require('../models/User');
const Activity = require('../models/Activity');
const bcrypt = require('bcryptjs');
const { validateProfileUpdate, sendValidationErrors } = require('../utils/validators');

const toSafeUser = (user, activities = 0) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  activities,
  status: 'Active',
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

// Allow the logged-in user to update their own name, email, phone, or password.
exports.updateMyProfile = async (req, res) => {
  try {
    const { name, email, phone, newPassword } = req.body;

    // Reject bad input before touching the database.
    if (sendValidationErrors(res, validateProfileUpdate({ name, email, phone, newPassword }))) return;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;

    if (normalizedEmail && normalizedEmail !== user.email) {
      const emailInUse = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: user._id },
      });

      if (emailInUse) {
        return res.status(409).json({
          message: 'Email is already in use',
          errors: { email: 'Email is already in use' },
        });
      }
    }

    if (name) user.name = name.trim().replace(/\s+/g, ' ');
    if (normalizedEmail) user.email = normalizedEmail;
    if (phone !== undefined) user.phone = String(phone).trim();
    if (newPassword) user.password = await bcrypt.hash(newPassword, 10);

    await user.save();

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
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