// Activity schema that defines a volunteer opportunity and its participants.
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  location: { type: String, required: true },
  meetingPlace: { type: String, default: '' },
  date: { type: Date, required: true },
  time: { type: String, default: '' },
  tasks: [{ type: String }],
  volunteerLimit: { type: Number, min: 1, default: 50 },
  coverImage: { type: String, default: null },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' },

  // The organizer who owns (created) this activity.
  // Older activities created by the admin have no organizer until the admin assigns one.
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Set by the admin after reviewing reports. Hidden activities are not shown to volunteers.
  isHidden: { type: Boolean, default: false },
  hiddenReason: { type: String, default: '' },
  hiddenAt: { type: Date, default: null },

  // Hidden because the organizer's account is suspended. Kept separate from isHidden
  // so reactivating the organizer doesn't un-hide activities the admin hid for reports.
  hiddenBySuspension: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Activity', activitySchema);
