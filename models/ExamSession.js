const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  qIndex: Number,
  choice: mongoose.Schema.Types.Mixed
}, { _id: false });

const ExamSessionSchema = new mongoose.Schema({
  credentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamCredential' },
  sessionToken: { type: String, required: true, unique: true },
  startedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  completed: { type: Boolean, default: false },
  answers: [AnswerSchema],
  score: { type: Number, default: null },
  clientIp: { type: String, default: '' }
});

module.exports = mongoose.model('ExamSession', ExamSessionSchema);
