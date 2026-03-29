import { query } from '../config/db.js';
import { enqueueTestRun } from '../queue/testQueue.js';
import { decrypt } from '../lib/crypto.js';

/** GET /api/runs */
export async function listRuns(req, res, next) {
  try {
    // page and limit are already coerced to integers by validateQuery middleware
    const { app_id, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

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
    params.push(limit, offset);

    // COUNT query with same WHERE filters (no LIMIT/OFFSET)
    let countSql = 'SELECT COUNT(*) FROM test_runs r WHERE r.user_id = $1';
    const countParams = [req.user.id];
    let countIdx = 2;
    if (app_id) { countSql += ` AND r.app_id = $${countIdx++}`; countParams.push(app_id); }
    if (status) { countSql += ` AND r.status = $${countIdx++}`; countParams.push(status); }

    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(countSql, countParams),
    ]);

    res.json({ runs: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    next(err);
  }
}

/** POST /api/runs */
export async function createRun(req, res, next) {
  try {
    const { app_id, test_config } = req.body;

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

    // Decrypt credentials so the agent receives plaintext (never send ciphertext to Redis)
    const plainCredentials = decrypt(app.credentials);

    // Enqueue job for the Python agent
    await enqueueTestRun(run.id, app.url, plainCredentials, test_config || null);

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

/** PATCH /api/runs/:id — update status, summary, error (called by agent) */
export async function updateRun(req, res, next) {
  try {
    const { status, summary, error } = req.body;

    const result = await query(
      `UPDATE test_runs
       SET status    = $1,
           summary   = COALESCE($2, summary),
           error     = COALESCE($3, error),
           completed_at = CASE WHEN $1 IN ('completed','failed') THEN NOW() ELSE completed_at END
       WHERE id = $4
       RETURNING id, status, summary, error, completed_at`,
      [status, summary ?? null, error ?? null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({ run: result.rows[0] });
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
