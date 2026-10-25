import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import { validateIdentity } from "./crypto.mjs";
import { RESTORE_MARKER, verifyAudit } from "./database.mjs";

const filenames = ["identity.json", "keydock.sqlite"];
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileInfo = z
  .object({ sha256: hash, size: z.number().int().positive() })
  .strict();
const validOrigin = (value) => {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
};
const manifestSchema = z
  .object({
    format: z.literal("keydock-backup"),
    version: z.literal(1),
    appVersion: z.literal("0.1.0"),
    schemaVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    origin: z.string().refine(validOrigin),
    signingKeyId: z.string().regex(/^[a-f0-9]{16}$/),
    audit: z
      .object({
        checked: z.number().int().nonnegative(),
        head: z.union([hash, z.literal("GENESIS")]),
      })
      .strict(),
    files: z
      .object({ "identity.json": fileInfo, "keydock.sqlite": fileInfo })
      .strict(),
  })
  .strict();

async function regularFile(path) {
  if (!(await lstat(path)).isFile())
    throw new Error(`Expected a regular file: ${basename(path)}`);
}

async function smallFile(path) {
  await regularFile(path);
  if ((await lstat(path)).size > 65536)
    throw new Error(`${basename(path)} exceeds the size limit`);
  return readFile(path);
}

async function fingerprint(path) {
  await regularFile(path);
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
    size += chunk.length;
  }
  return { sha256: digest.digest("hex"), size };
}

async function checkFiles(directory, manifest) {
  for (const name of filenames) {
    const actual = await fingerprint(join(directory, name));
    if (
      actual.sha256 !== manifest.files[name].sha256 ||
      actual.size !== manifest.files[name].size
    )
      throw new Error(`Backup checksum mismatch: ${name}`);
  }
}

function inspectDatabase(path, identity) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== 1)
      throw new Error(
        "Unsupported backup database schema; use the matching Keydock release",
      );
    if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete")
      throw new Error(
        "Backup database must be a standalone snapshot without WAL files",
      );
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (
      integrity.length !== 1 ||
      integrity[0].integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()
    )
      throw new Error("Backup database integrity check failed");
    const audit = verifyAudit(db, identity);
    if (!audit.valid)
      throw new Error(
        "Backup audit verification failed: identity mismatch or altered audit history",
      );
    if (
      !audit.checked &&
      ["users", "products", "customers", "licenses", "api_tokens"].some(
        (table) => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),
      )
    )
      throw new Error("A populated backup database must have audit history");
    return { checked: audit.checked, head: audit.head };
  } finally {
    db.close();
  }
}

// Resolve existing ancestors as well, so a symlink cannot disguise a destination
// inside the source directory. This does not create anything on disk.
async function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (dirname(absolute) === absolute) throw error;
    return join(await canonicalPath(dirname(absolute)), basename(absolute));
  }
}

function within(parent, path) {
  const part = relative(parent, path);
  return (
    part === "" ||
    (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
  );
}

// Call only for a directory allocated by mkdtemp in this operation.
export async function removeTemporaryDirectory(directory, parent) {
  const actual = await realpath(directory);
  if (
    actual !== resolve(directory) ||
    dirname(actual) !== (await realpath(parent)) ||
    (await lstat(directory)).isSymbolicLink()
  )
    throw new Error("Refusing cleanup outside the allocated directory");
  await rm(actual, { recursive: true, force: true });
}

async function flushFile(path) {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createBackup({ directory, output, origin }) {
  if (!validOrigin(origin))
    throw new Error("Provide the instance's exact KEYDOCK_ORIGIN");
  const source = await realpath(directory),
    destination = await canonicalPath(output);
  if (within(source, destination))
    throw new Error("Backup output must be outside the data directory");
  const identityBytes = await smallFile(join(source, "identity.json"));
  const identity = validateIdentity(JSON.parse(identityBytes));
  await regularFile(join(source, "keydock.sqlite"));
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const result = await mkdtemp(
    join(
      await realpath(destination),
      `keydock-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-`,
    ),
  );
  try {
    await writeFile(join(result, "identity.json"), identityBytes, {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    const db = new DatabaseSync(join(source, "keydock.sqlite"), {
      readOnly: true,
      timeout: 5000,
    });
    try {
      await sqliteBackup(db, join(result, "keydock.sqlite"));
    } finally {
      db.close();
    }
    // The online backup includes committed WAL data. Normalize only the copy,
    // making it portable without any sidecar files.
    const snapshot = new DatabaseSync(join(result, "keydock.sqlite"));
    try {
      snapshot.exec("PRAGMA journal_mode=DELETE;");
    } finally {
      snapshot.close();
    }
    await chmod(join(result, "keydock.sqlite"), 0o600);
    await flushFile(join(result, "keydock.sqlite"));
    if (!identityBytes.equals(await smallFile(join(source, "identity.json"))))
      throw new Error(
        "Instance identity changed during backup; retry with the instance stopped",
      );
    const audit = inspectDatabase(join(result, "keydock.sqlite"), identity);
    const files = {};
    for (const name of filenames)
      files[name] = await fingerprint(join(result, name));
    const manifest = manifestSchema.parse({
      format: "keydock-backup",
      version: 1,
      appVersion: "0.1.0",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      origin,
      signingKeyId: identity.signing.kid,
      audit,
      files,
    });
    // Written last: a partial backup is never accepted as a complete backup.
    await writeFile(
      join(result, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o600, flush: true },
    );
    await verifyBackup(result);
    return { directory: result, manifest };
  } catch (error) {
    await removeTemporaryDirectory(result, destination);
    throw error;
  }
}

export async function verifyBackup(directory) {
  const source = await realpath(directory);
  const entries = (await readdir(source)).sort();
  if (entries.join(",") !== [...filenames, "manifest.json"].sort().join(","))
    throw new Error(
      "Backup must contain exactly identity.json, keydock.sqlite and manifest.json",
    );
  const parsed = manifestSchema.safeParse(
    JSON.parse(await smallFile(join(source, "manifest.json"))),
  );
  if (!parsed.success)
    throw new Error("Unsupported or invalid backup manifest");
  const manifest = parsed.data;
  await checkFiles(source, manifest);
  const identity = validateIdentity(
    JSON.parse(await smallFile(join(source, "identity.json"))),
  );
  if (identity.signing.kid !== manifest.signingKeyId)
    throw new Error("Backup signing identity does not match the manifest");
  const audit = inspectDatabase(join(source, "keydock.sqlite"), identity);
  if (
    audit.checked !== manifest.audit.checked ||
    audit.head !== manifest.audit.head
  )
    throw new Error("Backup audit checkpoint does not match the manifest");
  return { directory: source, manifest };
}

export async function restoreBackup({ backupDirectory, destination }) {
  const backup = await verifyBackup(backupDirectory);
  // The parent must already exist. An existing target, even empty, is refused.
  const target = join(
    await realpath(dirname(resolve(destination))),
    basename(resolve(destination)),
  );
  if (within(backup.directory, target))
    throw new Error("Restore destination must be outside the backup directory");
  try {
    await lstat(target);
    throw new Error(
      "Restore destination already exists; choose a new directory",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = dirname(target),
    stage = await mkdtemp(join(parent, ".keydock-restore-"));
  let reserved = false,
    marked = false;
  const created = [];
  try {
    for (const name of filenames) {
      await copyFile(
        join(backup.directory, name),
        join(stage, name),
        constants.COPYFILE_EXCL,
      );
      await chmod(join(stage, name), 0o600);
    }
    await checkFiles(stage, backup.manifest);
    inspectDatabase(
      join(stage, "keydock.sqlite"),
      validateIdentity(
        JSON.parse(await smallFile(join(stage, "identity.json"))),
      ),
    );
    await mkdir(target, { mode: 0o700 }); // Exclusive reservation; never merge.
    reserved = true;
    await writeFile(
      join(target, RESTORE_MARKER),
      "Restore in progress. Do not start Keydock in this directory.\n",
      { flag: "wx", mode: 0o600, flush: true },
    );
    marked = true;
    for (const name of filenames) {
      await copyFile(
        join(stage, name),
        join(target, name),
        constants.COPYFILE_EXCL,
      );
      created.push(name);
      await chmod(join(target, name), 0o600);
      await flushFile(join(target, name));
    }
    await checkFiles(target, backup.manifest);
    await unlink(join(target, RESTORE_MARKER));
    marked = false;
    return {
      directory: target,
      origin: backup.manifest.origin,
      signingKeyId: backup.manifest.signingKeyId,
    };
  } catch (error) {
    if (reserved) {
      for (const name of created) await unlink(join(target, name));
      if (marked) await unlink(join(target, RESTORE_MARKER));
      // Do not recursively remove a target: unrelated files are never deleted.
      await rmdir(target).catch(() => {});
    }
    throw error;
  } finally {
    await removeTemporaryDirectory(stage, parent);
  }
}
