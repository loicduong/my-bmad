import fs from "node:fs/promises";
import path from "node:path";
import type { ContentProvider, ContentProviderTree } from "./types";
import { LOCAL_PROVIDER_DEFAULTS } from "./types";

type LocalProviderOptions = Partial<typeof LOCAL_PROVIDER_DEFAULTS>;

const ALLOWED_ROOTS = ["_bmad", "_bmad-output", "docs"];

export class LocalProvider implements ContentProvider {
  private rootPath: string;
  private options: typeof LOCAL_PROVIDER_DEFAULTS;

  constructor(rootPath: string, options: LocalProviderOptions = {}) {
    if (process.env.ENABLE_LOCAL_FS !== "true") {
      throw new Error("LOCAL_DISABLED");
    }
    this.rootPath = path.resolve(rootPath);
    this.options = { ...LOCAL_PROVIDER_DEFAULTS, ...options };
  }

  async validateRoot(): Promise<void> {
    try {
      const stat = await fs.stat(this.rootPath);
      if (!stat.isDirectory()) throw new Error("PATH_NOT_FOUND");
    } catch {
      throw new Error("PATH_NOT_FOUND");
    }
  }

  private resolveSafe(relativePath: string): string {
    if (relativePath.includes("\0")) {
      throw new Error("Path contains null bytes");
    }
    if (relativePath.includes("\u2215") || relativePath.includes("\uFF0F")) {
      throw new Error("Path contains unsupported characters");
    }
    if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
      throw new Error("Path traversal detected");
    }
    const resolved = path.resolve(this.rootPath, relativePath);
    if (resolved !== this.rootPath && !resolved.startsWith(this.rootPath + path.sep)) {
      throw new Error("Path traversal detected");
    }
    return resolved;
  }

  private assertAllowed(relativePath: string) {
    const first = relativePath.split(/[\\/]/)[0];
    if (!ALLOWED_ROOTS.includes(first)) {
      throw new Error("Access denied: only BMAD directories are accessible");
    }
  }

  async getTree(): Promise<ContentProviderTree> {
    await this.validateRoot();
    const paths: string[] = [];
    const rootDirectories = new Set<string>();

    const walk = async (directory: string, depth: number) => {
      if (depth > this.options.maxDepth) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!relativePath.includes(path.sep)) rootDirectories.add(entry.name);
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        paths.push(relativePath);
        if (paths.length > this.options.maxFileCount) {
          throw new Error("File count exceeds limit");
        }
      }
    };

    await walk(this.rootPath, 0);
    return { paths, rootDirectories: Array.from(rootDirectories) };
  }

  async getFileContent(filePath: string): Promise<string> {
    const resolved = this.resolveSafe(filePath);
    this.assertAllowed(filePath);
    const stat = await fs.lstat(resolved);
    if (stat.isSymbolicLink()) {
      throw new Error("Symlinks are not allowed");
    }
    if (stat.size > this.options.maxFileSizeBytes) {
      throw new Error("File exceeds limit");
    }
    return fs.readFile(resolved, "utf8");
  }
}
