import { query } from '../config/db.js';

export const BugModel = {
  async findById(id) {
    const result = await query('SELECT * FROM bug_reports WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async findByRunId(runId) {
    const result = await query(
      'SELECT * FROM bug_reports WHERE run_id = $1 ORDER BY severity, created_at DESC',
      [runId]
    );
    return result.rows;
  },

  async create(data) {
    const {
      run_id, app_id, title, description, steps_to_reproduce,
      expected_behavior, actual_behavior, severity, screenshot_url, page_url,
    } = data;

    const result = await query(
      `INSERT INTO bug_reports
        (run_id, app_id, title, description, steps_to_reproduce,
         expected_behavior, actual_behavior, severity, screenshot_url, page_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [run_id, app_id, title, description, steps_to_reproduce,
       expected_behavior, actual_behavior, severity || 'medium', screenshot_url, page_url]
    );
    return result.rows[0];
  },

  async update(id, fields) {
    const { status, severity, title, description, screenshot_url } = fields;
    const result = await query(
      `UPDATE bug_reports SET
        status = COALESCE($1, status),
        severity = COALESCE($2, severity),
        title = COALESCE($3, title),
        description = COALESCE($4, description),
        screenshot_url = COALESCE($5, screenshot_url)
       WHERE id = $6 RETURNING *`,
      [status, severity, title, description, screenshot_url, id]
    );
    return result.rows[0] || null;
  },

  async delete(id) {
    await query('DELETE FROM bug_reports WHERE id = $1', [id]);
  },
};
