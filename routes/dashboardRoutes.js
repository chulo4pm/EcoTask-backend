// Routes for dashboard summary data for admins, organizers, and volunteers.
const express = require('express');
const {
  getAdminStats,
  getVolunteerStats,
  getOrganizerStats,
  getAdminActivityFeed,
  getTopVolunteers,
} = require('../controllers/dashboardController');
const { protect, adminOnly, volunteerOnly, organizerOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/admin-stats', protect, adminOnly, getAdminStats);
router.get('/admin-activity-feed', protect, adminOnly, getAdminActivityFeed);
router.get('/top-volunteers', protect, adminOnly, getTopVolunteers);
router.get('/volunteer-stats', protect, volunteerOnly, getVolunteerStats);
router.get('/organizer-stats', protect, organizerOnly, getOrganizerStats);

module.exports = router;
