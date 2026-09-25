// Shared input validation rules for EcoTask user data.
// Keep these rules in sync with the frontend checks in Register.jsx.

const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ.' -]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PH_MOBILE_PATTERN = /^09\d{9}$/;

const validateName = (value) => {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return 'Full name is required.';
  if (name.length < 2 || name.length > 50) return 'Full name must be 2 to 50 characters.';
  if (!NAME_PATTERN.test(name)) return "Full name can only contain letters, spaces, periods, hyphens, and apostrophes.";
  if ((name.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length < 2) return 'Full name must contain at least 2 letters.';
  return null;
};

const validateOrganizationName = (value) => {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return 'Organization name is required.';
  if (name.length < 2 || name.length > 100) return 'Organization name must be 2 to 100 characters.';
  if (!/^[A-Za-z0-9À-ÖØ-öø-ÿ.,'&()\- ]+$/.test(name)) return 'Organization name contains invalid characters.';
  return null;
};

const validateEmail = (value) => {
  const email = String(value ?? '').trim();
  if (!email) return 'Email address is required.';
  if (email.length > 100) return 'Email address is too long.';
  if (!EMAIL_PATTERN.test(email)) return 'Please enter a valid email address.';
  return null;
};

const validatePhone = (value) => {
  const phone = String(value ?? '').trim();
  if (!phone) return 'Phone number is required.';
  if (!PH_MOBILE_PATTERN.test(phone)) return 'Phone number must be 11 digits and start with 09.';
  return null;
};

const validatePassword = (value) => {
  const password = String(value ?? '');
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 64) return 'Password must be 64 characters or fewer.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/\d/.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z\d]/.test(password)) return 'Password must include a special character.';
  return null;
};

// Drop empty entries so `errors` only lists fields that failed.
const compact = (errors) => Object.fromEntries(
  Object.entries(errors).filter(([, message]) => message)
);

// Full check for a new account. Every field is required.
const validateRegistration = ({ name, email, phone, password }) => compact({
  name: validateName(name),
  email: validateEmail(email),
  phone: validatePhone(phone),
  password: validatePassword(password),
});

// Profile updates: only check the fields that were sent.
const validateProfileUpdate = ({ name, email, phone, newPassword }) => compact({
  name: name !== undefined ? validateName(name) : null,
  email: email !== undefined ? validateEmail(email) : null,
  phone: phone !== undefined && String(phone).trim() !== '' ? validatePhone(phone) : null,
  newPassword: newPassword ? validatePassword(newPassword) : null,
});

// Send a 400 with per-field errors. Returns true if a response was sent.
const sendValidationErrors = (res, errors) => {
  if (Object.keys(errors).length === 0) return false;
  res.status(400).json({
    message: Object.values(errors)[0],
    errors,
  });
  return true;
};

module.exports = {
  validateName,
  validateOrganizationName,
  validateEmail,
  validatePhone,
  validatePassword,
  validateRegistration,
  validateProfileUpdate,
  sendValidationErrors,
};
