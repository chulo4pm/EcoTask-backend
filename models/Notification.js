// In-app notification shown in a user's bell (announcements, activity changes, approvals...).
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: [
      'announcement',          // volunteer: admin posted an announcement
      'activity_updated',      // volunteer: an activity they joined was changed
      'activity_cancelled',    // volunteer: an activity they joined was cancelled
      'attendance_marked',     // volunteer: organizer marked their attendance
      'organizer_approved',    // organizer: application approved
      'organizer_rejected',    // organizer: application rejected
      'volunteer_joined',      // organizer: a volunteer joined their activity
      'organizer_application', // admin: a new organizer application needs review
    ],
    required: true,
  },
  title: { type: String, required: true, maxlength: 150 },
  message: { type: String, default: '', maxlength: 500 },
  readAt: { type: Date, default: null },
  // Old notifications clean themselves up after 60 days.
  createdAt: { type: Date, default: Date.now, expires: 60 * 24 * 60 * 60 },
});

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
