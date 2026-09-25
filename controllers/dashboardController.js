// Dashboard controller for summary metrics across activities, volunteers, organizers, and participation.
const Activity = require('../models/Activity');
const Participation = require('../models/Participation');
const User = require('../models/User');
const Announcement = require('../models/Announcement');
const Report = require('../models/Report');

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Build admin metrics such as activity count, volunteer totals, and registration trends.
exports.getAdminStats = async (req, res) => {
  try {
    const [activitiesCreated, totalVolunteers, monthlyRegistrations, certificatesIssued, pendingOrganizers, openReports, approvedOrganizers] = await Promise.all([
      Activity.countDocuments(),
      User.countDocuments({ role: 'volunteer' }),
      User.aggregate([
        { $match: { role: 'volunteer' } },
        { $group: { _id: { $month: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { '_id': 1 } },
      ]),
      Participation.countDocuments({ certificateIssued: true }),
      User.countDocuments({ role: 'organizer', organizerStatus: 'pending' }),
      Report.countDocuments({ status: 'open' }),
      User.countDocuments({ role: 'organizer', organizerStatus: 'approved' }),
    ]);

    res.json({
      activitiesCreated,
      totalVolunteers,
      certificatesIssued,
      pendingOrganizers,
      openReports,
      approvedOrganizers,
      monthlyRegistrations: monthlyRegistrations.map((item) => ({
        month: monthNames[item._id - 1],
        count: item.count,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Build the current volunteer's personal dashboard summary from their records.
exports.getVolunteerStats = async (req, res) => {
  try {
    const records = await Participation.find({ user: req.user._id }).populate('activity', 'status');
    res.json({
      activitiesJoined: records.length,
      completedActivities: records.filter((record) => record.attendance === 'present').length,
      totalHours: 0,
      certificatesEarned: records.filter((record) => record.certificateIssued).length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Summary for the logged-in organizer (their own activities only).
exports.getOrganizerStats = async (req, res) => {
  try {
    const activities = await Activity.find({ organizer: req.user._id }).select('_id date participants isHidden title');
    const activityIds = activities.map((a) => a._id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [certificatesIssued, presentCount, openReports] = await Promise.all([
      Participation.countDocuments({ activity: { $in: activityIds }, certificateIssued: true }),
      Participation.countDocuments({ activity: { $in: activityIds }, attendance: { $in: ['present', 'late'] } }),
      Report.countDocuments({ activity: { $in: activityIds }, status: 'open' }),
    ]);

    res.json({
      totalActivities: activities.length,
      upcomingActivities: activities.filter((a) => new Date(a.date) >= today).length,
      totalVolunteersJoined: activities.reduce((sum, a) => sum + (a.participants?.length || 0), 0),
      volunteersAttended: presentCount,
      certificatesIssued,
      openReports,
      hiddenActivities: activities.filter((a) => a.isHidden).length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Return the latest real admin-facing events for the dashboard activity feed.
exports.getAdminActivityFeed = async (req, res) => {
  try {
    const [activities, registrations, announcements, organizers, reports] = await Promise.all([
      Activity.find().sort({ createdAt: -1 }).limit(50).select('title createdAt').populate('organizer', 'organizationName name'),
      Participation.find()
        .sort({ joinedAt: -1 })
        .limit(50)
        .populate('user', 'name')
        .populate('activity', 'title'),
      Announcement.find().sort({ createdAt: -1 }).limit(50).select('title createdAt'),
      User.find({ role: 'organizer' }).sort({ createdAt: -1 }).limit(20).select('name organizationName createdAt'),
      Report.find().sort({ createdAt: -1 }).limit(20).populate('activity', 'title').select('reason createdAt activity'),
    ]);

    const feed = [
      ...activities.map((activity) => ({
        id: `activity-${activity._id}`,
        title: 'New Activity Published',
        description: `${activity.title} was published${activity.organizer ? ` by ${activity.organizer.organizationName || activity.organizer.name}` : ''}.`,
        timestamp: activity.createdAt,
        type: 'activity',
      })),
      ...registrations
        .filter((record) => record.user && record.activity)
        .map((record) => ({
          id: `registration-${record._id}`,
          title: 'New Volunteer Joined',
          description: `${record.user.name} joined ${record.activity.title}.`,
          timestamp: record.joinedAt,
          type: 'registration',
        })),
      ...announcements.map((announcement) => ({
        id: `announcement-${announcement._id}`,
        title: 'Announcement Posted',
        description: `${announcement.title} was posted.`,
        timestamp: announcement.createdAt,
        type: 'announcement',
      })),
      ...organizers.map((organizer) => ({
        id: `organizer-${organizer._id}`,
        title: 'Organizer Signed Up',
        description: `${organizer.organizationName || organizer.name} applied as an organizer.`,
        timestamp: organizer.createdAt,
        type: 'registration',
      })),
      ...reports
        .filter((report) => report.activity)
        .map((report) => ({
          id: `report-${report._id}`,
          title: 'Activity Reported',
          description: `${report.activity.title}: ${report.reason}.`,
          timestamp: report.createdAt,
          type: 'report',
        })),
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 100);

    res.json(feed);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Rank volunteers by how many activities they actually attended (present or late).
exports.getTopVolunteers = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);

    const results = await Participation.aggregate([
      {
        $group: {
          _id: '$user',
          attended: {
            $sum: { $cond: [{ $in: ['$attendance', ['present', 'late']] }, 1, 0] },
          },
          joined: { $sum: 1 },
        },
      },
      { $match: { attended: { $gt: 0 } } },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $match: { 'user.role': 'volunteer' } },
      { $sort: { attended: -1, joined: -1, 'user.name': 1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          userId: '$user._id',
          name: '$user.name',
          attended: 1,
          joined: 1,
        },
      },
    ]);

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
