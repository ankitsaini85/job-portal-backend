const mongoose = require('mongoose');

const ExamCredentialSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // note: stored plain for now; consider hashing in production
  label: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ExamCredential', ExamCredentialSchema);
