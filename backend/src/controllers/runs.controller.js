import { query } from '../config/db.js';
import { enqueueTestRun } from '../queue/testQueue.js';

/** GET /api/runs */
export async function listRuns(req, res, next) {
  try {
    const { app_id, status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT r.id, r.status, r.started_at, r.completed_at, r.created_at,
             r.summary, a.name AS app_name, a.url AS app_url,
             COUNT(b.id) AS bug_count
      FROM test_runs r
      LEFT JOIN apps a ON r.app_id = a.id
      LEFT JOIN bug_reports b ON b.run_id = r.id
      WHERE r.user_id = $1
    `;
    const params = [req.user.id];
    let idx = 2;

    if (app_id) {
      sql += ` AND r.app_id = $${idx++}`;
      params.push(app_id);
    }
    if (status) {
      sql += ` AND r.status = $${idx++}`;
      params.push(status);
    }

    sql += ` GROUP BY r.id, a.name, a.url ORDER BY r.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(parseInt(limit), offset);

    const result = await query(sql, params);
    res.json({ runs: result.rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/runs */
export async function createRun(req, res, next) {
  try {
    const { app_id } = req.body;

    // Verify app belongs to user
    const appResult = await query(
      'SELECT id, url, credentials FROM apps WHERE id = $1 AND user_id = $2',
      [app_id, req.user.id]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    const app = appResult.rows[0];

    // Create test_run record
    const runResult = await query(
      `INSERT INTO test_runs (app_id, user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, status, created_at`,
      [app_id, req.user.id]
    );
    const run = runResult.rows[0];

    // Enqueue job for the Python agent
    await enqueueTestRun(run.id, app.url, app.credentials);

    res.status(201).json({ run });
  } catch (err) {
    next(err);
  }
}

/** GET /api/runs/:id */
export async function getRun(req, res, next) {
  try {
    const runResult = await query(
      `SELECT r.*, a.name AS app_name, a.url AS app_url
       FROM test_runs r
       LEFT JOIN apps a ON r.app_id = a.id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const bugsResult = await query(
      'SELECT * FROM bug_reports WHERE run_id = $1 ORDER BY severity, created_at DESC',
      [req.params.id]
    );

    res.json({ run: runResult.rows[0], bugs: bugsResult.rows });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/runs/:id */
export async function deleteRun(req, res, next) {
  try {
    const result = await query(
      'DELETE FROM test_runs WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({ message: 'Run deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
}
