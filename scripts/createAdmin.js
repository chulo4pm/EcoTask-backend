// Creates an EcoTask admin account (or turns an existing account into an admin).
// Use it once on a new database, e.g. MongoDB Atlas:
//   npm run create-admin -- admin@example.com "YourPassw0rd" "Admin Name"
// It uses MONGO_URI from your .env file (or from the environment).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const [email, password, name = 'EcoTask Admin'] = process.argv.slice(2);

(async () => {
  if (!email || !password) {
    console.log('Usage: npm run create-admin -- <email> <password> "<name>"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
  const cleanEmail = email.trim().toLowerCase();

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    existing.role = 'admin';
    existing.password = hashedPassword;
    existing.isEmailVerified = true;
    existing.isSuspended = false;
    await existing.save();
    console.log(`Updated ${cleanEmail}: it is now an admin account.`);
  } else {
    await User.create({ name, email: cleanEmail, password: hashedPassword, role: 'admin', isEmailVerified: true });
    console.log(`Created admin account ${cleanEmail}.`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error('Could not create the admin:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
