// Controller for activities. Organizers manage their OWN activities;
// volunteers browse and join visible ones; admins can see everything (oversight).
const Activity = require('../models/Activity');
const Participation = require('../models/Participation');
const Report = require('../models/Report');
const fs = require('fs/promises');
const path = require('path');
const { BUCKETS, deleteFile } = require('../utils/fileStore');

const removeStoredImage = async (imagePath) => {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  // Images are stored in MongoDB now; older ones may still be on disk.
  await deleteFile(BUCKETS.activityImages, path.basename(imagePath)).catch(() => {});
  try {
    await fs.unlink(path.join(__dirname, '..', imagePath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const parseTasks = (tasks) => {
  if (Array.isArray(tasks)) return tasks.map(String);
  if (!tasks) return [];
  try {
    const parsed = JSON.parse(tasks);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_error) {
    return [String(tasks)];
  }
};

const getDateStatus = (dateValue) => {
  const activityDate = new Date(dateValue);
  const today = new Date();
  activityDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  if (activityDate < today) return 'completed';
  if (activityDate.getTime() === today.getTime()) return 'ongoing';
  return 'upcoming';
};

const formatActivity = (activity) => {
  const result = activity.toObject ? activity.toObject() : activity;
  return {
    ...result,
    status: getDateStatus(result.date),
    participantCount: result.participants?.length || 0,
  };
};

// Only these fields can be set from a form. Prevents a request from setting
// `organizer`, `participants`, or `isHidden` directly (mass-assignment).
const EDITABLE_FIELDS = ['title', 'description', 'location', 'meetingPlace', 'date', 'time', 'volunteerLimit'];

const pickActivityFields = (body) => {
  const data = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) data[field] = String(body[field]).trim();
  });
  if (body.tasks !== undefined) data.tasks = parseTasks(body.tasks);
  if (data.volunteerLimit !== undefined) data.volunteerLimit = Number(data.volunteerLimit);
  return data;
};

const LIMITS = {
  titleMin: 5, titleMax: 100,
  descriptionMin: 20, descriptionMax: 2000,
  placeMin: 3, placeMax: 200,
  volunteerMin: 1, volunteerMax: 1000,
};
const TIME_PATTERN = /^(1[0-2]|[1-9]):00 (AM|PM)$/;

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Same rules as the Create Activity form on the frontend.
// partial: true  -> only validate the fields that were sent (used by update);
//                    every field that IS sent gets the full rules
// checkFutureDate -> reject past dates (create, or when an update changes the date)
const validateActivityFields = (data, { partial = false, checkFutureDate = !partial } = {}) => {
  const errors = {};
  const need = (field) => !partial || data[field] !== undefined;
  const L = LIMITS;

  if (need('title')) {
    const t = data.title || '';
    if (!t) errors.title = 'Title is required.';
    else if (t.length < L.titleMin || t.length > L.titleMax) errors.title = `Title must be ${L.titleMin}-${L.titleMax} characters.`;
    else if (!/[a-zA-Z]/.test(t)) errors.title = 'Title must contain letters, not only numbers or symbols.';
  }

  if (need('description')) {
    const d = data.description || '';
    if (!d) errors.description = 'Description is required.';
    else if (d.length < L.descriptionMin || d.length > L.descriptionMax) errors.description = `Description must be ${L.descriptionMin}-${L.descriptionMax} characters.`;
  }

  ['location', 'meetingPlace'].forEach((field) => {
    if (!need(field)) return;
    const label = field === 'location' ? 'Location' : 'Meeting place';
    const v = data[field] || '';
    if (!v) errors[field] = `${label} is required.`;
    else if (v.length < L.placeMin || v.length > L.placeMax) errors[field] = `${label} must be ${L.placeMin}-${L.placeMax} characters.`;
  });

  if (need('date')) {
    const date = new Date(data.date);
    if (!data.date || Number.isNaN(date.getTime())) {
      errors.date = 'A valid date is required.';
    } else if (checkFutureDate) {
      const today = startOfDay(new Date());
      const oneYear = new Date(today);
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      if (startOfDay(date) < today) errors.date = 'Date cannot be in the past.';
      else if (startOfDay(date) > oneYear) errors.date = 'Date must be within one year from today.';
    }
  }

  if (need('time')) {
    if (!data.time) errors.time = 'Please select a time.';
    else if (!TIME_PATTERN.test(data.time)) errors.time = 'Time must look like "8:00 AM".';
  }

  if (need('volunteerLimit')) {
    const n = data.volunteerLimit;
    if (!Number.isInteger(n) || n < L.volunteerMin || n > L.volunteerMax) {
      errors.volunteerLimit = `Volunteer limit must be a whole number from ${L.volunteerMin} to ${L.volunteerMax}.`;
    }
  }

  return errors;
};

// Load an activity and make sure the logged-in organizer owns it.
const findOwnedActivity = async (req, res) => {
  const activity = await Activity.findById(req.params.id);
  if (!activity) {
    res.status(404).json({ message: 'Activity not found' });
    return null;
  }
  if (req.user.role === 'organizer' && String(activity.organizer) !== String(req.user._id)) {
    res.status(403).json({ message: 'You can only manage activities you created' });
    return null;
  }
  return activity;
};

// Fetch activities based on who is asking:
// - volunteer: all visible (not hidden) activities
// - organizer: only their own activities (including hidden, so they can see why)
// - admin: everything, with organizer info and open report counts
exports.getActivities = async (req, res) => {
  try {
    const { role, _id } = req.user;
    let query;

    if (role === 'organizer') {
      query = Activity.find({ organizer: _id }).populate('participants', 'name email phone');
    } else if (role === 'admin') {
      query = Activity.find().populate('participants', 'name email phone');
    } else {
      query = Activity.find({ isHidden: { $ne: true }, hiddenBySuspension: { $ne: true } });
    }

    const activities = await query
      .populate('organizer', 'name organizationName')
      .sort({ date: 1 });

    let reportCounts = new Map();
    if (role === 'admin' || role === 'organizer') {
      const counts = await Report.aggregate([
        { $match: { status: 'open', activity: { $in: activities.map((a) => a._id) } } },
        { $group: { _id: '$activity', count: { $sum: 1 } } },
      ]);
      reportCounts = new Map(counts.map((item) => [String(item._id), item.count]));
    }

    res.status(200).json(activities.map((activity) => ({
      ...formatActivity(activity),
      ...(role !== 'volunteer' && { openReports: reportCounts.get(String(activity._id)) || 0 }),
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new activity. The logged-in organizer becomes its owner.
exports.createActivity = async (req, res) => {
  try {
    const data = pickActivityFields(req.body);
    const errors = validateActivityFields(data);
    if (Object.keys(errors).length > 0) {
      if (req.file) await removeStoredImage(`/uploads/activities/${req.file.filename}`);
      return res.status(400).json({ message: Object.values(errors)[0], errors });
    }

    const activity = await Activity.create({
      ...data,
      organizer: req.user._id,
      coverImage: req.file ? `/uploads/activities/${req.file.filename}` : null,
    });

    await activity.populate('organizer', 'name organizationName');
    res.status(201).json(formatActivity(activity));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update an activity the organizer owns.
exports.updateActivity = async (req, res) => {
  try {
    const activity = await findOwnedActivity(req, res);
    if (!activity) return;

    const updates = pickActivityFields(req.body);
    const dateChanged = updates.date !== undefined
      && startOfDay(updates.date).getTime() !== startOfDay(activity.date).getTime();
    const errors = validateActivityFields(updates, { partial: true, checkFutureDate: dateChanged });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ message: Object.values(errors)[0], errors });
    }

    if (updates.volunteerLimit !== undefined && updates.volunteerLimit < activity.participants.length) {
      return res.status(400).json({
        message: `Volunteer limit can't be lower than the ${activity.participants.length} volunteers who already joined.`,
      });
    }

    const oldImage = activity.coverImage;
    Object.assign(activity, updates);
    if (req.file) activity.coverImage = `/uploads/activities/${req.file.filename}`;
    await activity.save();
    if (req.file && oldImage !== activity.coverImage) await removeStoredImage(oldImage);

    await activity.populate('participants', 'name email phone');
    await activity.populate('organizer', 'name organizationName');
    res.json(formatActivity(activity));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete an activity the organizer owns, plus its participation records and reports.
exports.deleteActivity = async (req, res) => {
  try {
    const activity = await findOwnedActivity(req, res);
    if (!activity) return;

    await Activity.deleteOne({ _id: activity._id });
    await Participation.deleteMany({ activity: activity._id });
    await Report.deleteMany({ activity: activity._id });
    await removeStoredImage(activity.coverImage);
    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Allow a volunteer to join a visible, upcoming activity if space is available.
exports.joinActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);

    if (!activity || activity.isHidden || activity.hiddenBySuspension) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    if (getDateStatus(activity.date) === 'completed') {
      return res.status(400).json({ message: 'Completed activities cannot be joined' });
    }

    const alreadyJoined = activity.participants.some(
      (participantId) => participantId.toString() === req.user._id.toString()
    );
    if (alreadyJoined) {
      return res.status(409).json({ message: 'You already joined this activity' });
    }

    if (activity.participants.length >= activity.volunteerLimit) {
      return res.status(400).json({ message: 'This activity is full' });
    }

    activity.participants.push(req.user._id);
    await activity.save();
    await Participation.create({ activity: activity._id, user: req.user._id });

    res.status(200).json(formatActivity(activity));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Remove the current user from an activity and delete their participation record.
exports.leaveActivity = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    const participantIndex = activity.participants.findIndex(
      (participantId) => participantId.toString() === req.user._id.toString()
    );
    if (participantIndex === -1) {
      return res.status(400).json({ message: 'You have not joined this activity' });
    }

    activity.participants.splice(participantIndex, 1);
    await activity.save();
    await Participation.deleteOne({ activity: activity._id, user: req.user._id });

    res.json({ message: 'You left the activity successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Return the volunteers who joined an activity (owner organizer or admin).
exports.getActivityParticipants = async (req, res) => {
  try {
    const activity = await findOwnedActivity(req, res);
    if (!activity) return;

    await activity.populate('participants', 'name email phone');

    const records = await Participation.find({ activity: activity._id }).select('user joinedAt');
    const joinedAtByUser = new Map(records.map((record) => [record.user.toString(), record.joinedAt]));
    res.json({
      _id: activity._id,
      title: activity.title,
      volunteerLimit: activity.volunteerLimit,
      participants: activity.participants.map((participant) => ({
        ...participant.toObject(),
        joinedAt: joinedAtByUser.get(participant._id.toString()) || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getDateStatus = getDateStatus;
