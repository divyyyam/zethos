declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf-8"): Promise<string>;
  export function writeFile(path: string, data: string): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
}
