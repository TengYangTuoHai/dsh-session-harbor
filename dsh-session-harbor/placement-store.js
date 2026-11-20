import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Session Harbor processes using the same DSH home share one placement database. */
export async function openPlacementStore(home, loadLegacy) {
  const directory = join(home, 'storages', 'session-harbor');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'placements.sqlite'));
  try {
    db.exec(`
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS placements (
        sessionId TEXT PRIMARY KEY,
        settled INTEGER NOT NULL,
        settledAt REAL,
        unsettledAt REAL,
        writtenAt REAL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS migration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sessionIds TEXT NOT NULL,
        next INTEGER NOT NULL,
        startedAt REAL NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_import (id INTEGER PRIMARY KEY CHECK (id = 1)) STRICT;
    `);

    const imported = db.prepare('SELECT 1 FROM legacy_import WHERE id = 1');
    const find = db.prepare('SELECT settled, settledAt, unsettledAt FROM placements WHERE sessionId = ?');
    const findWriteTime = db.prepare('SELECT writtenAt FROM placements WHERE sessionId = ?');
    const list = db.prepare('SELECT sessionId, settled, settledAt, unsettledAt FROM placements');
    const version = db.prepare('PRAGMA data_version');
    const write = db.prepare(`
      INSERT INTO placements (sessionId, settled, settledAt, unsettledAt, writtenAt)
      VALUES ($id, $settled, $settledAt, $unsettledAt, $writtenAt)
      ON CONFLICT(sessionId) DO UPDATE SET
        settled = excluded.settled, settledAt = excluded.settledAt,
        unsettledAt = CASE WHEN $preserveUnsettledAt THEN placements.unsettledAt ELSE excluded.unsettledAt END,
        writtenAt = excluded.writtenAt
      WHERE $migrationStartedAt IS NULL OR coalesce(placements.writtenAt, -1) < $migrationStartedAt
    `);
    const readMigration = db.prepare('SELECT sessionIds, next, startedAt FROM migration WHERE id = 1');
    const writeMigration = db.prepare(`
      INSERT INTO migration (id, sessionIds, next, startedAt) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET next = max(migration.next, excluded.next)
      WHERE migration.sessionIds = excluded.sessionIds AND migration.startedAt = excluded.startedAt
    `);

    function put(id, record, { action, migrationStartedAt = null, writtenAt = Date.now() } = {}) {
      const { settled, settledAt, unsettledAt } = record;
      // Pin and settle leave the last reactivation time alone, including updates by a peer process.
      const preserveUnsettledAt = Number(action === 'pin' || action === 'settle');
      return write.run({ id, settled: Number(settled), settledAt, unsettledAt, writtenAt, migrationStartedAt, preserveUnsettledAt }).changes > 0;
    }

    if (!imported.get()) {
      const legacy = await loadLegacy();
      db.exec('BEGIN IMMEDIATE');
      try {
        // A second process may have imported the same legacy data while this one was reading it.
        if (!imported.get()) {
          for (const [id, record] of legacy.placements) put(id, record, { writtenAt: null });
          if (legacy.migration) {
            const { sessionIds, next, startedAt } = legacy.migration;
            writeMigration.run(JSON.stringify(sessionIds), next, startedAt);
          }
          db.exec('INSERT INTO legacy_import (id) VALUES (1)');
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }

    return {
      get(id) {
        const row = find.get(id);
        return row && decodePlacement(row);
      },
      entries() {
        return list.all().map(({ sessionId, ...row }) => [sessionId, decodePlacement(row)]);
      },
      put,
      canMigrate: (id, startedAt) => (findWriteTime.get(id)?.writtenAt ?? -1) < startedAt,
      // SQLite changes this counter on this connection when another connection commits.
      dataVersion: () => version.get().data_version,
      migrations: {
        get() {
          const row = readMigration.get();
          return row && { sessionIds: JSON.parse(row.sessionIds), next: row.next, startedAt: row.startedAt };
        },
        put(_key, { sessionIds, next, startedAt }) {
          writeMigration.run(JSON.stringify(sessionIds), next, startedAt);
        },
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function decodePlacement({ settled, settledAt, unsettledAt }) {
  return { settled: settled === 1, settledAt, unsettledAt };
}
