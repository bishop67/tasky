// Release notes are bundled as text (esbuild's `--loader:.md=text`).
declare module "*.md" {
  const text: string;
  export default text;
}
