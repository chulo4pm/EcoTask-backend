// Routes for viewing and updating user profiles and admin-side user management.
const express = require('express');
const {
  getUsers,
  getUserById,
  deleteUser,
  updateMyProfile,
} = require('../controllers/userController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Users update their own profile; admins can manage all users.
router.patch('/me', protect, updateMyProfile);
router.use(protect, adminOnly);
router.get('/', getUsers);
router.get('/:id', getUserById);
router.delete('/:id', deleteUser);

module.exports = router;
