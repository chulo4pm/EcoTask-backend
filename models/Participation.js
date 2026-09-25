// Participation schema that records each user's join status and attendance for an activity.
const mongoose = require('mongoose');

const participationSchema = new mongoose.Schema({
  activity: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Activity',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  attendance: {
    type: String,
    enum: ['present', 'absent', 'late'],
    default: null,
  },
  certificateIssued: {
    type: Boolean,
    default: false,
  },
  certificateIssuedAt: {
    type: Date,
    default: null,
  },
  certificateId: {
    type: String,
    default: null,
  },
}, { timestamps: true });

participationSchema.index({ activity: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Participation', participationSchema);
