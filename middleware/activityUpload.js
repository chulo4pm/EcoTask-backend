// Handles activity cover image uploads (images only, max 5 MB).
// Images are stored in MongoDB (see utils/fileStore.js) so they survive server restarts.
// They are still served at /uploads/activities/<file name>.
const path = require('path');
const multer = require('multer');
const { BUCKETS, saveFile } = require('../utils/fileStore');

const fileFilter = (_req, file, callback) => {
  if (file.mimetype.startsWith('image/')) {
    callback(null, true);
  } else {
    callback(new Error('Only image files are allowed'));
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Same usage as before: activityUpload.single('coverImage')
const single = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, async (error) => {
    if (error) return next(error);
    if (!req.file) return next();

    try {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      await saveFile(BUCKETS.activityImages, safeName, req.file.buffer, req.file.mimetype);
      req.file.filename = safeName;
      req.file.buffer = undefined;
      next();
    } catch (saveError) {
      next(saveError);
    }
  });
};

module.exports = { single };
