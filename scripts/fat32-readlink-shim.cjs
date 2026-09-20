/**
 * FAT32 volumes on Windows have no symlinks, and libuv answers readlink() on a
 * regular file there with EISDIR instead of the EINVAL every tool expects
 * ("not a symlink"). webpack's resolver and Next's build tracing both treat
 * EINVAL as benign and EISDIR as fatal, so a checkout on such a drive cannot
 * build. This preload rewrites that one error. Loaded via
 * scripts/next-fat32.cjs; never used on volumes with symlink support.
 */
const fs = require("node:fs");

function normalise(err) {
  if (err && err.code === "EISDIR" && err.syscall === "readlink") {
    err.code = "EINVAL";
    err.errno = -4071;
    err.message = String(err.message).replace(
      "EISDIR: illegal operation on a directory",
      "EINVAL: invalid argument",
    );
  }
  return err;
}

const readlink = fs.readlink;
fs.readlink = function patchedReadlink(...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== "function") return readlink.apply(this, args);
  args[args.length - 1] = (err, result) => callback(normalise(err), result);
  return readlink.apply(this, args);
};

const readlinkSync = fs.readlinkSync;
fs.readlinkSync = function patchedReadlinkSync(...args) {
  try {
    return readlinkSync.apply(this, args);
  } catch (err) {
    throw normalise(err);
  }
};

const readlinkPromise = fs.promises.readlink;
fs.promises.readlink = async function patchedReadlinkPromise(...args) {
  try {
    return await readlinkPromise.apply(this, args);
  } catch (err) {
    throw normalise(err);
  }
};

// Make `import { readlink } from "node:fs"` see the patched functions too.
require("node:module").syncBuiltinESMExports();
