import { query } from '../config/db.js';

/** GET /api/apps */
export async function listApps(req, res, next) {
  try {
    const result = await query(
      'SELECT id, name, url, created_at, updated_at FROM apps WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ apps: result.rows });
  } catch (err) {
    next(err);
  }
}

/** POST /api/apps */
export async function createApp(req, res, next) {
  try {
    const { name, url, credentials } = req.body;

    const result = await query(
      `INSERT INTO apps (user_id, name, url, credentials)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, url, created_at`,
      [req.user.id, name, url, credentials ? JSON.stringify(credentials) : null]
    );

    res.status(201).json({ app: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** GET /api/apps/:id */
export async function getApp(req, res, next) {
  try {
    const result = await query(
      'SELECT id, name, url, created_at, updated_at FROM apps WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.json({ app: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/apps/:id */
export async function updateApp(req, res, next) {
  try {
    const { name, url, credentials } = req.body;

    const result = await query(
      `UPDATE apps
       SET name = COALESCE($1, name),
           url  = COALESCE($2, url),
           credentials = COALESCE($3, credentials),
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING id, name, url, updated_at`,
      [name, url, credentials ? JSON.stringify(credentials) : null, req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.json({ app: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/apps/:id */
export async function deleteApp(req, res, next) {
  try {
    const result = await query(
      'DELETE FROM apps WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    res.json({ message: 'App deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
}
