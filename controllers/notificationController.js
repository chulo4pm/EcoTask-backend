// The logged-in user's notifications (bell menu).
const Notification = require('../models/Notification');

const toResponse = (n) => ({
  _id: n._id,
  type: n.type,
  title: n.title,
  message: n.message,
  read: Boolean(n.readAt),
  createdAt: n.createdAt,
});

// GET /api/notifications  -> latest 50 + unread count
exports.getMyNotifications = async (req, res) => {
  try {
    const [items, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ user: req.user._id, readAt: null }),
    ]);
    res.json({ notifications: items.map(toResponse), unreadCount });
  } catch (error) {
    res.status(500).json({ message: 'Could not load notifications.' });
  }
};

// PATCH /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, readAt: null }, { readAt: new Date() });
    res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ message: 'Could not update notifications.' });
  }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id, readAt: null }, { readAt: new Date() });
    res.json({ message: 'Marked as read.' });
  } catch (error) {
    res.status(500).json({ message: 'Could not update the notification.' });
  }
};

// DELETE /api/notifications  -> clear all of my notifications
exports.clearAll = async (req, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });
    res.json({ message: 'Notifications cleared.' });
  } catch (error) {
    res.status(500).json({ message: 'Could not clear notifications.' });
  }
};
