// Stores uploaded files (activity cover images, organizer documents) in MongoDB GridFS.
// Hosts like Render's free plan wipe the server's disk on every restart/redeploy,
// so files saved to disk would disappear. MongoDB keeps them permanently.
const mongoose = require('mongoose');

const BUCKETS = {
  activityImages: 'activityImages',
  organizerDocuments: 'organizerDocuments',
};

const getBucket = (bucketName) => {
  if (!mongoose.connection.db) throw new Error('Database is not connected yet');
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
};

// Saves a file buffer under the given file name.
const saveFile = (bucketName, filename, buffer, contentType) => new Promise((resolve, reject) => {
  const uploadStream = getBucket(bucketName).openUploadStream(filename, { contentType });
  uploadStream.on('error', reject);
  uploadStream.on('finish', resolve);
  uploadStream.end(buffer);
});

// Returns the stored file info, or null if it doesn't exist.
const findFile = async (bucketName, filename) => {
  const [file] = await getBucket(bucketName).find({ filename }).limit(1).toArray();
  return file || null;
};

const openDownloadStream = (bucketName, fileId) => getBucket(bucketName).openDownloadStream(fileId);

// Deletes every stored copy with this file name (ignores missing files).
const deleteFile = async (bucketName, filename) => {
  if (!filename) return;
  const bucket = getBucket(bucketName);
  const files = await bucket.find({ filename }).toArray();
  await Promise.all(files.map((file) => bucket.delete(file._id).catch(() => {})));
};

module.exports = { BUCKETS, saveFile, findFile, openDownloadStream, deleteFile };
