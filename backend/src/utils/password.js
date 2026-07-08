/**
 * EdgeFlow - Password hashing (bcrypt)
 */

const bcrypt = require('bcrypt');
const config = require('../config');

async function hashPassword(plaintext) {
  if (!plaintext || plaintext.length < 8) throw new Error('Password must be at least 8 characters');
  return bcrypt.hash(plaintext, config.bcrypt.saltRounds);
}

async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  try { return bcrypt.compare(plaintext, hash); } catch { return false; }
}

function needsRehash(hash) {
  if (!hash || !hash.startsWith('$2')) return true;
  const rounds = parseInt(hash.split('$')[2], 10);
  return Number.isFinite(rounds) && rounds < config.bcrypt.saltRounds;
}

module.exports = { hashPassword, verifyPassword, needsRehash };
