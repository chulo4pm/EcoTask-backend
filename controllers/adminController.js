// Admin-only tools: organizer approvals, organizer account management, and activity oversight.
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Activity = require('../models/Activity');
const Participation = require('../models/Participation');
const { DOCUMENT_DIR } = require('../middleware/documentUpload');
const { BUCKETS, findFile, openDownloadStream, deleteFile } = require('../utils/fileStore');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id));

const toOrganizerSummary = (user, activityCount = 0) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  organizationName: user.organizationName,
  organizerStatus: user.organizerStatus,
  rejectionReason: user.rejectionReason,
  reviewedAt: user.reviewedAt,
  isSuspended: !!user.isSuspended,
  suspendedReason: user.suspendedReason || '',
  suspendedAt: user.suspendedAt || null,
  createdAt: user.createdAt,
  activityCount,
  documents: (user.organizerDocuments || []).map((doc) => ({
    _id: doc._id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedAt: doc.uploadedAt,
  })),
});

// GET /api/admin/organizers?status=pending
exports.getOrganizers = async (req, res) => {
  try {
    const status = String(req.query.status || '');
    const filter = { role: 'organizer' };
    if (['pending', 'approved', 'rejected'].includes(status)) filter.organizerStatus = status;
    if (status === 'active') Object.assign(filter, { organizerStatus: 'approved', isSuspended: { $ne: true } });
    if (status === 'suspended') filter.isSuspended = true;

    const organizers = await User.find(filter).select('-password').sort({ createdAt: -1 });
    const counts = await Activity.aggregate([
      { $match: { organizer: { $in: organizers.map((o) => o._id) } } },
      { $group: { _id: '$organizer', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json(organizers.map((o) => toOrganizerSummary(o, countMap.get(String(o._id)) || 0)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/admin/organizers/:id/documents/:docId - streams a private document to the admin.
exports.getOrganizerDocument = async (req, res) => {
  try {
    if (!isValidId(req.params.id) || !isValidId(req.params.docId)) {
      return res.status(404).json({ message: 'Document not found' });
    }
    const organizer = await User.findOne({ _id: req.params.id, role: 'organizer' }).select('organizerDocuments');
    const doc = organizer?.organizerDocuments.id(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    // path.basename blocks path tricks like "../../.env"
    const fileName = path.basename(doc.fileName);
    const filePath = path.join(DOCUMENT_DIR, fileName);
    const onDisk = fs.existsSync(filePath); // older uploads were saved on disk
    const stored = onDisk ? null : await findFile(BUCKETS.organizerDocuments, fileName);
    if (!onDisk && !stored) return res.status(404).json({ message: 'File is missing on the server' });

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (onDisk) return fs.createReadStream(filePath).pipe(res);
    openDownloadStream(BUCKETS.organizerDocuments, stored._id)
      .on('error', () => res.end())
      .pipe(res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/organizers/:id/approve
exports.approveOrganizer = async (req, res) => {
  try {
    const organizer = await User.findOne({ _id: req.params.id, role: 'organizer' });
    if (!organizer) return res.status(404).json({ message: 'Organizer not found' });

    organizer.organizerStatus = 'approved';
    organizer.rejectionReason = '';
    organizer.reviewedBy = req.user._id;
    organizer.reviewedAt = new Date();
    await organizer.save();

    res.json({ message: `${organizer.organizationName || organizer.name} approved.`, organizer: toOrganizerSummary(organizer) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/organizers/:id/reject  body: { reason }
exports.rejectOrganizer = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5 || reason.length > 500) {
      return res.status(400).json({
        message: 'Please give a reason (5-500 characters). The organizer will see it.',
        errors: { reason: 'Reason required.' },
      });
    }

    const organizer = await User.findOne({ _id: req.params.id, role: 'organizer' });
    if (!organizer) return res.status(404).json({ message: 'Organizer not found' });

    organizer.organizerStatus = 'rejected';
    organizer.rejectionReason = reason;
    organizer.reviewedBy = req.user._id;
    organizer.reviewedAt = new Date();
    await organizer.save();

    res.json({ message: `${organizer.organizationName || organizer.name} rejected.`, organizer: toOrganizerSummary(organizer) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/activities/:id/visibility  body: { hidden: true|false, reason }
exports.setActivityVisibility = async (req, res) => {
  try {
    const hidden = req.body.hidden === true || req.body.hidden === 'true';
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (hidden && reason.length < 5) {
      return res.status(400).json({ message: 'Please give a reason for hiding the activity.' });
    }

    const activity = await Activity.findByIdAndUpdate(
      req.params.id,
      hidden
        ? { isHidden: true, hiddenReason: reason, hiddenAt: new Date() }
        : { isHidden: false, hiddenReason: '', hiddenAt: null },
      { new: true }
    ).populate('organizer', 'name organizationName');

    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    res.json({ message: hidden ? 'Activity hidden.' : 'Activity visible again.', activity });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/activities/:id/organizer  body: { organizerId }
// Assigns an older (admin-created) activity to an approved organizer.
exports.assignActivityOrganizer = async (req, res) => {
  try {
    const organizerId = String(req.body.organizerId || '');
    if (!isValidId(organizerId)) return res.status(400).json({ message: 'Choose an organizer.' });

    const organizer = await User.findOne({ _id: organizerId, role: 'organizer', organizerStatus: 'approved', isSuspended: { $ne: true } });
    if (!organizer) return res.status(400).json({ message: 'Organizer must be an approved, active organizer account.' });

    const activity = await Activity.findByIdAndUpdate(
      req.params.id,
      { organizer: organizer._id },
      { new: true }
    ).populate('organizer', 'name organizationName');

    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    res.json({ message: `Assigned to ${organizer.organizationName || organizer.name}.`, activity });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ------------------------------------------
   ORGANIZER ACCOUNT MANAGEMENT
   ------------------------------------------ */

const findOrganizer = async (id, res) => {
  if (!isValidId(id)) {
    res.status(404).json({ message: 'Organizer not found' });
    return null;
  }
  const organizer = await User.findOne({ _id: id, role: 'organizer' });
  if (!organizer) res.status(404).json({ message: 'Organizer not found' });
  return organizer;
};

// GET /api/admin/organizers/:id - full profile, activities and totals
exports.getOrganizerDetails = async (req, res) => {
  try {
    const organizer = await findOrganizer(req.params.id, res);
    if (!organizer) return;

    const activities = await Activity.find({ organizer: organizer._id })
      .select('title date location volunteerLimit participants isHidden hiddenReason hiddenBySuspension')
      .sort({ date: -1 });

    const activityIds = activities.map((a) => a._id);
    const [attended, certificates] = await Promise.all([
      Participation.countDocuments({ activity: { $in: activityIds }, attendance: { $in: ['present', 'late'] } }),
      Participation.countDocuments({ activity: { $in: activityIds }, certificateIssued: true }),
    ]);

    res.json({
      ...toOrganizerSummary(organizer, activities.length),
      activities: activities.map((a) => ({
        _id: a._id,
        title: a.title,
        date: a.date,
        location: a.location,
        volunteerLimit: a.volunteerLimit,
        participantCount: a.participants?.length || 0,
        isHidden: a.isHidden,
        hiddenReason: a.hiddenReason,
        hiddenBySuspension: a.hiddenBySuspension,
      })),
      totals: {
        activities: activities.length,
        volunteersJoined: activities.reduce((sum, a) => sum + (a.participants?.length || 0), 0),
        volunteersAttended: attended,
        certificatesIssued: certificates,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/organizers/:id/suspend  body: { reason }
// Blocks login + API access and hides all of the organizer's activities from volunteers.
exports.suspendOrganizer = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 5 || reason.length > 500) {
      return res.status(400).json({
        message: 'Please give a reason (5-500 characters). The organizer will see it.',
        errors: { reason: 'Reason required.' },
      });
    }

    const organizer = await findOrganizer(req.params.id, res);
    if (!organizer) return;
    if (organizer.organizerStatus !== 'approved') {
      return res.status(400).json({ message: 'Only approved organizers can be suspended. Use Organizer Approvals for pending or rejected accounts.' });
    }
    if (organizer.isSuspended) return res.status(400).json({ message: 'This organizer is already suspended.' });

    Object.assign(organizer, {
      isSuspended: true,
      suspendedReason: reason,
      suspendedAt: new Date(),
      suspendedBy: req.user._id,
    });
    await organizer.save();

    const result = await Activity.updateMany({ organizer: organizer._id }, { hiddenBySuspension: true });

    res.json({
      message: `${organizer.organizationName || organizer.name} suspended. ${result.modifiedCount} activit${result.modifiedCount === 1 ? 'y' : 'ies'} hidden from volunteers.`,
      organizer: toOrganizerSummary(organizer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PATCH /api/admin/organizers/:id/reactivate
exports.reactivateOrganizer = async (req, res) => {
  try {
    const organizer = await findOrganizer(req.params.id, res);
    if (!organizer) return;
    if (!organizer.isSuspended) return res.status(400).json({ message: 'This organizer is not suspended.' });

    Object.assign(organizer, { isSuspended: false, suspendedReason: '', suspendedAt: null, suspendedBy: null });
    await organizer.save();

    // Only undo the suspension-hiding. Activities hidden because of reports stay hidden.
    await Activity.updateMany({ organizer: organizer._id }, { hiddenBySuspension: false });

    res.json({
      message: `${organizer.organizationName || organizer.name} reactivated.`,
      organizer: toOrganizerSummary(organizer),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/admin/organizers/:id
// Deletes the account and its private documents. Activities are KEPT (with their
// volunteer and certificate records) but hidden and unassigned, so the admin can
// assign them to another organizer in Activity Oversight.
exports.deleteOrganizer = async (req, res) => {
  try {
    const organizer = await findOrganizer(req.params.id, res);
    if (!organizer) return;

    const label = organizer.organizationName || organizer.name;
    const result = await Activity.updateMany(
      { organizer: organizer._id },
      {
        organizer: null,
        isHidden: true,
        hiddenReason: `Organizer account (${label}) was deleted. Assign a new organizer before showing it again.`,
        hiddenAt: new Date(),
        hiddenBySuspension: false,
      }
    );

    // Remove the private verification files (database and any older disk copies)
    await Promise.all((organizer.organizerDocuments || []).map((doc) => Promise.all([
      deleteFile(BUCKETS.organizerDocuments, path.basename(doc.fileName)).catch(() => {}),
      fs.promises.unlink(path.join(DOCUMENT_DIR, path.basename(doc.fileName))).catch(() => {}),
    ])));

    await User.deleteOne({ _id: organizer._id });

    res.json({
      message: `${label} deleted. ${result.modifiedCount} activit${result.modifiedCount === 1 ? 'y was' : 'ies were'} hidden and can be reassigned in Activity Oversight.`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
