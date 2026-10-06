/** Jest config for @billetto/security-audit (ts-jest, CommonJS, like apps/api). */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.spec.ts"],
  // L'acceptance démarre une vraie fixture HTTP : laisser le temps.
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
};
