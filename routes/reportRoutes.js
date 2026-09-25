// Routes for activity reports.
const express = require('express');
const {
  getReportReasons,
  createReport,
  getMyReportedActivities,
  getReports,
  resolveReport,
  getOrganizerReports,
} = require('../controllers/reportController');
const { protect, adminOnly, volunteerOnly, organizerOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/reasons', protect, getReportReasons);
router.post('/', protect, volunteerOnly, createReport);
router.get('/mine', protect, volunteerOnly, getMyReportedActivities);
router.get('/organizer', protect, organizerOnly, getOrganizerReports);
router.get('/', protect, adminOnly, getReports);
router.patch('/:id', protect, adminOnly, resolveReport);

module.exports = router;
