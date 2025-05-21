module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    '^.+\\.(js|jsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@datastax/langflow-client|undici|mime)/)',
  ],
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1'
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/types/**/*.ts",
    "!src/index.ts",
    "!src/langflow-proxy.ts"
  ]
}; 