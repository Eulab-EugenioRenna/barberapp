process.env.TZ = "Europe/Rome";

module.exports = {
  roots: ["<rootDir>/apps/api/src", "<rootDir>/apps/web-admin/src"],
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
  moduleNameMapper: {
    "^@barber/shared/utils$": "<rootDir>/libs/shared/utils/src/index.ts",
  },
  testEnvironment: "node",
  clearMocks: true,
};
