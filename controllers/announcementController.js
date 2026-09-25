// Controller for creating, listing, and managing announcements shown to users.
const Announcement = require('../models/Announcement');

const populateAuthor = (query) => query.populate('author', 'name');

// Fetch the latest announcements with the author's name included.
exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await populateAuthor(
      Announcement.find().sort({ createdAt: -1 })
    );
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new announcement from admin input and attach the author.
exports.createAnnouncement = async (req, res) => {
  try {
    const { title, category, description, message } = req.body;
    const announcement = await Announcement.create({
      title,
      category,
      description: description || message,
      message: message || description,
      author: req.user._id,
    });
    await announcement.populate('author', 'name');
    res.status(201).json(announcement);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update announcement content while keeping both description and message fields in sync.
exports.updateAnnouncement = async (req, res) => {
  try {
    const update = { ...req.body };
    if (update.description && !update.message) update.message = update.description;
    if (update.message && !update.description) update.description = update.message;
    const announcement = await populateAuthor(
      Announcement.findByIdAndUpdate(req.params.id, update, {
        new: true,
        runValidators: true,
      })
    );

    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });
    res.json(announcement);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Remove an announcement if it exists and return a success message.
exports.deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};