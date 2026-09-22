module.exports = {
  roots: ["<rootDir>/apps/api/src"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/apps/api/tsconfig.spec.json",
      },
    ],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  testEnvironment: "node",
  clearMocks: true,
};
