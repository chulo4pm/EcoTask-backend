// Handles organizer verification document uploads (JPG, PNG, PDF - max 5 MB each, up to 3 files).
// Files are stored in MongoDB (see utils/fileStore.js), which is NOT served publicly,
// so they survive server restarts on hosts like Render.
// Older files saved in /private-uploads/organizer-documents still work.
// Only admins can view them through GET /api/admin/organizers/:id/documents/:docId.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { BUCKETS, saveFile, deleteFile } = require('../utils/fileStore');

const DOCUMENT_DIR = path.join(__dirname, '..', 'private-uploads', 'organizer-documents');
fs.mkdirSync(DOCUMENT_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

const MAX_FILES = 3;
const MAX_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'documents'));
    }
    cb(null, true);
  },
}).array('documents', MAX_FILES);

// Wraps multer so upload errors come back as clean JSON instead of an HTML error page.
const documentUpload = (req, res, next) => {
  upload(req, res, async (error) => {
    if (!error) {
      try {
        for (const file of req.files || []) {
          // Random file name so users can't guess or overwrite other files.
          file.filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED_TYPES[file.mimetype]}`;
          await saveFile(BUCKETS.organizerDocuments, file.filename, file.buffer, file.mimetype);
          file.buffer = undefined;
        }
        return next();
      } catch (saveError) {
        removeUploadedFiles(req.files);
        return res.status(500).json({ message: 'Could not save the documents. Please try again.' });
      }
    }

    const messages = {
      LIMIT_FILE_SIZE: 'Each document must be 5 MB or smaller.',
      LIMIT_FILE_COUNT: `You can upload up to ${MAX_FILES} documents.`,
      LIMIT_UNEXPECTED_FILE: 'Only JPG, PNG, or PDF documents are allowed (up to 3 files).',
    };
    const message = messages[error.code] || 'Document upload failed.';
    res.status(400).json({ message, errors: { documents: message } });
  });
};

// Removes uploaded files (used when registration fails validation).
const removeUploadedFiles = (files = []) => {
  files.forEach((file) => {
    deleteFile(BUCKETS.organizerDocuments, file.filename).catch(() => {});
  });
};

// Converts multer files into the shape stored on the User document.
const toStoredDocuments = (files = []) => files.map((file) => ({
  fileName: file.filename,
  originalName: file.originalname.slice(0, 150),
  mimeType: file.mimetype,
  size: file.size,
}));

module.exports = { documentUpload, removeUploadedFiles, toStoredDocuments, DOCUMENT_DIR };
