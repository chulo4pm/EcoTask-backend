// Routes for publishing and managing system announcements.
const express = require('express');
const {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = require('../controllers/announcementController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Public announcement list or admin-only creation and maintenance.
router.get('/', protect, getAnnouncements);
router.post('/', protect, adminOnly, createAnnouncement);
router.put('/:id', protect, adminOnly, updateAnnouncement);
router.delete('/:id', protect, adminOnly, deleteAnnouncement);

module.exports = router;