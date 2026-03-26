import { query } from '../config/db.js';

/** GET /api/bugs */
export async function listBugs(req, res, next) {
  try {
    // page and limit are already coerced integers from validateQuery middleware
    const { run_id, severity, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const baseWhere = `
      FROM bug_reports b
      JOIN test_runs r ON b.run_id = r.id
      WHERE r.user_id = $1
    `;
    const params = [req.user.id];
    let idx = 2;
    let filters = '';

    if (run_id)   { filters += ` AND b.run_id = $${idx++}`;   params.push(run_id); }
    if (severity) { filters += ` AND b.severity = $${idx++}`; params.push(severity); }
    if (status)   { filters += ` AND b.status = $${idx++}`;   params.push(status); }

    const countResult = await query(`SELECT COUNT(*) ${baseWhere}${filters}`, params);

    const sql = `SELECT b.* ${baseWhere}${filters} ORDER BY b.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ bugs: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    next(err);
  }
}

/** GET /api/bugs/:id */
export async function getBug(req, res, next) {
  try {
    const result = await query(
      `SELECT b.*
       FROM bug_reports b
       JOIN test_runs r ON b.run_id = r.id
       WHERE b.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }

    res.json({ bug: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/bugs/:id/status */
export async function updateBugStatus(req, res, next) {
  try {
    const { status } = req.body;

    const result = await query(
      `UPDATE bug_reports b
       SET status = $1
       FROM test_runs r
       WHERE b.run_id = r.id AND b.id = $2 AND r.user_id = $3
       RETURNING b.id, b.status`,
      [status, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }

    res.json({ bug: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/bugs/:id */
export async function deleteBug(req, res, next) {
  try {
    const result = await query(
      `DELETE FROM bug_reports b
       USING test_runs r
       WHERE b.run_id = r.id AND b.id = $1 AND r.user_id = $2
       RETURNING b.id`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }

    res.json({ message: 'Bug deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
}
