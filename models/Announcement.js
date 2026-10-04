// Announcement schema that represents admin notices shared with users.
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    default: 'General',
  },
  description: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    default: '',
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  datePosted: {
    type: Date,
    default: Date.now,
  },
  // Set when the admin changes the title, category, or message after posting.
  editedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Announcement', announcementSchema);
