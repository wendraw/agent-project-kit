declare module "node:fs" {
  export function appendFileSync(path: string, data: string, encoding?: "utf8"): void;
  export function chmodSync(path: string, mode: number): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null): number;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
  export function statSync(path: string): {
    mode: number;
    isFile(): boolean;
    isDirectory(): boolean;
  };
  export function writeFileSync(path: string, data: string, encoding?: "utf8"): void;
}

declare module "node:child_process" {
  type SpawnSyncResult = {
    status: number | null;
    stdout?: string | Uint8Array | null;
    stderr?: string | Uint8Array | null;
    error?: Error;
  };

  export function spawnSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      stdio?: "pipe" | "inherit";
      encoding?: "utf8";
    },
  ): SpawnSyncResult;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:os" {
  export function homedir(): string;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  stdin: {
    isTTY?: boolean;
  };
  stdout: {
    write(chunk: string): void;
    isTTY?: boolean;
  };
  exitCode?: number;
};
