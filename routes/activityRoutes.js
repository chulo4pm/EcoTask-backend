// Routes for managing volunteer activities and participation.
const express = require('express');
const router = express.Router();
const {
	getActivities,
	createActivity,
	updateActivity,
	deleteActivity,
	joinActivity,
	leaveActivity,
	getActivityParticipants,
} = require('../controllers/activityController');
const { protect, organizerOnly, volunteerOnly } = require('../middleware/authMiddleware');
const activityUpload = require('../middleware/activityUpload');

// Everyone logged in can list activities (the controller filters by role).
// Only approved organizers can create activities.
router.route('/')
	.get(protect, getActivities)
	.post(protect, organizerOnly, activityUpload.single('coverImage'), createActivity);

// Volunteers can join or leave an activity.
router.post('/:id/join', protect, volunteerOnly, joinActivity);
router.delete('/:id/leave', protect, volunteerOnly, leaveActivity);

// Organizers review who joined their own activity.
router.get('/:id/participants', protect, organizerOnly, getActivityParticipants);

// Organizers edit or remove their own activity (ownership is checked in the controller).
router.route('/:id')
	.put(protect, organizerOnly, activityUpload.single('coverImage'), updateActivity)
	.patch(protect, organizerOnly, activityUpload.single('coverImage'), updateActivity)
	.delete(protect, organizerOnly, deleteActivity);

module.exports = router;
