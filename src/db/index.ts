/**
 * One `db` module for every caller.
 *
 * - `DATABASE_URL` set   -> postgres-js against that Postgres (Supabase later).
 * - `DATABASE_URL` unset -> embedded PGlite persisted in `.pglite/` (gitignored).
 * - `createDb({ memory: true })` -> throwaway in-memory PGlite for tests.
 *
 * Callers get a Drizzle `Db` and never care which driver is underneath.
 */
import path from "node:path";
import type { NodeFS as NodeFSType } from "@electric-sql/pglite/nodefs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema";

export { schema };

/** Driver-agnostic Drizzle handle. Both drivers satisfy it. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbDriver = "pglite" | "postgres";

export interface DbHandle {
  db: Db;
  driver: DbDriver;
  /** Human-readable target for log lines (credentials redacted). */
  describe: string;
  /** Apply the committed drizzle-kit migrations in ./drizzle. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Postgres connection string. Defaults to process.env.DATABASE_URL. */
  url?: string;
  /** PGlite data directory. Defaults to process.env.PGLITE_DIR or ./.pglite. */
  pgliteDir?: string;
  /** In-memory PGlite (tests). Ignores url and pgliteDir. */
  memory?: boolean;
}

const migrationsFolder = path.join(process.cwd(), "drizzle");

export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const url = options.memory ? undefined : (options.url ?? process.env.DATABASE_URL);

  if (url) {
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { max: 5, prepare: false });
    const db = drizzlePostgres(client, { schema });
    return {
      db,
      driver: "postgres",
      describe: `postgres (${redact(url)})`,
      migrate: () => migratePostgres(db, { migrationsFolder }),
      close: () => client.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = options.memory
    ? undefined
    : path.resolve(process.cwd(), options.pgliteDir ?? process.env.PGLITE_DIR ?? ".pglite");
  const client = await PGlite.create(dataDir ? { fs: await createTolerantNodeFs(dataDir) } : {});
  const db = drizzlePglite(client, { schema });
  return {
    db,
    driver: "pglite",
    describe: dataDir ? `pglite (${dataDir})` : "pglite (in-memory)",
    migrate: () => migratePglite(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

type SetattrFn = (node: { name: string }, attr: Record<string, unknown>) => unknown;

/**
 * PGlite's on-disk NodeFS sets file times through fs.utimesSync with the
 * timestamps Emscripten hands it. On FAT32 volumes (common for secondary
 * Windows drives) anything before 1980 is rejected with EINVAL, and that
 * single failed call aborts Postgres startup with a bare ErrnoError 28.
 * Postgres never relies on those mtimes, so retry the same setattr without
 * the timestamp part. Every other error is rethrown unchanged.
 */
async function createTolerantNodeFs(dataDir: string) {
  const { NodeFS } = await import("@electric-sql/pglite/nodefs");

  class TolerantNodeFS extends NodeFS {
    override async init(...args: Parameters<NodeFSType["init"]>) {
      const result = await super.init(...args);
      const patchSetattr: NonNullable<typeof result.emscriptenOpts.preRun>[number] = (mod) => {
        const nodefs = mod.FS.filesystems.NODEFS as unknown as { node_ops: { setattr: SetattrFn } };
        const original = nodefs.node_ops.setattr;
        nodefs.node_ops.setattr = (node, attr) => {
          try {
            return original(node, attr);
          } catch (error) {
            const errno = (error as { errno?: unknown } | null)?.errno;
            const hasTimes = attr.atime !== undefined || attr.mtime !== undefined;
            if (errno === 28 && hasTimes) {
              const withoutTimes = { ...attr };
              delete withoutTimes.atime;
              delete withoutTimes.mtime;
              return original(node, withoutTimes);
            }
            throw error;
          }
        };
      };
      // Runs before NodeFS's own preRun mounts the directory, so every node uses the patched ops.
      result.emscriptenOpts.preRun = [patchSetattr, ...(result.emscriptenOpts.preRun ?? [])];
      return result;
    }
  }

  return new TolerantNodeFS(dataDir);
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username}@` : ""}${u.host}${u.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

// Process-wide singleton for the Next.js app (survives dev HMR via globalThis).
const globalForDb = globalThis as typeof globalThis & {
  __eliteLedgerDb?: Promise<DbHandle>;
};

export function getDbHandle(): Promise<DbHandle> {
  globalForDb.__eliteLedgerDb ??= createDb();
  return globalForDb.__eliteLedgerDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}
