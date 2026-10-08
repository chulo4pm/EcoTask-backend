// Controller for creating, listing, and managing announcements shown to users.
const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const { notifyVolunteers } = require('../utils/notify');

const populateAuthor = (query) => query.populate('author', 'name');

// Only these categories are allowed (they match the colors in the dashboards).
const CATEGORIES = ['Important', 'Organizer Updates', 'General'];
const LIMITS = { titleMin: 3, titleMax: 100, messageMin: 5, messageMax: 2000 };

// Reads ONLY title, category, and message from the request (nothing else can be set),
// and checks them. Returns { data, errors }.
const readAnnouncement = (body) => {
  const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
  const message = String(body.description ?? body.message ?? '').trim();
  const rawCategory = String(body.category ?? '').trim();
  const category = CATEGORIES.find((c) => c.toLowerCase() === rawCategory.toLowerCase()) || (rawCategory ? null : 'General');

  const errors = {};
  if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) {
    errors.title = `Title must be ${LIMITS.titleMin}-${LIMITS.titleMax} characters.`;
  }
  if (message.length < LIMITS.messageMin || message.length > LIMITS.messageMax) {
    errors.description = `Message must be ${LIMITS.messageMin}-${LIMITS.messageMax} characters.`;
  }
  if (!category) {
    errors.category = `Category must be one of: ${CATEGORIES.join(', ')}.`;
  }

  return { data: { title, category, description: message, message }, errors };
};

const sendErrors = (res, errors) => {
  const keys = Object.keys(errors);
  if (keys.length === 0) return false;
  res.status(400).json({ message: errors[keys[0]], errors });
  return true;
};

// Fetch the latest announcements with the author's name included.
exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await populateAuthor(
      Announcement.find().sort({ createdAt: -1 })
    );
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: 'Could not load announcements.' });
  }
};

// Create a new announcement from admin input and attach the author.
exports.createAnnouncement = async (req, res) => {
  try {
    const { data, errors } = readAnnouncement(req.body);
    if (sendErrors(res, errors)) return;

    const announcement = await Announcement.create({ ...data, author: req.user._id });
    await announcement.populate('author', 'name');
    notifyVolunteers({
      type: 'announcement',
      title: announcement.title,
      message: announcement.description || announcement.message,
    });
    res.status(201).json(announcement);
  } catch (error) {
    res.status(500).json({ message: 'Could not post the announcement.' });
  }
};

// Update an announcement's title, category, and message. Marks it as edited.
exports.updateAnnouncement = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    const { data, errors } = readAnnouncement(req.body);
    if (sendErrors(res, errors)) return;

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });

    const changed = data.title !== announcement.title
      || data.category !== announcement.category
      || data.description !== (announcement.description || announcement.message);
    if (!changed) {
      return res.status(400).json({ message: 'No changes to save.' });
    }

    Object.assign(announcement, data, { editedAt: new Date() });
    await announcement.save();
    await announcement.populate('author', 'name');
    res.json(announcement);
  } catch (error) {
    res.status(500).json({ message: 'Could not save the announcement.' });
  }
};

// Remove an announcement if it exists and return a success message.
exports.deleteAnnouncement = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });
    res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    res.status(500).json({ message: 'Could not delete the announcement.' });
  }
};
