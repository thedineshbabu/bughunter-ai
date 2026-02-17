import { query } from '../config/db.js';

export const AppModel = {
  async findById(id) {
    const result = await query('SELECT * FROM apps WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByUserId(userId) {
    const result = await query('SELECT * FROM apps WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows;
  },

  async create({ user_id, name, url, credentials }) {
    const result = await query(
      'INSERT INTO apps (user_id, name, url, credentials) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, name, url, credentials ? JSON.stringify(credentials) : null]
    );
    return result.rows[0];
  },

  async update(id, { name, url, credentials }) {
    const result = await query(
      `UPDATE apps SET name = COALESCE($1, name), url = COALESCE($2, url),
       credentials = COALESCE($3, credentials), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, url, credentials ? JSON.stringify(credentials) : null, id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    await query('DELETE FROM apps WHERE id = $1', [id]);
  },
};
