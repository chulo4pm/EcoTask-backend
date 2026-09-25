// Report schema: a volunteer flags an activity for the admin to review.
const mongoose = require('mongoose');

const REPORT_REASONS = [
  'Misleading or false information',
  'Inappropriate content',
  'Scam or suspicious activity',
  'Safety concern',
  'Activity did not happen',
  'Other',
];

const reportSchema = new mongoose.Schema({
  activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, trim: true, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['open', 'dismissed', 'actioned'],
    default: 'open',
  },
  adminNote: { type: String, trim: true, maxlength: 500, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

// One report per volunteer per activity.
reportSchema.index({ activity: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
