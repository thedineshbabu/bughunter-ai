import { query } from '../config/db.js';

export const UserModel = {
  async findById(id) {
    const result = await query('SELECT id, email, name, created_at FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async create({ email, password_hash, name }) {
    const result = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
      [email, password_hash, name || null]
    );
    return result.rows[0];
  },

  async update(id, fields) {
    const { name, email } = fields;
    const result = await query(
      'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3 RETURNING id, email, name',
      [name, email, id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    await query('DELETE FROM users WHERE id = $1', [id]);
  },
};
