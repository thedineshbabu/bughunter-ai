import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

const SALT_ROUNDS = 12;

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/** POST /api/auth/register */
export async function register(req, res, next) {
  try {
    const { email, password, name } = req.body;

    // Check for existing user
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, password_hash, name || null]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/login */
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/auth/me */
export async function me(req, res) {
  res.json({ user: req.user });
}

/** PATCH /api/auth/profile — update name, email, and/or password */
export async function updateProfile(req, res, next) {
  try {
    const { name, email, current_password, new_password } = req.body;
    const userId = req.user.id;

    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const u = result.rows[0];

    const emailChanged = email !== undefined && String(email).trim().toLowerCase() !== String(u.email).toLowerCase();
    const passwordChange = typeof new_password === 'string' && new_password.length > 0;

    if (emailChanged || passwordChange) {
      if (!current_password || typeof current_password !== 'string') {
        return res.status(400).json({ error: 'Current password is required to change email or password' });
      }
      const ok = await bcrypt.compare(current_password, u.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    if (emailChanged) {
      const emailNorm = String(email).trim().toLowerCase();
      const taken = await query('SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2', [emailNorm, userId]);
      if (taken.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    let password_hash = u.password_hash;
    if (passwordChange) {
      if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      password_hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    }

    const newName = name !== undefined ? String(name).trim() || null : u.name;
    const newEmail = email !== undefined ? String(email).trim().toLowerCase() : u.email;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    const updated = await query(
      'UPDATE users SET name = $1, email = $2, password_hash = $3 WHERE id = $4 RETURNING id, email, name',
      [newName, newEmail, password_hash, userId]
    );

    res.json({ user: updated.rows[0] });
  } catch (err) {
    next(err);
  }
}
