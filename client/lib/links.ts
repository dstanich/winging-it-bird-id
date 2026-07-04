export function pageHref(path: string): string {
  return process.env.NODE_ENV === "production" ? `${path}/index.html` : `${path}/`;
}
