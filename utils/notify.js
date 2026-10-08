// Helpers that create in-app notifications. They never throw: a failed
// notification must not break the request that triggered it.
const Notification = require('../models/Notification');
const User = require('../models/User');

const clip = (text, max) => String(text || '').slice(0, max);

// userIds: array of ids (ObjectId or string). payload: { type, title, message }
const notifyUsers = async (userIds, { type, title, message = '' }) => {
  try {
    const unique = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
    if (unique.length === 0) return;
    await Notification.insertMany(
      unique.map((user) => ({ user, type, title: clip(title, 150), message: clip(message, 500) })),
      { ordered: false }
    );
  } catch (err) {
    console.error('Could not create notifications:', err.message);
  }
};

const notifyAdmins = async (payload) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id');
    await notifyUsers(admins.map((a) => a._id), payload);
  } catch (err) {
    console.error('Could not notify admins:', err.message);
  }
};

// Every active, email-verified volunteer.
const notifyVolunteers = async (payload) => {
  try {
    const volunteers = await User.find({
      role: 'volunteer',
      isSuspended: { $ne: true },
      isEmailVerified: { $ne: false },
    }).select('_id');
    await notifyUsers(volunteers.map((v) => v._id), payload);
  } catch (err) {
    console.error('Could not notify volunteers:', err.message);
  }
};

module.exports = { notifyUsers, notifyAdmins, notifyVolunteers };
