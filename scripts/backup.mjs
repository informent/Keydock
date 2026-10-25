import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "../server/backup.mjs";

const help = `Keydock backup and recovery

  npm run backup -- [--data-dir data] [--output backups] [--origin ORIGIN]
  npm run backup:verify -- BACKUP_DIRECTORY
  npm run restore -- BACKUP_DIRECTORY --to NEW_DIRECTORY

Backups include the private instance identity. Store them securely.
Create uses KEYDOCK_DATA_DIR and KEYDOCK_ORIGIN (or PORT) when set.
Restore requires an absent destination with an existing parent directory.
Stop Keydock before restoring and retain the origin recorded in the backup.`;

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!["create", "verify", "restore"].includes(command))
    throw new Error("Expected create, verify or restore");
  const options = { help: { type: "boolean", short: "h" } };
  if (command === "create")
    Object.assign(options, {
      "data-dir": { type: "string" },
      output: { type: "string" },
      origin: { type: "string" },
    });
  if (command === "restore") options.to = { type: "string" };
  const { values, positionals } = parseArgs({
    args: rest,
    options,
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (command === "create") {
    if (positionals.length)
      throw new Error("Backup creation does not accept positional arguments");
    const result = await createBackup({
      directory: resolve(
        values["data-dir"] ?? process.env.KEYDOCK_DATA_DIR ?? "data",
      ),
      output: resolve(values.output ?? "backups"),
      origin:
        values.origin ??
        process.env.KEYDOCK_ORIGIN ??
        `http://127.0.0.1:${process.env.PORT ?? 3400}`,
    });
    console.log(
      JSON.stringify(
        {
          backup: result.directory,
          origin: result.manifest.origin,
          audit: result.manifest.audit,
        },
        null,
        2,
      ),
    );
  } else {
    if (positionals.length !== 1)
      throw new Error("Provide exactly one backup directory");
    if (command === "verify") {
      const result = await verifyBackup(positionals[0]);
      console.log(
        JSON.stringify(
          {
            valid: true,
            backup: result.directory,
            origin: result.manifest.origin,
            audit: result.manifest.audit,
          },
          null,
          2,
        ),
      );
    } else {
      if (!values.to?.trim())
        throw new Error("Provide --to with a new destination directory");
      console.log(
        JSON.stringify(
          await restoreBackup({
            backupDirectory: positionals[0],
            destination: values.to,
          }),
          null,
          2,
        ),
      );
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Keydock backup: ${error instanceof SyntaxError ? "Invalid JSON in backup or identity file" : error.message}`,
    );
    process.exitCode = 1;
  }
}
