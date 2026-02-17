import { query } from '../config/db.js';

export const RunModel = {
  async findById(id) {
    const result = await query('SELECT * FROM test_runs WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByUserId(userId, { app_id, status, page = 1, limit = 20 } = {}) {
    let sql = 'SELECT * FROM test_runs WHERE user_id = $1';
    const params = [userId];
    let idx = 2;

    if (app_id) { sql += ` AND app_id = $${idx++}`; params.push(app_id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, (page - 1) * limit);

    const result = await query(sql, params);
    return result.rows;
  },

  async create({ app_id, user_id }) {
    const result = await query(
      "INSERT INTO test_runs (app_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING *",
      [app_id, user_id]
    );
    return result.rows[0];
  },

  async update(id, fields) {
    const { status, summary, error } = fields;
    const result = await query(
      `UPDATE test_runs SET status = COALESCE($1, status),
       summary = COALESCE($2, summary), error = COALESCE($3, error) WHERE id = $4 RETURNING *`,
      [status, summary ? JSON.stringify(summary) : null, error, id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    await query('DELETE FROM test_runs WHERE id = $1', [id]);
  },
};
