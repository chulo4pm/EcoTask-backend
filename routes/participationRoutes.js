// Routes for tracking volunteer attendance and participation records.
const express = require('express');
const {
  getMyRecords,
  getActivityParticipation,
  updateAttendance,
  issueActivityCertificates,
} = require('../controllers/participationController');
const { protect, organizerOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Volunteers view their own records; organizers manage attendance and certificates
// for their own activities (ownership is checked in the controller).
router.get('/my-records', protect, getMyRecords);
router.get('/activity/:activityId', protect, getActivityParticipation);
router.patch('/:id/attendance', protect, organizerOnly, updateAttendance);
router.post('/activity/:activityId/certificates', protect, organizerOnly, issueActivityCertificates);

module.exports = router;
