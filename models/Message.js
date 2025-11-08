const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  userId: { type: String, default: '' },
  userName: { type: String, default: 'Guest' },
  message: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
