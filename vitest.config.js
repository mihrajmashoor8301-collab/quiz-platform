include: ['backend/**/*.test.js', 'frontend/**/*.test.tsx']
coverage:
  provider: v8
  reporter: ['text', 'json', 'html']
  exclude: ['backend/node_modules', 'frontend/node_modules', 'backend/dist', 'frontend/dist']
globals: true
restoreMocks: true
coverageThreshold:
  global:
    - branches: 80
    - functions: 80
    - lines: 80
    - statements: 80
