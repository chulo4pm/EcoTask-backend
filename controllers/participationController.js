// Handles volunteer participation records, attendance tracking, and certificates.
// Organizers can only manage records for activities they own.
const Participation = require('../models/Participation');
const Activity = require('../models/Activity');

// Checks that the logged-in organizer owns the activity. Admins may view (read-only).
const canManageActivity = (user, activity) => (
  user.role === 'organizer' && String(activity.organizer) === String(user._id)
);

// Return the logged-in user's joined activities in a simple activity history format.
exports.getMyRecords = async (req, res) => {
  try {
    const records = await Participation.find({ user: req.user._id })
      .populate('activity', 'title date location time')
      .sort({ joinedAt: -1 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await Promise.all(records.map(async (record) => {
      const activityDate = record.activity?.date ? new Date(record.activity.date) : null;
      if (record.attendance === null && activityDate && activityDate < today) {
        record.attendance = 'absent';
        await record.save();
      }
    }));

    res.json(records.map((record) => ({
      _id: record._id,
      activityId: record.activity?._id,
      activityTitle: record.activity?.title,
      date: record.activity?.date,
      location: record.activity?.location,
      time: record.activity?.time,
      attendance: record.attendance,
      certificateIssued: record.certificateIssued,
      certificateIssuedAt: record.certificateIssuedAt,
      certificateId: record.certificateId,
      joinedAt: record.joinedAt,
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Issue certificates to volunteers marked present for a completed activity (owner organizer only).
exports.issueActivityCertificates = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.activityId).select('title date organizer');
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    if (!canManageActivity(req.user, activity)) {
      return res.status(403).json({ message: 'You can only issue certificates for your own activities' });
    }

    const eligibleRecords = await Participation.find({
      activity: activity._id,
      attendance: 'present',
    });
    if (eligibleRecords.length === 0) {
      return res.status(400).json({ message: 'Mark at least one volunteer as present before issuing certificates.' });
    }

    const issuedAt = new Date();
    const updates = eligibleRecords.map((record) => {
      if (record.certificateIssued && record.certificateId) return record.save();
      record.certificateIssued = true;
      record.certificateIssuedAt = issuedAt;
      record.certificateId = `CERT-${record._id.toString().slice(-8).toUpperCase()}`;
      return record.save();
    });
    await Promise.all(updates);

    res.json({
      message: `Certificates issued to ${eligibleRecords.length} present volunteer(s).`,
      issuedCount: eligibleRecords.length,
      activity: { _id: activity._id, title: activity.title, date: activity.date },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Return participation records for an activity.
// Volunteers see only their own record; organizers only for their own activities; admins read-only.
exports.getActivityParticipation = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.activityId).select('organizer');
    if (!activity) return res.status(404).json({ message: 'Activity not found' });

    const query = { activity: req.params.activityId };
    if (req.user.role === 'volunteer') query.user = req.user._id;
    if (req.user.role === 'organizer' && !canManageActivity(req.user, activity)) {
      return res.status(403).json({ message: 'You can only view records for your own activities' });
    }

    const records = await Participation.find(query)
      .populate('activity', 'title date')
      .populate('user', 'name email phone')
      .sort({ joinedAt: 1 });

    res.json(records);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark attendance as present, absent, or late (owner organizer only).
exports.updateAttendance = async (req, res) => {
  try {
    const attendance = String(req.body.attendance || '');
    if (!['present', 'absent', 'late'].includes(attendance)) {
      return res.status(400).json({ message: 'Invalid attendance value' });
    }

    const record = await Participation.findById(req.params.id).populate('activity', 'title date organizer');
    if (!record) return res.status(404).json({ message: 'Participation record not found' });
    if (!record.activity || !canManageActivity(req.user, record.activity)) {
      return res.status(403).json({ message: 'You can only update attendance for your own activities' });
    }

    record.attendance = attendance;
    await record.save();
    await record.populate('user', 'name email phone');
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
