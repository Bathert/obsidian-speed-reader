import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["main.js", "node_modules/**", "tests/**", "release/**", "scripts/**", "*.config.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
];
