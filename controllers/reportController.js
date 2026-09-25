// Volunteers report activities; admins review them; organizers see reports on their own activities.
const mongoose = require('mongoose');
const Report = require('../models/Report');
const { REPORT_REASONS } = require('../models/Report');
const Activity = require('../models/Activity');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

// GET /api/reports/reasons - list of allowed reasons (for the report form).
exports.getReportReasons = (req, res) => {
  res.json(REPORT_REASONS);
};

// POST /api/reports - volunteer reports an activity.
exports.createReport = async (req, res) => {
  try {
    const activityId = String(req.body.activityId || '');
    const reason = String(req.body.reason || '');
    const details = String(req.body.details || '').trim();

    const errors = {};
    if (!isValidId(activityId)) errors.activityId = 'Invalid activity.';
    if (!REPORT_REASONS.includes(reason)) errors.reason = 'Please choose a reason.';
    if (reason === 'Other' && details.length < 10) errors.details = 'Please describe the problem (at least 10 characters).';
    if (details.length > 500) errors.details = 'Details must be 500 characters or fewer.';
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ message: Object.values(errors)[0], errors });
    }

    const activity = await Activity.findById(activityId).select('_id isHidden');
    if (!activity || activity.isHidden) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    const existing = await Report.findOne({ activity: activity._id, reporter: req.user._id });
    if (existing) {
      return res.status(409).json({ message: 'You already reported this activity. The admin will review it.' });
    }

    const report = await Report.create({
      activity: activity._id,
      reporter: req.user._id,
      reason,
      details,
    });

    res.status(201).json({ message: 'Report submitted. Thank you for helping keep EcoTask safe.', reportId: report._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/reports/mine - activity IDs the volunteer has already reported.
exports.getMyReportedActivities = async (req, res) => {
  try {
    const reports = await Report.find({ reporter: req.user._id }).select('activity');
    res.json(reports.map((report) => String(report.activity)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/reports?status=open - admin list of reports.
exports.getReports = async (req, res) => {
  try {
    const status = String(req.query.status || '');
    const filter = ['open', 'dismissed', 'actioned'].includes(status) ? { status } : {};

    const reports = await Report.find(filter)
      .populate({
        path: 'activity',
        select: 'title date location isHidden hiddenReason organizer',
        populate: { path: 'organizer', select: 'name organizationName email' },
      })
      .populate('reporter', 'name email')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/reports/:id - admin resolves a report.
// body: { action: 'dismiss' | 'hide', note }
// 'hide' hides the activity from volunteers and closes all open reports for it.
exports.resolveReport = async (req, res) => {
  try {
    const action = String(req.body.action || '');
    const note = String(req.body.note || '').trim().slice(0, 500);

    if (!['dismiss', 'hide'].includes(action)) {
      return res.status(400).json({ message: 'Action must be "dismiss" or "hide".' });
    }
    if (action === 'hide' && note.length < 5) {
      return res.status(400).json({ message: 'Please give a reason for hiding the activity (the organizer will see it).', errors: { note: 'Reason required.' } });
    }

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    if (report.status !== 'open') return res.status(400).json({ message: 'This report was already resolved.' });

    const resolvedFields = { resolvedBy: req.user._id, resolvedAt: new Date(), adminNote: note };

    if (action === 'dismiss') {
      Object.assign(report, { status: 'dismissed', ...resolvedFields });
      await report.save();
      return res.json({ message: 'Report dismissed.' });
    }

    await Activity.updateOne(
      { _id: report.activity },
      { isHidden: true, hiddenReason: note, hiddenAt: new Date() }
    );
    const result = await Report.updateMany(
      { activity: report.activity, status: 'open' },
      { status: 'actioned', ...resolvedFields }
    );

    res.json({ message: `Activity hidden. ${result.modifiedCount} report(s) closed.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/reports/organizer - reports about the logged-in organizer's activities.
// Reporter identity is NOT shared with organizers.
exports.getOrganizerReports = async (req, res) => {
  try {
    const activities = await Activity.find({ organizer: req.user._id }).select('_id');
    const reports = await Report.find({ activity: { $in: activities.map((a) => a._id) } })
      .populate('activity', 'title date isHidden hiddenReason')
      .select('-reporter')
      .sort({ createdAt: -1 });

    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
