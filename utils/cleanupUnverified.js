// Removes sign-ups that never confirmed their email within 24 hours.
// Only accounts explicitly saved with isEmailVerified: false are touched
// (older accounts default to true), and only volunteers/organizers.
const User = require('../models/User');
const { BUCKETS, deleteFile } = require('./fileStore');

const MAX_AGE_HOURS = 24;
const RUN_EVERY_MINUTES = 60;

const cleanupUnverifiedAccounts = async () => {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

  // "Age" = when the latest code was sent (re-registering sends a new one),
  // falling back to when the account was created.
  const stale = await User.find({
    isEmailVerified: false,
    role: { $in: ['volunteer', 'organizer'] },
    $or: [
      { emailVerificationSentAt: { $lt: cutoff } },
      { emailVerificationSentAt: null, createdAt: { $lt: cutoff } },
      { emailVerificationSentAt: { $exists: false }, createdAt: { $lt: cutoff } },
    ],
  }).select('_id role organizerDocuments');

  if (stale.length === 0) return 0;

  // Organizer documents are stored separately: remove them with the account.
  for (const user of stale) {
    for (const doc of user.organizerDocuments || []) {
      await deleteFile(BUCKETS.organizerDocuments, doc.fileName).catch(() => {});
    }
  }

  const result = await User.deleteMany({ _id: { $in: stale.map((u) => u._id) } });
  return result.deletedCount || 0;
};

const startUnverifiedCleanup = () => {
  const run = async () => {
    try {
      const removed = await cleanupUnverifiedAccounts();
      if (removed > 0) console.log(`Removed ${removed} unverified account(s) older than ${MAX_AGE_HOURS}h`);
    } catch (err) {
      console.error('Unverified account cleanup failed:', err.message);
    }
  };

  run(); // once at startup, then on a timer
  const timer = setInterval(run, RUN_EVERY_MINUTES * 60 * 1000);
  timer.unref(); // never keeps the process alive on its own
};

module.exports = { startUnverifiedCleanup, cleanupUnverifiedAccounts };
