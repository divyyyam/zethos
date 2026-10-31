declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf-8"): Promise<string>;
  export function writeFile(path: string, data: string): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function realpath(path: string): Promise<string>;
  export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
}

declare module "node:fs" {
  export function realpathSync(path: string): string;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export const sep: string;
}
